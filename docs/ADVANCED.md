# Scientific Workflows And Operations

All six analysis routes execute asynchronous jobs. The five advanced themes are **experimental, operational=false**,
and have software tests using explicitly synthetic fixtures, not verified demonstrations at all eight research locations.
Nothing here claims independently validated floods, deforestation, crop yield, glacier speed in map coordinates or vertical subsidence.

## Product And Output Contracts

| Theme | Required Product | Method | Output / Limit |
| --- | --- | --- | --- |
| Flood | Two comparable GCOVs | Absolute power level, temporal dB decrease, quality, permanent water, optional slope | Potential new inundation; never depth |
| Forest | Two comparable dual-polarization GCOVs | Valid-power spatial averaging, co/cross decreases within a forest mask, minimum connected area | Disturbance candidates; optional supporting forest-loss agreement, not deforestation proof |
| Agriculture | At least three ordered GCOVs | Per-pixel dated regression, temporal standard deviation/range and observation count on agricultural land | Descriptive dB/day and dB patterns; not yield, moisture or drought attribution |
| Wildfire | Two comparable dual-polarization GCOVs | Radar-change RMS within a documented perimeter, requiring optical burn support | Fire-associated candidates; not burn severity |
| Glacier | One GOFF containing a reference/secondary pair | Source-unit offsets, quality filtering, glacier mask and actual temporal baseline | Along-track/slant-range offsets in m and radar-coordinate magnitude/rate; not horizontal/3D speed |
| Deformation | One GUNW containing a reference/secondary pair | Actual frequency/wavelength, radian phase, coherence, connected components, stable reference and supplied phase corrections | Referenced apparent LOS m; not vertical subsidence or a deformation time series |

Advanced processors require actual HDF5 identity and reject reported input exceptions/diagnostic modes.
Signed phase/offset values and valid zeros are preserved. Explicit HDF5 creation fill values are distinguished from default zero.
Selected GOFF measurement/quality paths must share an estimator layer. Mixed frequency/polarization groups are rejected.
Every COG records its band units and georeferencing. GeoJSON from continuous products describes measurement coverage, not impact area;
the exposure endpoint rejects it as a candidate-change polygon.

## Discover And Select Actual Layers

First search and acquire the appropriate actual products. Do not choose the first two archive results automatically.

```bash
curl -sS "http://localhost:8000/api/v1/scenes/$SCENE_ID/inspection?contains=Phase&limit=100"
```

Inspection returns `dataset_path`, dimensions, dtype, fill values and sanitized attributes. These are internal paths in the
satellite product, not server filesystem paths. Use the returned actual datasets; no universal GOFF/GUNW internal path is assumed.

To acquire both GCOV co- and cross-polarization without downloading the complete source product:

```bash
curl -sS -X POST "http://localhost:8000/api/v1/scenes/$SCENE_ID/download" \
  -H "X-Admin-Key: $ADMIN_API_KEY" -H 'Content-Type: application/json' \
  -d '{"mode":"aoi_subset","location_slug":"kuttanad","polarization":"HHHH","additional_polarizations":["HVHV"],"frequency_group":"A","max_remote_mib":128,"replace_existing":true}'
```

Review `replace_existing` deliberately. It does not replace an active transfer. Old content-addressed raw objects remain intact.
Each completed acquisition job records its actual manifest, byte counts, SHA-256 scope, selected layers and AOI.
SHA-256 of a derivative is not a complete-source-file checksum. GOFF/GUNW currently require full authorized product acquisition.

## Theme Requests

Use `/docs` to fill the exact typed body, or send JSON to `/api/v1/analysis/{theme}` with `X-Admin-Key`.
Placeholders below must be replaced with real returned scene IDs, registered layer IDs and actual inspected dataset paths.
Numeric thresholds are configuration examples, not measured values or independently validated regional rules.

Forest body:

```json
{
  "location_slug":"<configured_location>",
  "before_scene_id":"<actual_before_id>",
  "after_scene_id":"<actual_after_id>",
  "polarization":"HHHH",
  "cross_polarization":"HVHV",
  "frequency_group":"A",
  "landcover_layer_id":"<registered_landcover_uuid>",
  "forest_classes":[10],
  "parameters":{
    "quality_valid_values":[1],
    "quality_rule_source":"Replace with actual inspected product mask semantics and reviewed codes",
    "scientific_basis":"Exploratory dual-channel forest response; calibration and independent validation pending"
  }
}
```

ESA WorldCover class 10 is tree cover and class 40 is cropland; never assume those codes for a different dataset.
HHHH/HVHV and VVVV/VHVH must be matched transmit-polarization pairs. Optional `independent_validation_layer_id` and
`forest_loss_positive_values` compute supporting agreement, not approval. A separately held-out reference is required for formal review.

