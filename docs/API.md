# API Contract

Base URL: `http://localhost:8000`. Interactive OpenAPI: `/docs`; JSON schema: `/openapi.json`.
Current contract: **45 paths**. Advanced request examples and mandatory scientific prerequisites are in [ADVANCED.md](ADVANCED.md).
Application routes use `/api/v1`; health routes deliberately do not. Lists are ordered and bounded where records can grow.
Binary exports return files, not a JSON envelope. UUID/identifier placeholders below are templates, not real measurements or fabricated observations.
COG exports support HTTP byte ranges. Configured frontend origins may send `Range`/`If-Range` and read `Content-Range`, `Accept-Ranges` and `ETag`.

## Responses

```json
{"success":true,"data":{"status":"alive"},"message":"Request completed","meta":{"request_id":"<request_uuid>","timestamp":"<actual_utc_timestamp>"}}
```

```json
{"success":false,"error":{"code":"SCENE_NOT_FOUND","message":"Requested scene was not found in the local catalogue"},"meta":{"request_id":"<request_uuid>","timestamp":"<actual_utc_timestamp>"}}
```

Use HTTP status as well as `success`. Invalid inputs return `422`; absent records `404`; incompatible state `409`;
missing context `424`; unsupported job types `501`; provider errors `502/503`; rate limiting `429`.
Provider failures are not hidden as successful empty search results.

## Routes

| Method | Path | Purpose / Access |
| --- | --- | --- |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Database, PostGIS, migration, Redis and staging readiness |
| GET | `/health/providers` | Configuration and scientific capability status, not a fresh live-provider test |
| GET | `/api/v1/locations` | Research locations; `limit`, `offset` |
| GET | `/api/v1/locations/{slug}` | AOI and location context |
| GET | `/api/v1/locations/{slug}/availability` | Known cached scenes/results, not a compatible-pair claim |
| GET | `/api/v1/case-studies` | Research questions and unverified data status |
| GET | `/api/v1/case-studies/{slug}` | Single research case |
| POST | `/api/v1/catalog/nisar/search` | Public, rate-limited real provider discovery and persistence |
| GET | `/api/v1/catalog/nisar/scenes/{scene_id}` | Known scene; sanitized trace metadata |
| POST | `/api/v1/catalog/nisar/compatibility-check` | Metadata/grid prerequisites, warnings/blockers |
| POST | `/api/v1/scenes/{scene_id}/download` | Admin; full product or explicit AOI subset; returns `202` job |
| GET | `/api/v1/scenes/{scene_id}/download-status` | Transfer state and latest job |
| GET | `/api/v1/scenes/{scene_id}` | Scene details alias |
| GET | `/api/v1/scenes/{scene_id}/inspection` | Actual in-product dataset paths, units and shapes; never server filesystem paths; `contains`, `limit`, `offset` |
| POST | `/api/v1/analysis/flood` | Admin; asynchronous potential-inundation workflow |
| POST | `/api/v1/analysis/forest` | Admin; queued dual-polarization GCOV disturbance candidates; experimental |
| POST | `/api/v1/analysis/agriculture` | Admin; queued GCOV time-series response on agricultural land; experimental |
| POST | `/api/v1/analysis/glacier` | Admin; queued quality-screened GOFF radar-coordinate offsets/rates; experimental |
| POST | `/api/v1/analysis/wildfire` | Admin; queued GCOV changes constrained by perimeter and independent optical burn evidence; experimental |
| POST | `/api/v1/analysis/deformation` | Admin; queued referenced GUNW apparent LOS displacement; experimental |
| GET | `/api/v1/jobs` | Database jobs; `limit`, `offset` |
| GET | `/api/v1/jobs/{job_id}` | Full job status, safe error and parameters |
| GET | `/api/v1/jobs/{job_id}/status` | Polling alias |
| POST | `/api/v1/jobs/{job_id}/cancel` | Admin; cooperative cancellation |
| POST | `/api/v1/jobs/{job_id}/retry` | Admin; failed/cancelled jobs create a new execution, deduplicating active retries |
| GET | `/api/v1/results` | Results belonging only to completed jobs; `limit`, `offset` |
| GET | `/api/v1/results/{result_id}` | Statistics, scientific status and provenance |
| GET | `/api/v1/results/{result_id}/statistics` | Measured computed statistics |
| GET | `/api/v1/results/{result_id}/metadata` | Scientific lineage without private object keys/URLs |
| POST | `/api/v1/results/{result_id}/validation` | Admin; queued independent-reference assessment and explicitly gated review |
| GET | `/api/v1/results/{result_id}/interpretation` | Admin, rate-limited; verified clauses with optional AI selection and deterministic fallback |
| GET | `/api/v1/results/{result_id}/preview` | PNG |
| GET | `/api/v1/community/{location_slug}/population` | Registered population provenance, or `424` |
| GET | `/api/v1/community/{location_slug}/settlements` | Registered settlement provenance, or `424` |
| GET | `/api/v1/community/{location_slug}/infrastructure` | Registered infrastructure provenance, or `424` |
| GET | `/api/v1/community/{location_slug}/landcover` | Registered land-cover provenance, or `424` |
| GET | `/api/v1/community/{location_slug}/hydrology` | Registered water-feature provenance |
| GET | `/api/v1/community/{location_slug}/permanent_water` | Registered permanent-water provenance |
| GET | `/api/v1/community/{location_slug}/rainfall` | Registered rainfall provenance |
| GET | `/api/v1/community/{location_slug}/boundaries` | Registered administrative-boundary provenance |
| GET | `/api/v1/community/{location_slug}/exposure` | `result_id` UUID required; optional `distance_m` 0-5000 and reviewed `agriculture_class`; per-layer methods/limits |
| GET | `/api/v1/exports/{result_id}/geojson` | Generated candidate polygons, RFC 7946 longitude/latitude |
| GET | `/api/v1/exports/{result_id}/geotiff` | Generated georeferenced classification COG |
| GET | `/api/v1/exports/{result_id}/summary` | Source-grounded deterministic JSON summary |

