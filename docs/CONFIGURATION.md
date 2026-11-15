# Configuration And Security

Configuration is split between the Python backend, the trusted Node frontend server and the public
browser bundle. Examples below contain placeholders only. Use your platform's secret manager or ignored
local files; never commit credentials, raw products, signed URLs or private database connection strings.

## Files And Loading

| Location | Consumer | Purpose |
| --- | --- | --- |
| Root private `.env` | Python settings and Docker Compose | Backend/provider/storage settings |
| [config/backend.env.example](../config/backend.env.example) | Human reference | Safe backend template |
| Frontend private `.env.server` | Node gateway/Vite server middleware | Server-only bridge/operator settings |
| [frontend/.env.server.example](../frontend/.env.server.example) | Human reference | Safe trusted-server template |
| Frontend public `.env` / hosting build variables | Vite | Public `VITE_FLAGWA_API_BASE_URL` only |
| [frontend/.env.example](../frontend/.env.example) | Human reference | Safe public template |

The Node gateway loads `.env.server` relative to its working directory. Run its npm scripts with
`npm --prefix frontend ...` or from `frontend/`. Backend Python commands normally run from the repository
root. Restart the affected process after changing private settings; rebuild for changed Vite variables.

## Public Browser Setting

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_FLAGWA_API_BASE_URL` | `/backend` | Same-origin public adapter or an explicitly public hosted API URL |

Every `VITE_` value must be considered public. Never use that prefix for admin/provider/database/S3/AI
credentials. Direct cross-origin API use requires backend CORS configuration; the default Node proxy
avoids that browser cross-origin dependency and can stream scientific exports.

## Core Backend Settings

| Variable | Default or requirement | Notes |
| --- | --- | --- |
| `APP_ENV` | `development`; production for deployment | Production requires admin key |
| `DATABASE_URL` | PostgreSQL URL with `postgresql+psycopg://` | Python/SQLAlchemy driver syntax |
| `REDIS_URL` | `redis://localhost:6379/0` | API, worker and scheduler must agree |
| `ADMIN_API_KEY` | Private, required in production | Backend mutation authorization |
| `CORS_ORIGINS` | Local 3000/5173 origins | Comma-separated exact allowed browser origins |
| `API_V1_PREFIX` | `/api/v1` | Frontend currently targets this conventional contract |
| `API_PORT` | Compose default 8000 | Host port mapping, not a browser secret |
| `DEBUG` | `false` | Keep disabled for deployment |

Compose additionally requires `POSTGRES_PASSWORD` and `DOCKER_DATABASE_URL`. The latter uses host
`postgres` inside the Compose network; the native `DATABASE_URL` normally uses `127.0.0.1` outside it.
URL-encode password special characters in URLs, not in the raw `POSTGRES_PASSWORD` value.

Development backend writes without a key are restricted to direct loopback connections. This is not
a production authentication scheme. A public reverse proxy can change network assumptions; configure
an admin key and expose only deliberate public routes before forwarding/tunnelling services.

## Provider Access

| Variables | Purpose and limits |
| --- | --- |
| `EARTHDATA_TOKEN` | Supported authenticated access; takes precedence over username/password |
| `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` | Set together after Earthdata/ASF authorization |
| `ASF_CDN_HOSTS` | Exact trusted CDN destinations; verify provider changes, never use a wildcard |
| `PROVIDER_TIMEOUT_SECONDS` | Default 60; bounded requests, not indefinite waiting |
| `BHOONIDHI_ENABLED` | Default false; requires separate authorized NRSC programmatic access |
| `BHOONIDHI_USERNAME`, `BHOONIDHI_PASSWORD`, `BHOONIDHI_DOWNLOAD_HOSTS` | Private adapter credentials and vetted download hosts |

A portal account is not proof of API authorization. Provider health exposes configuration/status, not
proof of a new successful data transfer. Basic public ASF discovery and private product access are
different operations. Source licensing, rate limits and attribution still apply.

## Artifact Storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_BACKEND` | `local` | `local` or `s3` |
| `LOCAL_STORAGE_PATH` | `storage` | Persistent local artifacts or writable staging for remote storage |
| `S3_BUCKET` | Required for S3 | Existing private bucket |
| `S3_REGION` | `us-east-1` | Actual bucket/service region |
| `S3_ENDPOINT_URL` | Empty for standard AWS | Optional trusted S3-compatible origin; HTTPS in production |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Private if explicit credentials used | Scope minimally; prefer appropriate platform credentials |
| `S3_SERVER_SIDE_ENCRYPTION` | `AES256` | Backend object-encryption setting; review compatibility deliberately |

