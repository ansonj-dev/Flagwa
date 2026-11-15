# Troubleshooting

Start with the exact failing layer. FLAGWA contains a browser, trusted frontend server, API, database, Redis, worker, optional scheduler, provider integrations and artifact storage. A green status at one layer does not prove every downstream layer is healthy.

## 1. Frontend loads but data is unavailable

1. Check the API address configured in the trusted Node server (`FLAGWA_BACKEND_URL`).
2. Check `http://localhost:8000/health/live` and `/health/ready`.
3. Check the same-origin adapter at `http://localhost:5173/backend/health/ready`.
4. Inspect browser network requests and Node/API logs.
5. Confirm the selected location/result exists in the current database.

Do not add `ADMIN_API_KEY` to a browser variable to “fix” a 401. Public GET and restricted operator routes are intentionally separate.

## 2. API readiness fails

```bash
docker compose ps
docker compose logs --tail=150 api postgres redis migrate
```

Check database URL host/password encoding, PostGIS availability, migration status and Redis connection. Inside Compose the database hostname is `postgres`; on the host it is normally `127.0.0.1`.

## 3. Jobs remain queued or do not progress

```bash
docker compose logs --tail=200 worker scheduler redis
docker compose exec worker celery -A app.workers.celery_app:celery_app inspect ping --timeout=5
```

Confirm worker and API use the same Redis URL/database and persistent storage configuration. Confirm the scheduler is not duplicated. Inspect the job's recorded state/heartbeat before retrying. Do not directly edit job rows to make the UI show completion.

## 4. Catalogue search returns zero scenes

A zero result can be correct. Check:
- actual AOI coordinates and WGS84 lon/lat order;
- acquisition date range and UTC interpretation;
- collection/product type, frequency and polarization filters;
- maturity filter and provider current release;
- catalogue pagination and archive availability.

A zero result is not a software failure unless logs/schema/provider errors indicate one. Never invent a scene to fill a demo.

## 5. Download is unauthorized or fails after catalogue search

Catalogue discovery and product download can have different access requirements. Verify Earthdata Login token/account, provider authorization, expiry and server configuration. Do not expose tokens in logs. If an approved host redirects to a CDN, check the exact trusted host allowlist; do not broadly allow arbitrary external hosts.

Bhoonidhi access is separate. Portal visibility does not prove programmatic authorization.

## 6. Product inspection says a dataset is missing

Inspect the exact scene's HDF5 metadata. Dataset names and polarizations are not guaranteed to be identical across collection modes. Confirm the correct product/acquisition, dataset path, units, fill values, quality flags and measurement-group consistency. Do not copy a dataset path from a different granule.

## 7. Processing fails compatibility or quality checks

Treat validation errors as scientific guardrails. Review acquisition dates, orbit/look geometry, frequency, polarization/frequency group, product maturity/baseline, CRS/grid, nodata, units and quality coverage. Correct input selection; do not disable checks merely to force a result.

## 8. Result exists but map is blank

Check result export status and storage access. For COG rendering, verify range requests and headers:
- API/export endpoint returns 206 for a byte-range request;
- frontend gateway forwards the Range header and exposes Content-Range/Accept-Ranges;
- browser can fetch the same-origin artifact;
- COG metadata contains supported CRS, transform and overviews.

MapLibre is a renderer, not a basemap provider. Tile service availability and attribution are separate from FLAGWA's result raster.

## 9. Earthscore only shows an aggregate or has gaps

The read-only artifact bridge may be disabled or prepared before/after result roles unavailable. The feature intentionally falls back to a clearly labelled reported aggregate where possible. Missing data appear as gaps, not zeros. Check bridge settings, SELECT-only database access, approved artifact roles and shared storage. Do not point the bridge at an arbitrary filesystem root.

## 10. Radar Lab shows unavailable observations

Concept mode is intentionally qualitative. Observation mode requires real result/scene records and metadata. Confirm that a completed result exists, product inspection is available and the requested asset has a valid byte-range response. A concept illustration must not substitute for a real observation.

## 11. Context is unavailable

Check context registry, source status, dataset coverage/CRS and import logs. Some providers require separate credentials or have licensing restrictions. HTTP 424 or a missing layer must remain unavailable; it is not population=0, rainfall=0 or road_count=0.

## 12. Storage fills or files disappear after restart

Check free disk and configured storage backend. Compose uses named volumes; containers may be replaced without the volume, but deleting the volume deletes data. Render's ephemeral filesystem is not durable. Configure an actual persistent S3-compatible bucket and backup/retention policy before production use.

## 13. Safe diagnostic bundle

Collect only non-secret information:
- application version and branch/commit;
- OS, Python and Node versions;
- exact command and exit code;
- relevant request ID and timestamp;
- sanitized error code/message;
- health endpoint outcomes;
- job/result ID if non-sensitive;
- whether provider credentials are configured (never their values).

Never attach `.env`, bearer tokens, private object URLs, unredacted connection strings or raw private products to an issue.