Administrative writes accept `X-Admin-Key`. Never distribute this secret in frontend JavaScript. Development without a configured
key accepts direct loopback only. Exports are public research artifacts of existing completed result records, not arbitrary object-storage access.
No public upload or remote-URL download parameter exists.

## Examples

```bash
curl -sS http://localhost:8000/health/ready
curl -sS http://localhost:8000/api/v1/locations
curl -sS http://localhost:8000/api/v1/case-studies/kuttanad
curl -sS http://localhost:8000/api/v1/locations/kuttanad/availability
```

Location availability returns `location`, `known_catalogue_scenes`, `completed_results`, `availability_status`,
`operational_claim:false` and a note distinguishing cached observations from validated science.
The other locations must not be rendered as operational based solely on the presence of a case-study record.

Search validated maturity first; search provisional separately:

```bash
curl -sS -X POST http://localhost:8000/api/v1/catalog/nisar/search \
  -H 'Content-Type: application/json' \
  -d '{"bbox":[76.25,9.20,76.55,9.50],"start":"2026-10-21T00:00:00Z","end":"2026-11-14T23:59:59Z","product_type":"GCOV","data_maturity":"VALIDATED","frequency":"L","limit":25,"offset":0}'
```

Alternatively supply `aoi` as a valid WGS84 GeoJSON Polygon (no holes, at most 400 vertices), not both AOI and bbox.
Filters include dataset, product, maturity, orbit direction, main/side frequency-group polarization, relative orbit,
frame and full/partial frame coverage. Limit <= 100; offset <= 400. `meta.has_more` is a bounded provider indication,
not a claim of a stable archival snapshot while paginating. Unknown scene fields remain null.

An actual scene identity returned during this implementation audit was:

```json
{"scene_id":"NISAR_L2_PR_GCOV_034_077_D_084_4005_DHDH_A_20261029T132026_20261029T132100_P05036_N_F_J_001","dataset":"NISAR","product_type":"GCOV","data_maturity":"VALIDATED","acquisition_datetime":"2026-10-29T13:20:26+00:00","frequency":"L","polarizations":["HH","HV"],"flight_direction":"DESCENDING","source":"ASF"}
```

