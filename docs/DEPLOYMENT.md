# Deployment And Operations

This guide covers application hosting and operational safety, not scientific approval. Read
[Configuration](CONFIGURATION.md) first. Neither a green health check nor a successful deploy certifies
environmental detections, validated impact or source-provider authorization.

## Deployment Units

Deploy the API, one or more appropriately resourced workers, one scheduler, PostgreSQL/PostGIS,
Redis and persistent/shared artifact storage. The frontend Node service serves the built SPA and
trusted adapters. Its optional artifact bridge needs read-only access to existing metadata/storage.

| Definition | Scope |
| --- | --- |
| [docker-compose.yml](../docker-compose.yml) | Local complete backend stack, migrations, storage and service volumes |
| [Dockerfile](../Dockerfile) | Python backend image |
| [render.yaml](../render.yaml) | Backend API, Redis, worker and scheduler Blueprint |
| [frontend/Dockerfile](../frontend/Dockerfile) | Separate multi-stage Node frontend image |
| [frontend/render.yaml](../frontend/render.yaml) | Separate frontend Blueprint, not a replacement for the backend |

The backend Render definition expects an externally configured PostGIS-capable `DATABASE_URL` and
private S3 settings. Do not assume the Blueprint provisions every required external service/permission.

## Local Docker

