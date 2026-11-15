# FLAGWA Frontend

## Initial Implementation Audit

No frontend, package manager configuration, React routes, CSS assets or JavaScript dependencies existed.
The existing FastAPI backend was restarted without replacing its PostgreSQL/Redis containers. Its live OpenAPI exposes 45 paths.
The existing success/error envelopes, scientific request models, actual location geometry and completed result records were inspected.
No backend algorithms or routes are being replaced. No scientific observations or metrics are seeded in the browser.

The public backend exports the primary result COG, GeoJSON, PNG and summary, but does not expose prepared observation A/B COGs.
An optional frontend-server read-only artifact bridge will resolve only approved existing processed-artifact roles from completed
database records and serve byte ranges. It will never expose raw HDF5, private object keys or server paths.
With no bridge configured, observation comparison must report its actual unavailable state rather than substitute optical imagery.

Administrative writes use a separate frontend-server session gateway. The backend admin key stays in server environment settings,
never in Vite variables or JavaScript bundles. Public deployments must explicitly configure restricted operator access.

## Design Grounding

- Subject: real NISAR surface observations, candidate change and source-grounded community context.
- Audience: scientific reviewers and curious explorers who need to understand both the signal and its uncertainty quickly.
- Signature: synchronized real GCOV before/after swipe, with one result reveal and no persistent scanning loop.
- Truth: actual scene IDs, dates, source classes, explicit unavailable states and amber pending-validation labels.
- NASA Eyes reference: full-bleed geographic content with controls subordinate to the instrument.
- Linear reference: restrained hierarchy, precise spacing and quiet hairlines. Reference pages were opened and screenshots inspected.
- Deliberately not imitating Awwwards-style effect stacking: spectacle must not obscure observations or uncertainty.

The supplied FLAGWA-specific Inter/JetBrains Mono and cyan/amber tokens override the generic skill's changeable defaults.

Desktop:

```text
brand / location / actual backend response / Story | Explore
solid rail | full-bleed map and comparison | one context HUD
           | legend and map controls       |
           | one observation timeline HUD  |
```

Mobile:

```text
compact brand / mode / navigation
full-screen map, touch comparison, map controls
observation timeline
solid bottom sheet: peek / half / full
```

Implemented motion: one 900 ms result fade, bounded camera transitions, one-time story-section reveals and direct-input swipe.
Reduced motion removes camera flights, reveal animations and smooth scrolling. No smooth-scroll engine hijacks maps.

## Run

Node 24 or newer is required. From the repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

The frontend defaults to port 5173, automatically choosing another port if occupied. The backend URL is server-only
`FLAGWA_BACKEND_URL` (default `http://127.0.0.1:8000`). Public browser API configuration is
`VITE_FLAGWA_API_BASE_URL` (default `/backend`). No demo mode, seeded measurements or production fixture switch exists.

For a direct hosted backend, set the public URL at build time and configure that backend's CORS origin. Same-origin
`/backend` proxying is recommended because it also streams exports without browser CORS complications.
Map tiles require public Esri network access and retain provider attribution. NASA PIA18033 imagery is bundled locally,
credited and explicitly illustrative: https://images-assets.nasa.gov/image/PIA18033/PIA18033~orig.jpg.

## Architecture

- React 19, TypeScript strict mode, Vite 8, Tailwind 4 tokens and responsive authored CSS.
- React Router: `/`, `/stories`, `/explore`, `/explore/:locationSlug`, `/explore/:locationSlug/compare`,
    `/explore/:locationSlug/results/:resultId`, `/radar-lab`, `/about`, plus an explicit not-found view.
- TanStack Query owns remote data, request cancellation, cache/error/retry state and terminal-aware job polling.
- Zustand owns view/selection state only. Scientific records are not copied into a fabricated local data store.
- MapLibre displays contextual cartography/optical tiles, actual boundaries/footprints and real raster/vector outputs.
- GeoTIFF.js and proj4 decode range-requested windows/overviews in two queued workers, reproject to Web Mercator,
    and generate 256px map tiles. Each read resamples at most 512x512 samples. Full-file fallback is prohibited.