Wildfire uses the same explicit scene/channel selection plus required `burn_perimeter_layer_id` (`fire_perimeter`),
`optical_burn_layer_id` (`optical_burn`, class raster with 1 meaning burn support), and `event_datetime`.
The documented event must fall strictly between actual acquisitions. Parameters include reviewed quality codes,
`quality_rule_source`, `scientific_basis`, optional positive `minimum_change_db`, odd `smoothing_kernel` and minimum component pixels.
Only radar changes agreeing with both context masks become candidates; the remainder are not automatically a burn scar.

Agriculture body:

```json
{
  "location_slug":"<configured_location>",
  "scene_ids":["<actual_first_id>","<actual_second_id>","<actual_third_id>"],
  "landcover_layer_id":"<registered_landcover_uuid>",
  "agriculture_classes":[40],
  "parameters":{
    "quality_valid_values":[1],
    "quality_rule_source":"Replace with actual inspected quality-mask codes and source",
    "scientific_basis":"Descriptive dated surface-response series, not crop yield or soil moisture",
    "minimum_observations":3,
    "minimum_span_days":24
  }
}
```

Supply ordered distinct compatible acquisitions; per-pixel valid dates must also meet the span. `rainfall_layer_id` is optional
supporting provenance, not a causal inference. No annual seasonal model is inferred from an undersampled season and no SME2 soil-moisture result is invented.

Glacier body:

```json
{
  "location_slug":"<configured_location>",
  "scene_id":"<actual_goff_id>",
  "along_track_dataset":"<actual_inspected_dataset_path>",
  "slant_range_dataset":"<actual_inspected_dataset_path>",
  "quality_dataset":"<actual_inspected_dataset_path>",
  "glacier_layer_id":"<registered_glacier_extent_uuid>",
  "parameters":{
    "quality_metric":"correlation",
    "minimum_quality":0.5,
    "quality_rule_source":"Replace with documented quality metric, units and reviewed threshold",
    "scientific_basis":"Quality-screened radar-coordinate motion, with independent movement validation pending"
  }
}
```

Actual product identification must contain reference and secondary acquisition times. Pixel-valued offsets require actual
`along_track_pixel_spacing_m`, `slant_range_pixel_spacing_m` and `pixel_spacing_source`. Output-grid spacing is not a substitute.
Raw GOFF can contain outliers: quality filtering and candidate rates are not an independently validated glacier motion field.

Deformation body:

```json
{
  "location_slug":"<configured_location>",
  "scene_id":"<actual_gunw_id>",
  "phase_dataset":"<actual_inspected_radian_phase_path>",
  "coherence_dataset":"<actual_inspected_coherence_path>",
  "connected_components_dataset":"<actual_inspected_component_path>",
  "center_frequency_dataset":"<actual_inspected_scalar_Hz_path>",
  "phase_correction_layer_ids":[],
  "parameters":{
    "reference_point":["<actual_longitude>","<actual_latitude>"],
    "reference_justification":"Replace with evidence for a coherent, stable reference location",
    "phase_to_range_sign":-1,
    "phase_convention_source":"Replace with the actual provider phase convention; sign is not universal",
    "correction_assessment":"Record atmospheric, orbital, tidal and unwrapping limitations; no correction assumed"
  }
}
```

Longitude/latitude placeholders must be numeric values. Wavelength is calculated from an actual Hz-valued product scalar,
not a hardcoded nominal wavelength. The coherent reference component is retained; other disconnected components are excluded.
Only registered `phase_correction` radian grids are subtracted. GUNW ionospheric/tropospheric/tidal corrections are not assumed applied.
Positive range increase/away convention depends on the explicitly documented `phase_to_range_sign`.

## Independent Validation

Register a separate `independent_validation` class raster. Provenance must include:

```json
{
  "validation_evidence":{
    "target":"potential_inundation",
    "sensor":"<actual_independent_sensor>",
    "observation_datetime":"<actual_reference_UTC_datetime>",
    "independent_of_nisar":true,
    "mapping_method":"Describe the actual independent mapping and its uncertainty"
  }
}
```

Targets also include `forest_disturbance_candidates` and `fire_associated_radar_optical_candidates`.
Use `POST /api/v1/results/{result_id}/validation` to queue a review job. It requires reference positive codes,
`minimum_iou`, `minimum_precision`, `minimum_recall`, reviewer identity/notes and an independence statement.
Defaults additionally require 100 valid pixels, positive reference evidence, 90 percent coverage and a reference within three days;
review these tolerances for the actual scientific question rather than treating them as universal calibration.