API and worker must resolve the same processed keys. Local storage requires a shared persistent mount.
S3 deployments still require adequate writable staging disk. Do not interpret an ephemeral filesystem
as permanent storage or allow raw storage keys to become arbitrary public download paths.

## Resource And Recovery Controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_DOWNLOAD_BYTES` | 50,000,000,000 | Overall acquisition size ceiling |
| `MAX_PROCESSING_PIXELS` | 16,000,000 | Processing grid bound |
| `MIN_FREE_DISK_BYTES` | 1,000,000,000 | Staging disk guard |
| `MAX_REQUEST_BYTES` | 1,048,576 | HTTP request-body ceiling |
| `EXPENSIVE_REQUESTS_PER_MINUTE` | 20 | Expensive operation rate limit |
| `JOB_HEARTBEAT_SECONDS` | 20 | Worker progress/liveness heartbeat |
| `JOB_LEASE_SECONDS` | 120 | Renewable execution lease |
| `STALE_JOB_SECONDS` | 180 | Stale execution threshold |
| `QUEUED_JOB_TIMEOUT_SECONDS` | 3600 | Conservative lost-queued-message threshold |

The lease must exceed three heartbeat intervals and the stale threshold must exceed the lease.
The per-request AOI remote MiB budget is a separate typed download parameter, not permission for
unbounded access. Raising limits does not fix incompatible scenes or invalid scientific assumptions.

## Trusted Frontend Server

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLAGWA_BACKEND_URL` | `http://127.0.0.1:8000` | Trusted server-to-server API destination |
| `PORT` | 5173 in production Node host | Listening port |
| `NODE_ENV` | Set `production` for deployment | Enables Secure operator cookies |
| `ADMIN_API_KEY` | Empty disables operator gateway | Same backend key; never returned to browser |
| `OPERATOR_ACCESS_SECRET` | Empty disables sessions | Separate passphrase, at least 16 characters |

The operator gateway is intentionally disabled unless both private values exist. Authentication uses a
rate-limited same-origin request and a signed, one-hour HttpOnly, SameSite=Strict cookie. Production
cookies require HTTPS. It is a shared restricted-operator facility, not a complete user-account/RBAC system.
Current rate-limit/session state is not a distributed identity platform; plan authentication appropriately
for larger or multi-instance deployments.

## Optional Read-Only Prepared-Artifact Bridge

| Variable | Default | Purpose |
| --- | --- | --- |
| `FLAGWA_ENABLE_ARTIFACT_BRIDGE` | `false` | Explicitly enable completed-result artifact lookup |
| `FLAGWA_DATABASE_URL` | Empty | Standard Node `postgresql://` URL, not SQLAlchemy driver syntax |
| `PG_SSL` | `false` | Use true with appropriately configured hosted PostgreSQL TLS |
| `FLAGWA_STORAGE_ROOT` | `../storage` relative to Node cwd | Existing local processed storage root |
| `STORAGE_BACKEND`, `S3_*` | Server storage settings | Same existing artifact namespace as the backend |

Give the bridge only SELECT on `analysis_results` and `analysis_jobs`, and read-only processed-storage
access. It resolves completed results and only `before_power`, `after_power`, `change_geotiff` roles.
UUIDs, role names, object keys and real paths are validated. It never supplies arbitrary HDF5/server paths.
Local symlink escapes and traversal are rejected. Requests support bounded single byte ranges.

Without the bridge, the UI retains normal public primary COG/summary evidence and reports unavailable
prepared observations. Earthscore can fall back to an explicitly labelled reported aggregate. Do not
fix that state by putting storage credentials into browser code or inventing additional data.

## Optional Interpretation

`AI_ENABLED`, `AI_PROVIDER`, `AI_API_KEY` and `AI_MODEL` belong only to the backend. The optional
interpreter is source-constrained and must not invent measurements. Groundwire's deterministic briefs
and Earthscore's art/audio do not require an external generative-AI or music API.

## Security Checklist

- Verify private environment, installed dependencies, storage and test reports remain Git-ignored.
- Use distinct strong secrets and narrow database/storage permissions.
- Keep original source provenance, licensing and explicit synthetic-fixture markers.
- Do not expose raw local paths, signed tokens, public write exceptions or unrestricted origin proxies.
- Protect backups as scientific data and secret-bearing infrastructure, not public repository files.
- Review TLS, authentication, origin policy, external-provider terms and log redaction before deployment.