After configuring private settings:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api worker scheduler migrate
```

Named volumes persist PostgreSQL, Redis AOF and artifacts. Compose binds local ports to loopback.
Migration/seed is a one-shot dependency of API/worker startup. Do not delete volumes to address an
authentication error or a failed download. A single Celery beat scheduler avoids duplicate scheduling.

The frontend is not part of the root Compose file. Run it natively for development or build it separately:

```bash
docker build -t flagwa-frontend -f frontend/Dockerfile frontend
docker run --rm -p 5173:5173 -e FLAGWA_BACKEND_URL=https://YOUR_BACKEND flagwa-frontend
```

`127.0.0.1` inside the frontend container is that container, not the host or API container. Use the
correct reachable internal service URL/network or hosted backend. Provide private server settings
through the deployment environment; never bake credentials into the image. `.dockerignore` excludes
private environment files, dependencies and local build/test outputs.

## Native Frontend Production Host

```bash
npm --prefix frontend ci
npm --prefix frontend run build
NODE_ENV=production npm --prefix frontend start
```

Set `PORT`, `FLAGWA_BACKEND_URL` and any operator/bridge credentials privately. Use an HTTPS reverse
proxy or platform TLS termination. The Node host supplies SPA deep-link fallback; API/adapter failures
must remain JSON/errors rather than being rewritten into the SPA HTML.

For static-only hosting, build with a public backend URL and configure backend CORS. Static hosting
alone cannot implement private operator sessions or the prepared-artifact bridge. Pair it with a
trusted Node service or accept those explicit unavailable features.

## Render

Use the root Blueprint for backend components and the frontend Blueprint for the Node web service.
Supply server secrets in the platform UI/secret store. Match API/worker database, Redis, bucket and
artifact settings. Verify the PostGIS extension and migrations before requesting work.

Use durable S3-compatible storage for shared processed objects. Render's ephemeral staging paths are
not a raw-product backup. Enable the optional bridge only when its read-only database and object-store
settings identify the same actual results as the backend. Operator cookies require the HTTPS origin.

## Health And Monitoring

```bash
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
curl --fail http://127.0.0.1:8000/health/providers
docker compose exec worker celery -A app.workers.celery_app:celery_app inspect ping --timeout=5
```

Monitor job queue age, active execution/heartbeats, free staging disk, processed publication failures,
provider errors/authorization expiry and database/storage health. Readiness does not ping worker
consumers. Provider configuration does not prove fresh authentication. Avoid high-volume access logs
that capture sensitive URLs; preserve sanitized request IDs for diagnosing user-facing errors.

## Migrations And Backups

For native operator environments with the correct private settings:

```bash
alembic current
alembic upgrade head
alembic check
```

Back up PostgreSQL metadata and its corresponding raw/context/processed storage together. A database
backup without matching objects can leave valid-looking records with unreadable artifacts. Retain
source versions, checksums, licenses and review history. Test restores into an isolated environment,
including actual export/range reads and georeferencing, not just database startup.

Use versioned schema migrations, never ad-hoc table cleanup against production. Do not run destructive
integration fixtures against the live database. See [Development](DEVELOPMENT.md).

## Job Recovery

Heartbeats, renewable Redis leases and conservative reconciliation guard duplicate execution. Defaults
are documented in [Configuration](CONFIGURATION.md). Automatic reconciliation never silently retries
expensive processing or overwrites a live execution lease.

```bash
python -m app.cli.maintenance reconcile
python -m app.cli.maintenance cleanup
```

Cleanup defaults to dry-run. Review candidates before explicitly applying:

```bash
python -m app.cli.maintenance cleanup --older-hours 24 --apply
```

The command targets eligible old `.partial` files and refuses active-job conditions; it is not a
general raw/context/processed archive deletion tool. A job retry is explicit through the API/operator
UI and creates a new job with lineage. Cancellation is cooperative, not a guarantee that remote I/O
stops instantly. A failed replacement must not erase the previous completed acquisition.

## Study Boundaries And Context

Review source geometry, license and provenance before changing an AOI. Source-attributed draft
registration and independently reviewed boundary approval are distinct actions. Draft CLI entry points:

```bash
python -m app.cli.fetch_draft_aoi --help
python -m app.cli.set_draft_aoi --help
python -m app.cli.set_aoi --help
python -m app.cli.fetch_context --help
```

The exact source feature selection must be unambiguous. A draft administrative boundary is neither
an authoritative hazard extent nor a completed scientific review. Changing geometry can invalidate
cached acquisition coverage; new jobs snapshot the selected AOI and must re-check actual input coverage.

## Temporary Cloudflare Preview

For a short, intentional preview with an installed official `cloudflared` client:

```bash
cloudflared tunnel --url http://127.0.0.1:5173 --http-host-header localhost --protocol http2 --no-autoupdate
```

This creates a public temporary hostname, not private access or a production deployment. It lasts only
while the app, environment and tunnel run. Verify the page and `/backend/health/ready` through the
published hostname. Do not publish a session-specific tunnel URL as a permanent project address.
Do not tunnel a raw development backend with unprotected writes. Use explicit authentication/policies
for sensitive previews and a named/access-controlled deployment for longer-lived use.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Browser cannot open app | Correct Vite port, running task, remote port forwarding; container IP is not necessarily browser-reachable |
| `/backend` returns 502 | Actual API address from Node's network namespace, API readiness and configured URL |
| Jobs remain queued | Redis URL agreement, worker ping, broker state, queue age; do not repeatedly resubmit |
| Database refuses startup | Password consistency, URL encoding, network host, PostGIS extension and migration state |
| Before/after unavailable | Completed record roles, bridge enablement, read-only DB access and correct shared storage |
| Earthscore is aggregate | Spatial roles absent/unsupported; inspect explicit sampling warning rather than fabricate cells |
| Context is unavailable | Actual registered source coverage/provider errors; not a zero-exposure result |
| Map tiles fail | Provider/network policy; scientific geometry must remain separately identifiable |
| Map GeoJSON absent | Correct MapLibre worker asset, style readiness, geometry and browser WebGL support |
| Operator login disabled | Both server-held admin key and distinct passphrase configured, server restarted |
| Operator cookie rejected | HTTPS in production, exact same origin, cookie restrictions and proxy behavior |
| Download unauthorized | Earthdata/ASF authorization or separately approved Bhoonidhi access, not just account existence |
| AOI change rejected | Active jobs, invalid/ambiguous geometry, missing provenance or insufficient acquisition coverage |

Never resolve these states by weakening provenance checks, deleting a live database or substituting
random/demonstration values into scientific views.