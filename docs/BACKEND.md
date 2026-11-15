# FLAGWA Backend

FLAGWA connects genuine NISAR observations to reproducible surface-response candidates, geographical context,
and explicitly limited exposure estimates. Kuttanad-Alappuzha is the primary pilot. Other locations are research
entries, not operational demonstrations; actual boundaries, acquisitions, context and completed results depend
on the running database and require independent review.

For the complete application, start with the [documentation index](README.md),
[Getting Started](GETTING_STARTED.md), [Architecture](ARCHITECTURE.md) and
[Configuration](CONFIGURATION.md). This file is the detailed backend reference, not the frontend user guide.

**Scientific status:** computation completed does not mean scientifically validated. The documented genuine-data
demonstration remains `pending_validation`; inspect each actual result's current review status rather than inferring
it from this report. GCOV difference is not flood depth, deforestation proof, crop yield or ground displacement.
NISAR launched in 2025 and did not observe Kerala's 2018 floods.
See [COMPLETION.md](COMPLETION.md) for the current implementation report and [ADVANCED.md](ADVANCED.md) for all six workflows,
independent validation, context acquisition, reviewed AOIs, recovery and safe optional interpretation.

## Architecture

```text
React/TypeScript -> FastAPI /api/v1 -> PostgreSQL/PostGIS metadata
                         |                    ^
                         v                    |
                    Redis broker -> Celery worker
                                         |
                          ASF / Earthdata / optional Bhoonidhi
                                         |
                         private raw products or AOI derivatives
                                         |
                      quality masks -> AOI -> common grid -> analysis
                                         |
                          COG + GeoJSON + PNG + JSON report
                                         |
                         local persistent disk / private S3
                                         |
                           record-based API export endpoints
```

Large rasters never enter database blobs. The API submits jobs; the worker does satellite transfer and processing.
The database is authoritative for job state. Output integrity, cancellation and job state are checked before result publication.
There are no public registration accounts. Read results are public research outputs; mutation endpoints require administrative access.

## Layout

```text
app/
  main.py
  api/{health.py,common.py,v1/}
  core/{config.py,security.py,exceptions.py,logging.py}
  database/{session.py,migrations/}
  models/entities.py
  schemas/{catalog.py,analysis.py}
  services/{nisar,processing,context,storage,reporting}/
  workers/{celery_app.py,tasks.py}
  cli/
tests/{unit,integration,live}/
config/{kuttanad_aoi.geojson,backend.env.example,...}
docs/{AUDIT.md,API.md,VERIFICATION.md}
```

## Python Setup

Python 3.12 is the tested runtime. Use a virtual environment, not the container's unrelated default interpreter.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Windows PowerShell:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

If Ubuntu lacks `ensurepip`, install the matching `python3.12-venv` package yourself, or use an existing pip's
`python -m pip --python .venv/bin/python install -r requirements.txt` with the already-created environment.
The latter was used successfully in this dev container. Never mix system GDAL Python bindings with an unrelated Rasterio wheel.
Docker includes `gdalinfo` and `gdal_translate`; Python processing uses Rasterio's bundled GDAL independently.
`earthaccess` is optional and unused by this implementation; ASF provides the implemented NASA integration.
Keeping earthaccess out of the core avoids its separate s3fs/aiobotocore dependency chain conflicting with boto3.

## Configuration

Configuration names and safe placeholders are in `config/backend.env.example`. Merge them into the private root `.env`
without overwriting existing credentials. The pre-existing deletion of root `.env.example` was preserved.
Never put credentials in source, API bodies, git, screenshots or chat.

Required local service settings:

