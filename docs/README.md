# FLAGWA Documentation

This documentation covers the complete research application: scientific processing, web experiences,
data provenance, configuration, deployment and development. The root [README](../README.md) is the
short project overview. Commands are run from the repository root unless stated otherwise.

## Start Here

| Audience or task | Recommended path |
| --- | --- |
| First-time developer | [Getting Started](GETTING_STARTED.md), then [Development](DEVELOPMENT.md) |
| Researcher or reviewer | [User Guide](USER_GUIDE.md), [Scientific Workflows](ADVANCED.md), [API](API.md) |
| Frontend contributor | [Architecture](ARCHITECTURE.md), [Frontend Reference](../frontend/README.md) |
| Backend contributor | [Architecture](ARCHITECTURE.md), [Backend Reference](BACKEND.md), [API](API.md) |
| Deployment operator | [Configuration](CONFIGURATION.md), [Deployment And Operations](DEPLOYMENT.md) |

## Guide Map

- [Getting Started](GETTING_STARTED.md): prerequisites, private settings, containers, native Python,
  frontend startup, health checks and obtaining the first real result.
- [Architecture](ARCHITECTURE.md): service responsibilities, trust boundaries, jobs, storage,
  artifact publication and frontend state/rendering.
- [User Guide](USER_GUIDE.md): routes, maps, evidence, workbench, Radar Lab, Groundwire and Earthscore.
- [Configuration](CONFIGURATION.md): public versus private variables, database URLs, credentials,
  provider settings, storage and optional artifact bridge.
- [Deployment And Operations](DEPLOYMENT.md): Docker/Render, HTTPS, persistent artifacts, backups,
  job recovery, temporary tunnels and troubleshooting.
- [Development And Testing](DEVELOPMENT.md): dependencies, conventions, test tiers, safe fixtures,
  CI and contribution checks.
- [Backend Reference](BACKEND.md): detailed backend setup, source adapters, processing and operational commands.
- [API Reference](API.md): existing routes, envelopes, errors, acquisition and result contracts.
- [Scientific Workflows](ADVANCED.md): theme-specific requirements, interpretation, validation and recovery.
- [Frontend Reference](../frontend/README.md): feature internals, deterministic Earthscore mappings,
  gateway adapters, frontend hosting and browser acceptance details.

## Evidence And Maturity

The following are implementation records, not continuously refreshed live system inventories:

| Record | Scope |
| --- | --- |
| [COMPLETION.md](COMPLETION.md) | Backend completion-stage report and verification limits |
| [VERIFICATION.md](VERIFICATION.md) | Historical initial backend genuine-data verification |
| [AUDIT.md](AUDIT.md) | Original repository/data readiness audit |

Location metadata, registered context and result counts depend on the running database. Use the API's
actual result records and validation status; do not infer that all eight research locations have
compatible acquisitions, reviewed boundaries or completed analyses. Test fixtures establish software
behavior only. A provider's `VALIDATED` product maturity is not independent validation of a FLAGWA result.

## Sources Of Truth

1. The running backend's `/openapi.json` and typed request schemas define supported operations.
2. Result metadata records the actual scenes, dates, methods, parameters and scientific caveats.
3. Current database-backed job/result states determine execution and review status.
4. Dependency manifests and deployment files define executable setup, not a remembered local session.

No guide should contain real credentials, signed object URLs, private storage paths or copied remote
products. Examples use placeholders, and scientific thresholds must be reviewed for the actual study.