This is an abbreviated actual record, not the complete response. Preserve returned IDs rather than deriving them from display dates.
Original provider metadata are stored privately. Public metadata remove resource URLs, secrets and filesystem/object keys.

For the next examples, set shell variables to actual discovered IDs and generated UUIDs. They are not invented example results.

```bash
curl -sS -X POST "http://localhost:8000/api/v1/scenes/$SCENE_ID/download" \
  -H "X-Admin-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"mode":"aoi_subset","location_slug":"kuttanad","polarization":"HHHH","frequency_group":"A","max_remote_mib":128}'
curl -sS "http://localhost:8000/api/v1/scenes/$SCENE_ID/download-status"
curl -sS "http://localhost:8000/api/v1/jobs/$JOB_ID/status"
```

A queued job returns `data.id`, `job_type`, `status:"QUEUED"`, progress, input IDs, parameters and actual timestamps.
Poll until `COMPLETED`, `FAILED` or `CANCELLED`; never interpret a failed job as a result.
An empty download body requests a full product subject to size/disk limits. Large products may exceed several gigabytes.
For forest/wildfire AOI derivatives, add `"additional_polarizations":["HVHV"]` when using HHHH, or the appropriate actual cross term.
An existing completed acquisition is reused unless `"replace_existing":true` is explicitly supplied. Active transfers are never replaced.
Raw objects are content-addressed, old files remain intact, and completed download jobs retain their acquisition manifests.
Changing a study AOI does not silently enlarge an old subset: missing coverage or layers blocks analysis until explicit reacquisition.

Compatibility body:

```json
{"before_scene_id":"<exact_before_id>","after_scene_id":"<exact_after_id>","location_slug":"kuttanad","polarization":"HHHH","frequency_group":"A"}
```

The response has `compatible`, `warnings`, `blockers` and `checks`. Missing catalogue look direction is a blocker until actual
HDF5 inspection supplies it. Common AOI coverage must be at least 98%; maturity/release/geometry must be compatible.

Flood analysis body (template; replace IDs and review every scientific parameter):

```json
{
  "before_scene_id":"<exact_before_id>",
  "after_scene_id":"<exact_after_id>",
  "location_slug":"kuttanad",
  "polarization":"HHHH",
  "frequency_group":"A",
  "permanent_water_layer_id":"<registered_layer_uuid>",
  "parameters":{
    "after_db_max":-17,
    "change_db_max":-3,
    "before_db_min":-14,
    "threshold_basis":"Exploratory values, not local calibration; independent validation pending",
    "quality_valid_values":[1,2,3],
    "quality_rule_source":"Actual product specification and reviewed valid subswath codes",
    "permanent_water_values":[1],
    "max_slope_degrees":5
  }
}
```

Post to `/api/v1/analysis/flood` with the administrative header. These codes and thresholds are templates, not universal NISAR rules.
Optional `slope_layer_id` must identify a degree-valued slope raster belonging to the same location.
Computed results expose class counts, candidate area, valid-pixel counts, dB statistics, grid resolution and method limitations.
All outputs include actual scene IDs/dates, algorithm version, parameters, validation sources and uncertainty notes.

```bash
curl -sS "http://localhost:8000/api/v1/results/$RESULT_ID"
curl -sS "http://localhost:8000/api/v1/results/$RESULT_ID/statistics"
curl -sS "http://localhost:8000/api/v1/results/$RESULT_ID/metadata"
curl -sS "http://localhost:8000/api/v1/community/kuttanad/exposure?result_id=$RESULT_ID&distance_m=100"
curl -f -o candidates.geojson "http://localhost:8000/api/v1/exports/$RESULT_ID/geojson"
curl -f -o classification.tif "http://localhost:8000/api/v1/exports/$RESULT_ID/geotiff"
curl -sS "http://localhost:8000/api/v1/exports/$RESULT_ID/summary"
```

Result responses have `validation_status:"pending_validation"` regardless of whether job progress reached 100.
Community-layer responses contain ID, source, version and provenance. Missing layers return `CONTEXT_NOT_AVAILABLE`, not zero people.
Exposure responses list each source, spatial method, coverage/resolution where applicable, units and limitations.
The preview is a PNG with class colors; the legend is included in result metadata. Downloads refer only to existing completed result records.