- Actual TIFF CRS/nodata are honored. Flood/advanced categorical codes use their actual backend class legends;
    continuous results use reported units and real ranges, signed change is zero-centered, glacier rates sequential.
    Missing measurement scales do not receive invented ranges.
- Both comparison maps share camera state and the same prepared-power dB display scale. The acquisition timeline
    contains actual source dates, not synthetic intermediate frames. Arrow keys move the divider 10%; Shift+Arrow 1%.
- Recharts presents actual class counts, with a semantic table alternative. Lucide supplies control icons.
- AJV validates catalogue/download/analysis/validation forms against the live `/openapi.json`, including nested
    parameters, reviewed quality rules, explicit source dataset paths, UTC timestamps and reference-layer IDs.

## Frontend Gateway

The Node/Express server and Vite middleware share the same implementation. These are frontend adapter routes,
not invented FastAPI endpoints. Configuration is loaded only from server environment variables or ignored `.env.server`.

| Adapter | Purpose |
| --- | --- |
| `/backend/*` | Allowlisted public backend reads, exports, catalogue search and compatibility checks |
| `/operator/session` | Session state and rate-limited same-origin passphrase authentication |
| `/operator/logout` | End browser session |
| `/operator/api/v1/*` | Exact allowlisted restricted operations and interpretation read |
| `/gateway/results/:id/layers` | Manifest of existing completed-result prepared artifacts |
| `/gateway/results/:id/layers/:role` | Read-only local/S3 artifact bytes, including HTTP 206 ranges |

`ADMIN_API_KEY` and a separate `OPERATOR_ACCESS_SECRET` of at least 16 characters must be configured on the Node
server to enable processing. The browser never receives the backend key. Signed one-hour cookies are HttpOnly,
SameSite=Strict and Secure in production. Writes require a matching Origin; restricted GET requests require
matching Origin or browser same-origin fetch metadata. Incoming browser admin headers are discarded.
Authentication failures are rate-limited. Do not publicly expose the development Vite server as a production service.

## Optional Prepared-Artifact Bridge

The backend intentionally sanitizes storage keys from public result metadata. To show genuine prepared before/after
power without altering the backend, enable the optional server-side bridge using the server template's settings:

```text
FLAGWA_ENABLE_ARTIFACT_BRIDGE=true
FLAGWA_DATABASE_URL=postgresql://READ_ONLY_USER:SERVER_SECRET@DATABASE_HOST/DATABASE
FLAGWA_STORAGE_ROOT=/mounted/flagwa/storage
```

Use a dedicated database role with only SELECT on `analysis_results` and `analysis_jobs` in production, TLS on
hosted databases, and a read-only storage mount. The only SQL lookup is parameterized and requires a COMPLETED job.
Only `before_power`, `after_power` and `change_geotiff` roles can be resolved. UUIDs, role names, object keys and
real filesystem paths are validated; path traversal, symlink escapes, arbitrary URLs and raw HDF5 access are rejected.
Single ranges are capped at 8 MiB. The response never publishes database URLs, object keys or server paths.

For S3-compatible processed storage use `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION` and optional `S3_ENDPOINT_URL`;
prefer the platform's IAM credentials or scoped server-only S3 credentials. No AWS variable may have a VITE_ prefix.
The frontend S3 adapter uses the existing artifact keys rather than copying or reprocessing products.

With no bridge, primary COG/GeoJSON/summary exports remain usable and the UI explicitly reports unavailable
prepared observations. Continuous advanced rasters need no bridge because the public primary COG is sufficient.

## Production

```sh
npm --prefix frontend run build
npm --prefix frontend start
```

