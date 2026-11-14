# Repository Audit

## Starting State

The repository contained three working research scripts, two dependency lists, a draft Kuttanad GeoJSON,
date-window configuration, an empty scene-pair decision template, and a starter README. There was no API,
database, job system, frontend, automated test suite, object storage adapter, or deployment configuration.

| Module | Existing Status | Action |
| --- | --- | --- |
| API | Absent | Added one FastAPI application and versioned router |
| Database | Absent | Added one SQLAlchemy/PostGIS model set and Alembic migrations |
| NISAR integration | ASF audit and token-download scripts | Preserved; added reusable ASF/Earthdata/Bhoonidhi services |
| SAR processing | Generic HDF5 tree inspection | Preserved; added dynamic GCOV extraction, masks, alignment and candidate analysis |
| Community context | Absent | Added provenance registry, real JRC import and spatial exposure calculations |
| Jobs | Absent | Added Redis/Celery worker, database states, retries and cooperative cancellation |
| Storage | Raw-file script outputs | Preserved; added private local/S3 artifact storage and controlled exports |
| Testing | Absent | Added synthetic scientific tests, API tests, opt-in PostGIS/Redis integration and public live test |
| Deployment | Absent | Added Docker, Compose and Render configuration |
| Frontend contract | No frontend or existing expectations | Added documented JSON contract and generated FastAPI OpenAPI |

## Preserved

The three original files under `scripts/`, both AOI/date-window configuration files, and
`data/audit/scene_pair_decision.csv` were not rewritten. The original README guide remains below the new backend entry point.
The root dependency list was extended and `.gitignore` now excludes generated artifacts and test caches.

The working tree already contained a deleted root `.env.example` and an untracked `.env copy.example`.
Neither change was reverted or inspected for secret values. The safe backend template is
`config/backend.env.example`; merge its configuration names into the existing private `.env`.
The existing `.env` was not modified. No user modules or data were removed.

## New Components

- `app/core`: centralized settings, secret-safe errors, logging, access controls and SSRF checks.
- `app/database`, `app/models`: seven entities, spatial indexes and two migrations.
- `app/services/nisar`: public discovery, metadata normalization, compatibility, authentication,
  full downloads, bounded range inspection, AOI subset acquisition and independent Bhoonidhi adapter.
- `app/services/processing`: real-valued GCOV power processing, alignment, candidate flood classes and exports.
- `app/services/context`: versioned context import, official JRC baseline and exposure calculations.
- `app/workers`: separate worker process and database-backed lifecycle.
- `app/api`: health, locations, catalogue, acquisition, analysis, jobs, results, context and exports.
- `app/cli`: discovery, inspection, context ingestion, location seeding and explicit-pair analysis tools.
- `tests`, `docs`, Docker/Compose/Render manifests and local VS Code tasks.

## Deliberate Scientific Boundaries

Forest, agriculture, glacier, wildfire and deformation now have distinct executable experimental processors,
typed request models, queued jobs and export tests. Their capability records explicitly state `operational:false`;
they do not reuse a flood threshold as a substitute for their distinct science.
Population and other context layers are not invented when absent. Optional AI is not a source of measurements.
See [COMPLETION.md](COMPLETION.md) for the current implementation, real-data evidence, provider limitations and remaining scientific validation.