```dotenv
DATABASE_URL=postgresql+psycopg://flagwa:YOUR_URL_ENCODED_PASSWORD@localhost:5432/flagwa
DOCKER_DATABASE_URL=postgresql+psycopg://flagwa:YOUR_URL_ENCODED_PASSWORD@postgres:5432/flagwa
POSTGRES_PASSWORD=YOUR_LOCAL_DATABASE_PASSWORD
REDIS_URL=redis://localhost:6379/0
ADMIN_API_KEY=YOUR_LOCALLY_GENERATED_ADMIN_SECRET
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

These are placeholders, not working credentials. Generate secrets locally, and URL-encode password characters in database URLs.
Production startup requires `ADMIN_API_KEY`. Without it, development writes are accepted only on direct loopback connections.
Do not rely on that exception behind a reverse proxy. Configure a key before exposing the server through port forwarding or a tunnel.
No map-provider or AI key is required.

## PostgreSQL/PostGIS, Redis And Docker

Set the Compose variables above, then:

```bash
docker compose up -d postgres redis
alembic upgrade head
python -m app.cli.seed_locations
uvicorn app.main:app --reload --no-access-log
celery -A app.workers.celery_app:celery_app worker --loglevel=warning --concurrency=1
```

Run the worker in a second terminal.

Run one scheduler in a third terminal for automated stale-job reconciliation:

```bash
celery -A app.workers.celery_app:celery_app beat --loglevel=warning --schedule storage/celerybeat-schedule --pidfile storage/celerybeat.pid
```

```bash
docker compose up --build -d
docker compose logs api worker migrate
```

Compose waits for PostgreSQL/Redis and runs a one-shot migration/seed service before starting API and worker.
The database account must be allowed to create PostGIS on first installation, or an operator must provision the extension.
Migrations only own FLAGWA's seven tables; extension tables are excluded from autogeneration.

```bash
alembic current
alembic upgrade head
alembic check
```

Compose uses named volumes for PostgreSQL, Redis AOF and artifacts. Never use `docker compose down -v` on data you need.
Local ports bind to loopback; configure ingress, HTTPS and an admin key for external deployment.

## Earthdata

Create a free [Earthdata Login](https://urs.earthdata.nasa.gov/) account, complete ASF authorization/EULA requirements,
and configure one of:

- `EARTHDATA_USERNAME` plus `EARTHDATA_PASSWORD`.
- Existing supported `EARTHDATA_TOKEN` (takes precedence).
- A private `.netrc` entry for `urs.earthdata.nasa.gov`; set owner-only permissions (`chmod 600 ~/.netrc`).

The dedicated service uses `ASFSession.auth_with_creds` / `auth_with_token`, caches sessions per thread,
sets timeouts and bounded retries, and never exposes credentials through the API.
An Earthdata account password is not an API key. Provider status reports configuration, not proof of a fresh successful download.

ASF uses an authenticated origin followed by a signed CDN redirect. `ASF_CDN_HOSTS` defaults to the exact hostname observed
and tested in this implementation. Other CloudFront domains are rejected. Earthdata authorization is stripped before CDN requests.
If ASF changes its CDN, verify the new destination against the trusted origin before updating this setting. Never use a wildcard.

## Bhoonidhi

Keep `BHOONIDHI_ENABLED=false` unless NRSC grants API access. A portal account is not automatically programmatic authorization.
Consult [the official API specification](https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/) and contact
`bhoonidhi@nrsc.gov.in` for access. Insert authorized credentials only into local environment settings.

The independent adapter implements password/refresh grants, expiry-aware token reuse, logout, authorization,
collection discovery, item retrieval, trusted STAC next-link pagination, retry/backoff and controlled streaming downloads.
It distinguishes expired sessions from forbidden access and follows download redirects only to explicitly vetted hosts in
`BHOONIDHI_DOWNLOAD_HOSTS`, without forwarding bearer credentials to other hosts. `data_maturity:null` permits discovery of
explicitly unknown maturity, but analysis still rejects unknown calibration states. Unsupported filter semantics are not guessed.
This adapter has mocked protocol tests, not a live NRSC approval test.

## Discovery And Inspection

No login is needed for basic public catalogue discovery:

```bash
python -m app.cli.audit_scenes --start 2026-10-21T00:00:00Z --end 2026-11-14T23:59:59Z --maturity VALIDATED
python scripts/search_kerala_nisar.py
```

The first command writes original and normalized metadata under ignored `storage/audit/`. Dates are explicit and must be updated
for later audits. Do not infer future availability from a previous successful search. Search provisional maturity separately.
The API stores original provider metadata and uses `intersectsWith` WKT, not deprecated ASF bbox/polygon query parameters.
Band L/S and internal product frequency A/B are separate concepts. Unknown metadata remains unknown; maturity may be established
from ASF's installed collection mapping, with that provenance recorded.

```bash
python -m app.cli.probe_access EXACT_DISCOVERED_SCENE_ID
python -m app.cli.inspect_remote EXACT_DISCOVERED_SCENE_ID --max-mib 32
python -m app.cli.inspect_product storage/raw/nisar/CONTROLLED_KEY/product.h5
```

The probe reads only a 4096-byte HDF5 header. Remote inspection uses fsspec range caching and an explicit byte budget,
not a multi-gigabyte full transfer. Local paths are operator CLI inputs only, never frontend download parameters.

## Acquisition And Flood Workflow

1. Discover actual GCOV records through the catalogue API.
2. Explicitly select before/after dates and the same frequency, covariance term, maturity and acquisition geometry.
3. Queue each known scene's download. Empty body requests a full source product; `mode=aoi_subset` requests bounded selective acquisition.
4. Poll its database-backed job. The worker verifies actual HDF5 identity, dimensions, CRS and available quality information.
5. Import an official or reviewed permanent-water baseline and optional slope layer.
6. Submit reviewed valid mask codes and a documented threshold rationale.
7. Retrieve the resulting candidate COG, GeoJSON, preview, statistics and processing report.
8. Validate independently before interpreting the layer as inundation evidence.

Selective acquisition preserves real measurement values, original subswath mask codes, coordinates and identity in a clearly labelled
AOI derivative. It does **not** claim to contain the complete NISAR product. Its SHA-256 covers the derived file, not the entire remote source.
Invalid or nonpositive power becomes nodata; raw masks are preserved. A scene's database record currently tracks one acquisition mode/layer.
Use full-product mode when multiple layers are required, or have an operator review an existing acquisition before replacing it.

```bash
python -m app.cli.fetch_water --location kuttanad
```

This imports a real JRC Global Surface Water v1.4 **2021** seasonality tile with a 32 MiB transfer cap, crops the AOI, and derives
12-month water. It is a historical baseline, not contemporary flood validation. Review shoreline/land-use changes and update context for research use.

The API requires a registered context-layer UUID and caller-supplied threshold/quality rationale. The local CLI accepts the same explicit inputs:

```bash
python -m app.cli.run_analysis --before EXACT_BEFORE_ID --after EXACT_AFTER_ID \
  --water-layer REGISTERED_LAYER_UUID --quality-values 1,2,3 \
  --quality-rule-source 'Actual product specification and reviewed mask codes' \
  --threshold-basis 'Exploratory thresholds, uncalibrated locally; independent validation pending' \
  --acquire-subsets --wait
