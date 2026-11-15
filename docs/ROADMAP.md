# Roadmap & Research Agenda

> This file describes proposed work. Roadmap items are not delivered capabilities until code, tests, documentation and validation evidence exist.

## North-star

Make FLAGWA a dependable way to move from a real place and a real NISAR observation to a reproducible, understandable and appropriately cautious account of surface change.

## Track 1 — Kuttanad scientific validation

**Priority: critical.** The flagship candidate is pending validation.

| Work item | Acceptance evidence |
|---|---|
| Replace draft AOI rectangle | Reviewed polygon, source/citation, CRS, version and review record |
| Reassess observation pair | Full scene metadata, maturity, CRID/baseline, geometry, overlap and dataset compatibility report |
| Improve water baseline | Date-aware permanent/seasonal water assessment and documented uncertainty |
| Add optical comparison | Cloud-screened independent imagery near both SAR dates, attribution and limitations |
| Add hydrology/rainfall evidence | Actual raster/series or official dated records, with timestamps and quality |
| Add agricultural interpretation | Cropping calendar, land-use classes and field/management context |
| Add independent validation | Reviewer, sampled reference points/polygons, omission/commission analysis and limitations |
| Publish a reviewable result | Reproducible manifest, parameters, source checksums, validation sources and approval state |

A candidate should not become a confirmed flood/inundation result solely because an algorithm returns pixels or an operator changes a status field.

## Track 2 — Scientific maturity for other themes

Each theme needs its own algorithm, data contract, validation protocol and operational decision. Reusing flood thresholds or styling is not sufficient.

- **Forest:** distinguish biomass/seasonal/phenological response from disturbance; validate with time-matched optical, forest masks and independent records.
- **Agriculture:** build multi-date analysis around actual crop cycle and field masks; distinguish radar response from yield or direct soil-moisture measurement.
- **Wildfire:** separate active-fire/perimeter timing, vegetation recovery and radar response; validate with burn perimeters and optical burn evidence.
- **Glacier:** assess GOFF quality/outliers, pixel-to-metre conversion, vector semantics and independent velocity products; do not call offset rate retreat.
- **Deformation:** validate reference-point stability, phase unwrapping, atmospheric/orbit/tidal corrections and independent geodetic measurements; LOS is not vertical motion.
- **Soil moisture:** use SME2 only when actual suitable product data are available; do not relabel GCOV backscatter as a soil-moisture estimate.

**Gate:** a theme becomes operational only after compatible live data have been processed, independent validation documented, uncertainty characterised and the capability registry updated.

## Track 3 — Context and community relevance

- Obtain suitable population, settlement, roads, land-use, elevation, drainage and hydrology layers.
- Record provider, product/version, acquisition/update date, CRS, resolution, licence, coverage and ingest checksums.
- Use spatial joins/intersections with appropriate geometry semantics and exposure denominators.
- Show data age, gaps, uncertainty and scale mismatch in the UI.
- Never report population-at-risk from an unvalidated candidate polygon or stale/context-poor layer.

## Track 4 — Product experience

- Strengthen the guided Kuttanad story with actual scene dates, method notes and clear validation state.
- Improve comparison onboarding so users understand why two scenes may or may not be comparable.
- Add study areas only with a meaningful research question, compatible observations, appropriate AOIs and context.
- Continue accessibility work for keyboard use, reduced motion, contrast, alt text and semantic data alternatives.
- Expand exports with citations, units, dates, source identifiers, processing version and caveats.

## Track 5 — Platform reliability and scale

- Validate real S3-compatible storage with cross-service access and retention lifecycle.
- Deploy API, workers, scheduler and frontend to a durable hosted environment; verify HTTPS, CORS and secrets.
- Add operational metrics, structured tracing, job alerts and reviewed retry/recovery workflows.
- Test database backups and restore from a clean environment.
- Scale GeoTIFF delivery and map tile generation for larger COGs and concurrent readers.
- Consider distributed rate limits and centralised operator identity before multi-instance deployments.
- Add dependency update policy and security scanning.

## Track 6 — Open-source readiness

- Select and add a software licence after confirming ownership and third-party notices.
- Add a contribution guide, code of conduct and security reporting route.
- Publish supported Python/Node versions and reproducible CI.
- Separate code licence from data/image licence and document attribution per provider.
- Version scientific methods and result schemas; provide migration/reproducibility guidance.

## Suggested release gates

| Gate | Required evidence |
|---|---|
| R1 — Reproducible local product | Clean clone, install, migration, start, health checks, frontend build and tests |
| R2 — Kuttanad candidate review | Reviewed AOI, compatible scenes, validation evidence and documented interpretation |
| R3 — Public read-only deployment | HTTPS, durable artifacts, monitored API, CORS and no public write credentials |
| R4 — Operational science theme | Independent data validation, scientific review, uncertainty assessment and operational capability declaration |
| R5 — Multi-study platform | Every listed study area has actual evidence and a separate readiness state |

## Decision rule

A feature is ready to advertise only when its user workflow works, its data provenance is visible, failure/unavailable states are meaningful, and its scientific interpretation is no stronger than the evidence.
