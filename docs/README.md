# FLAGWA Documentation

> **A field guide to the product, the science, and the platform.**

FLAGWA is a place-led NISAR research application. This documentation is designed for three audiences: a first-time user trying to understand the experience, a scientific reviewer assessing the evidence, and a developer who needs to operate or extend the system.

Commands are written from the repository root unless a guide says otherwise. Product claims describe the committed implementation; current availability and result status must be checked against the running system.

## Start with the story

1. Read the root [README](../README.md) for the product purpose and Kuttanad case study.
2. Read the [User Guide](USER_GUIDE.md) to understand experiences and the end-to-end research workflow.
3. Read [Scientific Workflows](ADVANCED.md) before interpreting a map or measurement.
4. Follow [Getting Started](GETTING_STARTED.md) to run the stack.
5. Use [Architecture](ARCHITECTURE.md), [API](API.md) and [Backend Reference](BACKEND.md) for implementation details.

## Documentation by audience

| Audience | Recommended reading order |
|---|---|
| NASA Space Apps reviewer | [Product story](../README.md) → [Kuttanad research](KUTTANAD_STUDY.md) → [Scientific workflows](ADVANCED.md) → [Evidence and verification](COMPLETION.md) |
| First-time user | [User Guide](USER_GUIDE.md) → [Scientific workflows](ADVANCED.md) |
| New developer | [Getting Started](GETTING_STARTED.md) → [Architecture](ARCHITECTURE.md) → [Development](DEVELOPMENT.md) |
| Frontend developer | [Architecture](ARCHITECTURE.md) → [Frontend Reference](../frontend/README.md) |
| Backend developer | [Architecture](ARCHITECTURE.md) → [Backend Reference](BACKEND.md) → [API](API.md) |
| Researcher / remote-sensing reviewer | [Kuttanad Study](KUTTANAD_STUDY.md) → [Scientific workflows](ADVANCED.md) → [Data Sources](DATA_SOURCES.md) |
| Deployment operator | [Configuration](CONFIGURATION.md) → [Deployment](DEPLOYMENT.md) → [Troubleshooting](TROUBLESHOOTING.md) |
| Contributor | [Development](DEVELOPMENT.md) → [Open-source status](OPEN_SOURCE.md) |

## Guides

### Product and research

- [Kuttanad Study](KUTTANAD_STUDY.md) — flagship geography, research question, observed evidence, hypothesised drivers, limitations and validation plan.
- [User Guide](USER_GUIDE.md) — Story, Explorer, Radar Lab, Groundwire, Earthscore and workbench workflows.
- [Scientific Workflows](ADVANCED.md) — NISAR product concepts, inputs, theme-specific methods, uncertainty and validation gates.
- [Data Sources & Attribution](DATA_SOURCES.md) — dataset/provider roles, provenance fields, licensing and citation expectations.
- [Roadmap & Research Agenda](ROADMAP.md) — proposed next steps, dependencies and acceptance criteria.

### Engineering

- [Getting Started](GETTING_STARTED.md) — prerequisites, secrets, Docker Compose, frontend, native setup and first analysis.
- [Architecture](ARCHITECTURE.md) — system components, source layout, sequence and trust boundaries.
- [API Reference](API.md) — REST operations, schemas, response envelopes and errors.
- [Backend Reference](BACKEND.md) — services, CLI operations, processing and worker operations.
- [Frontend Reference](../frontend/README.md) — routes, query/state model, map rendering, Earthscore, Radar Lab and server gateway.
- [Configuration & Security](CONFIGURATION.md) — environment variables, credentials, storage and security model.
- [Deployment & Operations](DEPLOYMENT.md) — Docker, Render blueprint, durable storage, health, logs, backups and recovery.
- [Development & Testing](DEVELOPMENT.md) — test tiers, CI, code conventions and contribution workflow.
- [Troubleshooting](TROUBLESHOOTING.md) — diagnostics for common local/provider/runtime errors.

### Historical evidence

- [Completion](COMPLETION.md) — implementation-stage record and scope boundaries.
- [Verification](VERIFICATION.md) — captured genuine-data workflow and test evidence.
- [Audit](AUDIT.md) — original repository transformation and preserved starter utilities.

These evidence documents are historical records, not live monitoring dashboards. Product maturity, result validation, provider health and context availability must be checked in the current API/database.

## How to read status labels

| Label | Meaning |
|---|---|
| **Implemented** | The code path exists in the current repository. It does not imply every external dependency is configured. |
| **Demonstrated** | A run or test record documents that the path executed. Check date, data and environment. |
| **Experimental** | An implementation exists but is not approved for operational scientific conclusions. |
| **Pending validation** | A result is stored, but independent evidence/review has not established the scientific claim. |
| **Unavailable** | A required provider, dataset, asset or permission is absent. It must not be interpreted as zero. |
| **Planned** | A roadmap item; it is not present capability. |

A NISAR product's provider maturity (BETA/PROVISIONAL/VALIDATED) is distinct from the FLAGWA result validation state.

## Source-of-truth hierarchy

1. **Current code and typed schemas** determine what the checked-out version implements.
2. **Running OpenAPI** at `/openapi.json` determines current HTTP contracts.
3. **Database-backed records** determine actual locations, scenes, jobs, results and their status.
4. **Result metadata and processing reports** determine actual inputs, parameters, units, caveats and provenance.
5. **Historical reports** provide reproducibility evidence for the exact runs they describe.
6. **Roadmap documents** describe intended future work only.

If documentation and code disagree, file an issue and treat executable code/contracts as authoritative until corrected. Never invent output values to make a screenshot, narrative or guide look complete.