Set `NODE_ENV=production`, `PORT`, `FLAGWA_BACKEND_URL` and any private server settings in the hosting platform.
Terminate HTTPS at the platform/reverse proxy; production operator cookies require HTTPS. One Node service serves
the SPA, deep-link fallback, public proxy, sessions and optional artifact ranges. Do not redirect API failures to HTML.
The repository's existing API, worker, Redis/PostGIS, scheduler and backend deployment remain separate and unchanged.

Docker, from the repository root:

```sh
docker build -t flagwa-frontend -f frontend/Dockerfile frontend
docker run --rm -p 5173:5173 -e FLAGWA_BACKEND_URL=https://YOUR-BACKEND flagwa-frontend
```

`render.yaml` in this folder is a standalone frontend Blueprint. It does not replace the root backend Blueprint.
Attach server secrets privately in Render. Configure the optional bridge only when the Node service can read the
same existing processed storage/metadata as the backend. A static-only Vercel/Netlify deployment can use a direct
public API URL but cannot supply operator sessions or the artifact bridge without a separate trusted Node service.

## Verification

```sh
npm --prefix frontend test
npm --prefix frontend run check:server
npm --prefix frontend run build
npm --prefix frontend audit --omit=dev --audit-level=high
npm --prefix frontend exec playwright install --with-deps chromium
npm --prefix frontend run test:e2e
```

Browser acceptance requires the actual backend, existing genuine Kuttanad results, the local prepared-artifact bridge,
and a running frontend at `http://127.0.0.1:5173` (override `FLAGWA_TEST_URL`). Tests discover result/scene IDs from the
backend and do not seed observations or alter scientific records. Assertions cover real area/statistics/provenance,
range 206 responses, actual classification canvas colors, both grayscale comparison canvases, keyboard swipe,
360/768/1280 layouts, settled sheets, 200% magnification, reduced motion, layer/opacity/basemap controls, experimental
gating, server-disabled operator access and axe checks on story/explorer/lab/about. The local operator-disabled
assertion assumes no production operator secrets are configured in the test environment.

Unit/component fixtures are explicitly software-only. Tests cover malformed/error envelopes, missing-versus-zero
values, catalogue array/pagination, terminal polling, advanced units/scales, visible-versus-submitted defaults,
editable/invalid AOI JSON, route/key/range allowlists, cookie authentication, CSRF and backend-key isolation.
Real processing/approval is intentionally not executed by frontend browser tests.

Implementation verification: 16 unit/component/security tests and 3 genuine-backend browser tests passed;
strict client/server compilation and the production build passed; production dependency audit reported zero
vulnerabilities. The multi-stage Docker image built and its production runtime passed SPA deep links, real
backend readiness/results, genuine COG range bytes, disabled operator/bridge states and blocked public writes.
A production-browser-asset scan found no server-only secret names, database settings or test credentials.
The 500 kB map-vendor chunk warning is recorded below, not hidden by increasing the warning threshold.

## Scientific And Deployment Limits

- Genuine Kuttanad analyses remain pending independent validation. Candidate area is not confirmed flooded area.
- Forest, agriculture, wildfire, glacier and deformation remain experimental, non-operational workflows. Forms
    expose the actual processors and prerequisites, not claims of demonstrated real-data scientific performance.
- Research places without backend geometry reset to a global map, not an invented site marker or recycled study AOI.
- Missing population/settlement/infrastructure/hydrology coverage is unavailable, not zero or assumed impact.
- Land-cover overlay returns the backend's reviewed-class-selection requirement when no class is supplied;
    it is not silently presented as an agricultural impact estimate.
- Hosted authentication, paid/authorized provider access, independent scientific reference imports and production
    cloud secrets must be configured by the deployment owner. The frontend does not manufacture these prerequisites.
- Local filesystem artifact ranges are genuine-data tested. S3 credentials/access remain deployment-specific;
    the adapter is not represented as verified against a particular production bucket.
- MapLibre and the worker projection/GeoTIFF dependencies are deliberately route/worker loaded; the map route has
    a large vendor chunk warning, rather than forcing mapping code into the story's initial JavaScript.