```

Choose valid codes from the actual product, not blindly from this example. The CLI targets the local API and waits on the configured Redis result backend.
The default open-water candidate thresholds are after <= -17 dB, change <= -3 dB and before >= -14 dB.
They are transparent exploratory parameters, not a claimed Kerala calibration. A threshold rationale is mandatory.
Outputs distinguish invalid, no candidate, permanent water, potential new inundation and uncertain pixels.
Missing quality or unknown permanent-water observations become uncertainty, not an invented dry or flooded classification.
Quality-invalid power is removed before bilinear alignment; categorical masks use nearest-neighbor resampling.

Flooded vegetation may brighten rather than darken. Wet paddy, wind, changing vegetation, soil moisture and viewing conditions are confounders.
No slope exclusion is applied unless a registered degree-valued slope raster is supplied. Area is planar projected pixel area, not a precision geodesic survey.
Results are not calibrated disaster products or emergency-response advice.

## Other Context And Exposure

WorldPop/GHSL, OSM settlements/roads, HydroSHEDS, ESA WorldCover, Copernicus DEM, IMERG and official/geoBoundaries boundaries
can be imported using operator-reviewed local rasters or WGS84 GeoJSON. Provider discovery/import adapters now cover OSM,
WorldPop, STAC WorldCover/DEM, geoBoundaries and IMERG metadata. Asset imports are explicit, bounded and source-attributed;
IMERG NetCDF/product-specific processing can still require authorized offline preparation. See [ADVANCED.md](ADVANCED.md).
All imports require source URL, license/reuse terms, version, retrieval timestamp, CRS, resolution, units and processing notes.

```bash
python -m app.cli.register_context /path/to/reviewed-data.tif --metadata /path/to/provenance.json
```

The `ContextRegistration` schema defines the operator metadata contract; `config/context_layer.example.json` provides a template.
Replace every provenance placeholder with actual dataset information. Population must be counts in `people/pixel`, not a density raster.
Exposure sums nonnegative pixel-center counts inside candidate polygons, reports valid coverage, and does not extrapolate nodata.
Vectors support intersection and local metric buffers. An exposed estimate is not the number of people affected.
Supply `agriculture_class` from a reviewed class legend for categorical agricultural exposure. Continuous measurement coverage
is not treated as an impact area. Missing or unavailable sources are never converted into zero exposure or fabricated datasets.

## API And Frontend

The API is at `http://localhost:8000`, interactive docs at `/docs`, ReDoc at `/redoc`, and OpenAPI at `/openapi.json`.
See [API.md](API.md) for routes, example payloads, response conventions and authorization.
Configure `CORS_ORIGINS` for the React frontend. Never embed `ADMIN_API_KEY` in a publicly shipped frontend bundle;
route trusted administrative operations through an appropriate server-side control or restricted operator interface.

