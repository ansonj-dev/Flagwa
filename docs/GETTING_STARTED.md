# Getting Started

This guide starts the complete application without assuming that another developer's database,
downloaded products or temporary tunnel are available. See [Configuration](CONFIGURATION.md) for the
full public/private settings boundary and [User Guide](USER_GUIDE.md) for the application workflows.

## Prerequisites

| Tool or service | Requirement |
| --- | --- |
| Git | Clone and maintain source |
| Node.js | Version 24 or newer; server executes TypeScript directly |
| npm | Install the committed frontend lockfile with `npm ci` |
| Docker and Compose | Recommended backend service setup |
| Python | 3.12 tested for native backend development |
| PostgreSQL | PostGIS enabled; Compose supplies PostgreSQL 16 / PostGIS 3.4 |
| Redis | Broker/result infrastructure; Compose supplies Redis 7 |
| Browser | Modern Canvas/WebGL; Web Audio optional and user-initiated |

Public catalogue searches do not normally require Earthdata authentication. Authorized satellite
downloads do. Independent context and reference datasets have their own access/reuse requirements.

## 1. Obtain Source And Configure Secrets

```bash
git clone https://github.com/ansonj-dev/Flagwa.git
cd Flagwa
```

Create a private root `.env` based on [the backend template](../config/backend.env.example), without
overwriting an existing file. For Compose, configure at least:

```dotenv
POSTGRES_PASSWORD=REPLACE_WITH_A_LOCAL_SECRET
DATABASE_URL=postgresql+psycopg://flagwa:URL_ENCODED_PASSWORD@127.0.0.1:5432/flagwa
DOCKER_DATABASE_URL=postgresql+psycopg://flagwa:URL_ENCODED_PASSWORD@postgres:5432/flagwa
REDIS_URL=redis://127.0.0.1:6379/0
ADMIN_API_KEY=REPLACE_WITH_A_STRONG_LOCAL_SECRET
```

Use the same actual database password in both URLs and `POSTGRES_PASSWORD`, URL-encoded where needed.
Do not paste real secrets into Markdown, chat or screenshots. Compose sets production mode internally,
so its backend services require an admin key even for local use.

## 2. Start The Containerized Backend

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api worker scheduler migrate
```

The migration service applies Alembic migrations and seeds location metadata before API/worker startup.
It does not seed satellite measurements, context coverage or processed scientific results.
Containers share a persistent artifact volume. Do not delete volumes to fix a configuration problem.

Check readiness:

```bash
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
docker compose exec worker celery -A app.workers.celery_app:celery_app inspect ping --timeout=5
```

Readiness checks dependencies/storage/migrations. Worker inspection separately verifies a consumer.
Neither check certifies scientific validity or a successful fresh provider download.

## 3. Start The Frontend

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open http://localhost:5173/. Vite chooses another available port if that port is occupied; use the URL
it prints. In a remote container/Codespace, forward that port using the editor's Ports panel.
The default `/backend` frontend adapter targets http://127.0.0.1:8000.

The frontend server reads its optional ignored `.env.server` relative to its working directory,
normally `frontend/` when launched with these npm commands. Use
[frontend/.env.server.example](../frontend/.env.server.example) as a safe reference. At minimum, a
non-default backend address requires `FLAGWA_BACKEND_URL` on that server.

```bash
curl --fail http://127.0.0.1:5173/backend/health/ready
```

No `ADMIN_API_KEY` is needed in browser code. To enable restricted UI submissions, configure the same
backend admin key and a separate strong `OPERATOR_ACCESS_SECRET` in the Node server environment,
then restart Vite/Node. Public reading remains available without an operator session.

## 4. Understand A Fresh Installation

Locations and case studies describe research questions, not proof that usable data exist. Empty
results, unavailable context and disabled comparison are expected before real inputs are acquired.
The project does not ship scientific demo observations or a fake production fallback.

The optional artifact bridge is needed for prepared before/after power COGs and spatial Earthscore
samples. Public primary-result COG, preview and summary exports do not depend on that bridge.
For local storage, the Node service must be able to read the same processed files as the backend.
**Compose's `artifacts` volume is not automatically the host's `storage/` directory.** Mount that
existing volume read-only into a trusted Node deployment, use shared S3, or run native services on a
shared local artifact root. Do not point the bridge at an unrelated directory and assume data exist.

## 5. Obtain A Real Result

1. Inspect the selected location's actual AOI and whether it is draft or reviewed.
2. Search the catalogue with explicit dates, product, frequency, maturity and AOI/bbox.
3. Select genuinely comparable observations and run compatibility checks.
4. Configure authorized Earthdata access and acquire the selected products or explicit AOI derivatives.
5. Inspect the actual HDF5 datasets, units, quality flags and available covariance terms.
6. Register source-attributed context such as permanent water and any theme-specific masks.
7. Submit reviewed processing parameters and track the asynchronous job.
8. Inspect the result, caveats and provenance; independently validate before claiming an event.

Use [API](API.md), [Backend](BACKEND.md) and [Scientific Workflows](ADVANCED.md) for exact bodies and
CLI commands. Thresholds and scene IDs must come from actual evidence, not copied examples.

## Native Python Alternative

Run PostgreSQL/PostGIS and Redis first, then use a private root `.env` with their local URLs:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
alembic upgrade head
python -m app.cli.seed_locations
uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

In separate activated terminals, from the repository root:

```bash
celery -A app.workers.celery_app:celery_app worker --loglevel=warning --concurrency=1
```

```bash
celery -A app.workers.celery_app:celery_app beat --loglevel=warning --schedule storage/celerybeat-schedule --pidfile storage/celerybeat.pid
```

Run exactly one scheduler. Do not run a second native worker/API stack on the same ports while using
the Compose stack unless that is deliberate. Native Windows setup and GDAL considerations are in
[Backend Reference](BACKEND.md); Docker avoids many platform-specific geospatial dependency issues.

## Existing VS Code Tasks

[The workspace tasks](../.vscode/tasks.json) are conveniences for the original development environment.
They use local PostGIS/Redis ports 55432/56379, whereas Compose defaults to 5432/6379. They are not
interchangeable configurations. The infrastructure creation task creates named containers and must
not be rerun blindly when those containers already exist. Inspect/restart existing containers instead.

## Stop Without Losing Data

Stop foreground frontend/native processes with Ctrl+C. For Compose:

```bash
docker compose stop
```

Do not use `docker compose down -v` unless intentionally deleting all named-volume data. See
[Deployment And Operations](DEPLOYMENT.md) for backups, recovery and troubleshooting.