With `approve:false`, metrics and provenance are recorded without validation approval. Approval additionally requires all checklist fields
(`temporal_alignment`, `reference_independence`, `geometry_quality`, `classification_review`, `uncertainty_review`) explicitly true,
passing metrics/coverage criteria, an independent target-matched reference, and no synthetic data.
Input masks cannot be reused as held-out validation. Empty/no-positive comparisons do not become perfect validation.
Mark software fixtures and simulated context observations with `is_synthetic:true`; this propagates through outputs and blocks approval.
The term "synthetic aperture radar" in a genuine sensor/source name is not a fixture marker.
Continuous offsets, LOS and agricultural trends require different validation methods and cannot be approved by binary IoU.

Review history and reference SHA-256 are stored, and summaries receive versioned review objects. Original rasters/GeoJSON remain immutable;
their embedded status is the creation-time status. Current result status and review history are authoritative for later approval.
No genuine result in this workspace was independently approved merely because its job or tests passed.

## Context Acquisition

```bash
python -m app.cli.fetch_context --provider osm --layer settlements --location kuttanad --import
python -m app.cli.fetch_context --provider osm --layer infrastructure --location kuttanad --import
python -m app.cli.fetch_context --provider osm --layer hydrology --location kuttanad --import
python -m app.cli.fetch_context --provider worldpop --country IND --location kuttanad
python -m app.cli.fetch_context --provider worldcover --location kuttanad
python -m app.cli.fetch_context --provider dem --location kuttanad
python -m app.cli.fetch_context --provider boundaries --country IND --boundary-level ADM2 --location kuttanad
python -m app.cli.fetch_context --provider rainfall --location kuttanad
```

Discovery does not download entire satellite/country archives. Explicit raster import requires an actual `--item-id`, `--asset-key`,
verified `--units`, and actual license/version (with reviewed `--license` / `--version` overrides when providers omit them).
Bounded windows are read through Rasterio; Planetary Computer signing stays server-side and signed URLs are not exposed.
Population requires count-per-pixel units, not a density raster. Use matching ISO alpha-3 countries for other locations.
IMERG discovery returns actual collections, or actual granules when `--collection-id`, `--start` and `--end` are supplied.
Authorized NetCDF processing and rainfall resampling may still require product-specific offline preparation before context registration.

The real imported WorldCover item was `ESA_WorldCover_10m_2021_v200_N09E075`, asset `map`, version `v200`, CC-BY-4.0.
This is historical land cover, not contemporary flood validation. OSM/WorldPop outages are reported and do not generate substitute data.

## Review Or Replace An AOI

```bash
python -m app.cli.set_aoi reviewed-boundary.geojson --metadata actual-boundary-provenance.json --reviewed-by ACTUAL_OPERATOR_ID
```

Metadata uses the normal context schema with `layer_type=boundaries`, actual source/license/version, WGS84 CRS and vector units.
Use `--feature-id` for a multi-feature collection. The CLI refuses active related jobs, keeps old source records,
and records the selected geometry plus review identity/time. New jobs snapshot their AOI and boundary provenance.
ASF discovery can use a bounding box around a complex reviewed boundary; processing preserves its actual holes/multipolygons.
Cached AOI acquisitions must still cover the new study area and requested covariance layers.

## Recovery And Cleanup

Run one Celery beat scheduler. Defaults are a 20-second heartbeat, renewable 120-second lease and 180-second stale-execution threshold.
Reconciliation runs every 60 seconds. It never fails a live lease or silently repeats an expensive task.
Queued message-loss detection defaults to one hour and requires no broker backlog, active execution or job lease.

```bash
python -m app.cli.maintenance reconcile
python -m app.cli.maintenance cleanup
python -m app.cli.maintenance cleanup --older-hours 24 --apply
```

Cleanup defaults to dry-run, requires a finite age of at least one hour, refuses active jobs and only selects old `.partial` files.
It does not delete complete raw/context/processed files. Admin `POST /api/v1/jobs/{job_id}/retry` creates a new job with `_retry_of`
and deduplicates active retries; the original terminal history is not rewritten. Failed replacements keep an older completed acquisition available.

## Optional Interpreter

Set `AI_ENABLED=true`, `AI_PROVIDER=openai`, a real `AI_MODEL` and `AI_API_KEY` only in the private environment to opt in.
`GET /api/v1/results/{result_id}/interpretation` is admin-protected and rate-limited. Disabled, unconfigured or unavailable providers
fall back to deterministic recorded facts. The model can select only enumerated clause IDs; all displayed dates, measurements, review status
and warnings are rendered by the server from stored records. Arbitrary model-generated numbers or disaster claims cannot be published.
The scientific API and worker do not depend on the AI provider. Live AI access was not tested without an authorized key/model.