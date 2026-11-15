# Development And Testing

This guide describes reproducible software checks and contribution boundaries. Scientific accuracy
also requires independent domain validation; synthetic tests and clean builds cannot establish it.

## Working Conventions

- Use the existing Python backend and React frontend rather than creating duplicate services.
- Keep scientific computation in backend services and pure visual mappings separate from API fetching.
- Preserve actual scene IDs, units, source dates, nodata and provenance through every transformation.
- Treat experiment/validation status as backend evidence, not a UI styling decision.
- Never commit secrets, satellite binaries, private context, generated maps or runtime databases.
- Mark all simulated test data explicitly synthetic; do not classify genuine synthetic-aperture radar
  as a software fixture merely because its sensor name contains the word synthetic.
- Avoid modifying unrelated or concurrently edited source; do not reset the worktree to remove user work.

## Dependencies And Source Of Truth

| Scope | Definition | Installation |
| --- | --- | --- |
| Backend | [requirements.txt](../requirements.txt) | `python -m pip install -r requirements.txt` in the Python 3.12 environment |
| Original research processing extras | [requirements-processing.txt](../requirements-processing.txt) | Optional original audit/notebook tooling; not the authoritative full backend installation |
| Frontend | [package.json](../frontend/package.json) and [lockfile](../frontend/package-lock.json) | `npm --prefix frontend ci` |
| Backend container | [Dockerfile](../Dockerfile) | `docker compose build` |
| Frontend container | [Dockerfile](../frontend/Dockerfile) | `docker build -f frontend/Dockerfile frontend` |

Do not commit `node_modules`, `.venv`, `dist`, `.pyc`, browser reports or private `.env` files.
Use Node 24+, the frontend-local TypeScript compiler and the tested Python virtual environment.

## Frontend Checks

```bash
npm --prefix frontend test
npm --prefix frontend run check:server
npm --prefix frontend run build
npm --prefix frontend audit --omit=dev --audit-level=high
```

The build performs strict TypeScript compilation before Vite bundling. Tests include API-envelope/error
semantics, no-data versus zero, job polling, schema forms, operator gateway isolation, Earthscore
determinism/audio/export, Groundwire summaries and Radar Lab real-observation contracts.

The mapping/projection dependency produces a known large vendor chunk warning. Report performance
risks honestly; do not silence the warning by changing its threshold without improving the underlying
delivery. Lazy routes and workers prevent scientific mapping code from becoming every page's first task.

## Browser Acceptance

Install the matching browser and required system libraries using the supported Playwright setup:

```bash
cd frontend
npx playwright install --with-deps chromium
npm run test:e2e
```

The default target is http://127.0.0.1:5173; override `FLAGWA_TEST_URL` for a running production host:

```bash
FLAGWA_TEST_URL=http://127.0.0.1:5175 npm run test:e2e -- earthscore.spec.ts explorer.spec.ts
```

Acceptance requirements depend on each file. Genuine-data suites need the backend, real completed
study records and the optional artifact bridge. The Earthscore/Explorer local operator-disabled
assertion assumes private operator access is not enabled in that test deployment. The tests discover
real IDs from responses rather than seed production observations; review each suite before running
against a shared research deployment. Browser output is ignored and may be overwritten by another run.

Key acceptance surfaces:

| Suite | Checks |
| --- | --- |
| `earthscore.spec.ts` | Independently read actual COG values, rendered footprint and canvas selection, real dates, audio opt-in, image/JSON provenance, aggregate fallback, stalled context tiles |
| `explorer.spec.ts` | Range 206, actual canvas colors, comparison, evidence, real statistics, empty locations, layers, operator gates and shared pages |
| `radar-lab.spec.ts` | Qualitative controls versus real-observation mode, acquired-layer availability and responsive evidence views |
| `groundwire.spec.ts` | Source-grounded briefs, actual records, interpretation limits and presentation |

Native select/text/table alternatives, keyboard control, reduced motion and axe scans complement
screenshots. A screenshot or HTTP 200 alone does not prove a scientific layer rendered. Require actual
canvas pixels/geometry and independent source-value checks for mapping features.

## Offline-Safe Backend Suite

From the repository root using the tested environment:

```bash
RUN_INTEGRATION_TESTS=false LIVE_PROVIDER_TESTS=false RUN_S3_TESTS=false .venv/bin/python -m pytest -q
```

This deliberately skips external/provider/service work. Skips are not passing integrations and should
be reported separately. Unit tests cover catalogue validation, context sources, security, raster methods,
provenance and scientific constraints without fetching multi-gigabyte data.

## Disposable Service Integration

Integration fixtures can remove/reset model records. They require explicit opt-in, `APP_ENV=test`,
an isolated PostgreSQL/PostGIS database named **exactly `flagwa_test`**, and separate disposable Redis.
Never point them at the running research database or the original development `postgres` database.

After privately configuring isolated test URLs:

```bash
APP_ENV=test RUN_INTEGRATION_TESTS=true .venv/bin/python -m pytest tests/integration -q
```

Provision/migrate the disposable database as required by its fixtures. See
[tests/integration/conftest.py](../tests/integration/conftest.py) for the current safety checks. Do not
bypass the database-name assertion merely to make a test run.

## Live Provider And Object Storage Checks

Live-provider tests require explicit `LIVE_PROVIDER_TESTS=true` and may need appropriate authorization.
Real S3 checks separately require `RUN_S3_TESTS=true` and the private `S3_TEST_*` configuration expected
by [the test](../tests/live/test_s3_live.py). Use isolated resources and review cleanup/permissions before
enabling them. Historical successful live tests are not proof that the present credentials/provider
are available. Never print secret values while diagnosing a skipped or unauthorized check.

## CI And Recorded Results

[Frontend CI](../.github/workflows/frontend.yml) installs the lockfile, runs unit tests/server typecheck,
builds and audits production dependencies. It does not provision real NISAR observations or run all
backend/live/browser integrations automatically. Run the appropriate additional gate for the change.

The 15 November 2026 publication check recorded 42 frontend tests passing, server typecheck/build
passing, and 106 backend tests passing with 21 explicit service/live skips. The Earthscore/Explorer
production acceptance gate separately passed seven browser checks. Older reports contain older counts
and environment-specific live evidence. Rerun checks rather than treating those counts as permanent.

## Contribution Checklist

1. Identify the owning API/service/component and a focused test before changing behavior.
2. Preserve typed contracts and source truth; update docs when user-visible behavior changes.
3. Add focused tests for meaningful risks, including errors, missing data and cancelled/terminal states.
4. Run the relevant unit/type/build gate, then real-data/browser/service checks when the change requires them.
5. Check `git diff --check`, staged filenames and ignored private/generated artifacts before committing.
6. Keep deployment secrets in the platform/local private environment, not in examples or Vite variables.
7. Report actual checks, intentional skips and remaining scientific validation dependencies separately.

## Documentation Maintenance

Keep the root README concise and link to the [documentation index](README.md). Prefer updating an
owning guide over duplicating endpoint schemas across many files. Check relative links, code fences,
documented script names, CLI help and environment-variable names against source. Label historical
availability windows and local evidence clearly. Do not publish a temporary tunnel hostname as the
project's permanent deployment URL or hardcode local result IDs into general installation instructions.