## Tests

```bash
pytest -q
LIVE_PROVIDER_TESTS=true pytest tests/live -q
```

Default tests never download satellite products. Synthetic fixtures are generated in temporary directories and labelled synthetic.
Real-service integration tests are opt-in and refuse any database not literally named `flagwa_test`:

```bash
APP_ENV=test RUN_INTEGRATION_TESTS=true \
DATABASE_URL=postgresql+psycopg://YOUR_TEST_USER:YOUR_PASSWORD@localhost:5432/flagwa_test \
REDIS_URL=redis://localhost:6379/1 pytest tests/integration -q
```

Apply migrations to that disposable database first. Its FLAGWA table data are cleared between tests; never use it for valuable data.
The integration suite starts a real Redis-backed Celery consumer and checks generated COG/GeoJSON/PNG exports through the API.
See [VERIFICATION.md](VERIFICATION.md) for commands and actual results from this implementation session.

## Jobs, Recovery And Storage

States: `QUEUED -> RUNNING -> VALIDATING -> COMPLETED`, or `FAILED` / `CANCELLED`.
Task completion means generated artifacts passed integrity checks, not that flood science was validated.
Transient transfer failures get at most two retries. Failed tasks cannot publish completed results.
Cancellation is cooperative at transfer/progress and output checkpoints; it never force-kills a worker writing a raster.
An already-transferred private artifact may remain after late cancellation, but no cancelled scientific result is published.
Workers renew owned leases and persist heartbeats. The scheduler marks expired executions FAILED only after the lease is gone;
old queued executions are failed only with no real broker backlog or active execution. It never silently reruns expensive processing.
Use the admin retry endpoint to create a new execution while retaining the original terminal record.

Defaults cap requests at 1 MiB, processing at 16 million pixels, full downloads at 50 GB, subset reads at 128 MiB per requested scene,
and require 1 GB free staging disk. Provider requests have timeouts. Tune for real worker RAM, disk and product size.
Local source files live under `storage/raw/nisar/`; processed outputs under `storage/processed/`; context under `storage/context/`.
The API does not offer arbitrary uploads, URL downloads, shell execution or filesystem browsing.
Use `python -m app.cli.maintenance cleanup` to preview abandoned partials; `--apply` is explicit and refused while jobs are active.
Complete source/processed/context files are never selected. Cache lifecycle and archival retention remain deployment policy decisions.

For S3, set `STORAGE_BACKEND=s3`, bucket, region and either environment credentials or a supported workload IAM role.
`S3_SERVER_SIDE_ENCRYPTION=AES256` requests AWS-compatible SSE. Set `none` only when your provider uses a separately reviewed
server-side encryption policy or for isolated local tests. Production custom endpoints must use HTTPS without embedded credentials.
Use a private bucket, least-privilege permissions, HTTPS, appropriate encryption and lifecycle policies. S3-compatible endpoints are optional.
API and worker must use the same bucket. Both need bounded local staging space; caches are replaceable, not durable source storage.
Local-mode deployments need a shared durable disk accessible to both processes. Never assume Render's ephemeral filesystem is permanent.

## Render

`render.yaml` defines an API, background worker, single scheduler and Redis-compatible service. Supply an external/provisioned PostgreSQL database
with PostGIS enabled and private S3-compatible storage. The blueprint intentionally does not assume a generic managed database has PostGIS permissions.
Set `DATABASE_URL`, `ADMIN_API_KEY`, bucket, region, optional storage endpoint/credentials, Earthdata credentials and frontend CORS origin.
Run `alembic upgrade head` as a release/predeploy operation once, then seed locations. Never run competing migrations from every worker.
The API health check is `/health/ready`; verify worker consumers separately. Use a paid/background-worker-capable plan and sufficient staging RAM/disk.
No Render deployment is claimed until the external services, secrets and plan are configured and tested.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `DEPENDENCIES_NOT_READY` | PostgreSQL/PostGIS, migration revision, Redis and writable staging |
| `ADMIN_NOT_CONFIGURED` | Configure admin key before using forwarded/non-loopback writes |
| `RATE_LIMIT_UNAVAILABLE` | Redis connection; expensive routes fail closed |
| `EARTHDATA_AUTH_FAILED` | Account authorization, credential validity, network and token expiry |
| `UNTRUSTED_PROVIDER_URL` | Verify exact provider/CDN host; never disable SSRF protection |
| `REMOTE_READ_LIMIT` | Subset chunking exceeded explicit byte budget; review AOI/product before increasing within limits |
| `INCOMPATIBLE_SCENES` | Actual HDF5 look direction, orbit/frame, frequency, maturity, release and coverage |
| `QUALITY_RULE_REQUIRED` | Review the actual mask attributes and product specification |
| `CONTEXT_NOT_AVAILABLE` | Import a source-attributed context dataset; absence is not zero exposure |
| `WRONG_PRODUCT_TYPE` / `HDF5_LAYER_UNAVAILABLE` | Select the correct GCOV/GOFF/GUNW product and actual inspected datasets |
| `REFERENCE_NOT_INDEPENDENT` / `REFERENCE_DATA_LEAKAGE` | Validation requires separate held-out evidence, not an input context mask |
| `SYNTHETIC_VALIDATION_FORBIDDEN` | Synthetic tests cannot be approved as genuine scientific observations |
| Queue remains queued | Worker environment/broker match, `celery -A app.workers.celery_app:celery_app inspect ping` |

## Sources

- [ASF API basics](https://docs.asf.alaska.edu/api/basics/), [keywords](https://docs.asf.alaska.edu/api/keywords/).
- [NISAR ASF search](https://nisar-docs.asf.alaska.edu/asf-search/), [GCOV specification overview](https://nisar-docs.asf.alaska.edu/gcov/).
- [Earthdata Login](https://urs.earthdata.nasa.gov/), [NASA SAR background](https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar).
- [Bhoonidhi API](https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/), [ISRO NISAR](https://bhoonidhi.nrsc.gov.in/NISAR/).
- [JRC Global Surface Water](https://global-surface-water.appspot.com/), [WorldPop](https://www.worldpop.org/), [GHSL](https://human-settlement.emergency.copernicus.eu/).
- [OSM attribution](https://www.openstreetmap.org/copyright), [HydroSHEDS](https://www.hydrosheds.org/), [ESA WorldCover](https://esa-worldcover.org/).
- [Copernicus Data Space](https://dataspace.copernicus.eu/), [NASA IMERG](https://gpm.nasa.gov/data/imerg), [geoBoundaries](https://www.geoboundaries.org/).
- [NASA NISAR storymaps](https://science.nasa.gov/mission/nisar/arcgis-storymaps/), [UAVSAR educational postcards](https://uavsar.jpl.nasa.gov/education/postcards.html).
- [Space Apps challenge reference supplied for this project](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars).
- [Meteomatics API](https://www.meteomatics.com/en/api/getting-started/) is an optional external resource, not an implemented or required rainfall integration.