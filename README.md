# FLAGWA — Kerala NISAR Data Audit Starter Kit

**Purpose:** run a reproducible catalog search for NISAR L-band GCOV products intersecting the proposed Kuttanad–Alappuzha study window, preserve the returned metadata, and download only explicitly selected granules.

> **Important status:** This kit has not queried the live ASF catalog from this environment. The machine running it must have internet access and the user must run the search. No scene IDs, acquisition dates, or data-availability claims are pre-filled. A zero-result search is a valid audit outcome, not evidence that data exist.

## 1. What the kit does

1. Searches the ASF catalog for NISAR `GCOV` products over the draft Kuttanad bounding box.
2. Runs separate searches for `VALIDATED` and `PROVISIONAL` data maturity.
3. Saves the original GeoJSON results and a CSV scene inventory.
4. Lets you download only a granule ID you choose after reviewing the inventory.
5. Inspects the internal HDF5 dataset tree of a downloaded product without assuming a dataset path.

## 2. Current data window to audit

Checked against the NISAR/ASF availability guide on **14 November 2026**:

- **VALIDATED L-band Level 0–2:** acquisitions from 21 October 2026 onward.
- **PROVISIONAL L-band:** acquisitions from 17 June 2026 through partway into 23 October 2026.
- **VALIDATED SME2:** not yet available as of that check.

The script uses conservative default date windows:

- VALIDATED: `2026-10-21` through `2026-11-14`
- PROVISIONAL: `2026-06-17` through `2026-10-22`

Change these dates when the live ASF availability page is updated. Keep maturity classes separate in the analysis. Do not combine BETA, PROVISIONAL and VALIDATED products without a documented processing-baseline and product-consistency assessment.

## 3. Study area

The included GeoJSON is a **draft rectangular search window**, not an authoritative floodplain boundary:

- West: 76.25°E
- East: 76.55°E
- South: 9.20°N
- North: 9.50°N

Refine this to a study-area polygon before final area calculations. ASF expects WKT coordinates in longitude, latitude order.

## 4. Install on Windows (VS Code / PowerShell)

Open this folder in VS Code, then run:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If PowerShell blocks activation, use:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Python 3.11 is a practical baseline for this starter kit. Use a compatible GDAL/QGIS environment separately for raster processing; geospatial binary packages can be platform-sensitive.

## 5. Run the catalog audit (no Earthdata token required for basic discovery)

```powershell
python scripts/search_kerala_nisar.py
```

To change the window:

```powershell
python scripts/search_kerala_nisar.py --validated-start 2026-10-21 --validated-end 2026-11-14 --provisional-start 2026-06-17 --provisional-end 2026-10-22
```

To save results elsewhere:

```powershell
python scripts/search_kerala_nisar.py --out-dir data/audit/run_001
```

Outputs:

- `kerala_nisar_validated.geojson`
- `kerala_nisar_provisional.geojson`
- `kerala_nisar_scene_inventory.csv`
- `audit_summary.json`

The inventory preserves the full product properties as JSON so that metadata fields are not lost if ASF changes its property naming.

## 6. How to choose a valid pair

Do not choose the first two search results automatically. Review:

- Full AOI coverage (or sufficient overlap for the chosen sub-area).
- Acquisition timestamps and temporal relevance.
- Same product type and frequency (start with L-band GCOV).
- Compatible main-band polarization and actual available layers.
- Same orbit direction and comparable viewing geometry where possible.
- Same processing maturity and preferably the same product baseline / CRID.
- Quality masks and known product issues.
- Whether both dates represent useful hydrological states (e.g. reference/drier versus wetter/event-relevant conditions).

Record selected IDs in `data/audit/scene_pair_decision.csv`. If no comparable pair exists, do not claim an NISAR before/after flood result for this AOI.

## 7. Download a selected granule

Create a NASA Earthdata Login account and an Earthdata user token. Keep the token private.

### PowerShell session-only token setup

```powershell
$env:EARTHDATA_TOKEN = "PASTE_YOUR_EARTHDATA_USER_TOKEN_HERE"
```

This only sets the variable for the current terminal session. Do not paste the token into source code, `.env` committed to Git, screenshots, chat, or public logs.

Download one product by exact granule ID from the CSV:

```powershell
python scripts/download_kerala_granule.py --granule-id "PASTE_EXACT_GRANULE_ID" --out-dir data/raw/kerala_gcov
```

The downloader uses `ASFSession.auth_with_token()` and the ASF package download method. It does not download all search results.

## 8. Inspect the HDF5 before extracting a raster

```powershell
pip install h5py
python scripts/inspect_nisar_hdf5.py data/raw/kerala_gcov/PRODUCT.h5 --contains GCOV
```

Read the output and the product guide before selecting a dataset. Do not assume that `HHHH` or any other polarization exists in every acquisition. Do not copy a dataset path from an unrelated scene without checking.

## 9. Next processing stage

After a compatible pair is confirmed:

1. Inspect both HDF5 products and identify the same physical measurement and frequency.
2. Extract the selected scalar GCOV layer and all required quality/valid-data masks.
3. Verify units and determine whether the values are linear power or already in dB.
4. Align the rasters to a common grid, preserving CRS, transform, pixel spacing and nodata.
5. Calculate a backscatter difference only after comparability checks.
6. Derive a conservative **potential-inundation candidate** layer using thresholds calibrated against reference evidence.
7. Exclude permanent water and inspect flooded vegetation, wetlands, paddy fields, terrain effects and radar geometry.
8. Validate with independent imagery, flood reports, rainfall, water masks and local context.
9. Publish only outputs whose lineage, units, dates, caveats and method are recorded.

Backscatter difference is not flood depth and is not, on its own, proof of flooding.

## 10. Credential map

| Service | Needed now? | Credential |
|---|---|---|
| ASF catalog discovery | No | Public catalog search |
| NISAR L-band download/stream | Yes for private download access | NASA Earthdata Login token |
| ISRO Bhoonidhi S-band | Optional for L-band MVP | Separate Bhoonidhi account; API access is a separate authorization/token flow |
| MapLibre | No | Map renderer only; you still need a basemap tile provider |
| AI explanation provider | No | Optional provider-specific key, only if adding AI later |
| PostGIS | No for this audit script | Database credentials only when you deploy a database |

There is no single API key for all FLAGWA services.

## 11. Official references

- NISAR ASF search guide: https://nisar-docs.asf.alaska.edu/asf-search/
- NISAR data availability: https://nisar-docs.asf.alaska.edu/availability-overview/
- ASF `asf_search` searching: https://docs.asf.alaska.edu/asf_search/searching/
- ASF `asf_search` basics: https://docs.asf.alaska.edu/asf_search/basics/
- ASF session authentication: https://docs.asf.alaska.edu/asf_search/ASFSession/
- Earthdata Login: https://urs.earthdata.nasa.gov/
- ISRO Bhoonidhi NISAR: https://bhoonidhi.nrsc.gov.in/NISAR/
- Bhoonidhi API specification: https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/

## 12. Definition of done for this phase

- [ ] Search completed separately for VALIDATED and PROVISIONAL GCOV.
- [ ] Search date windows and AOI saved.
- [ ] Original GeoJSON and inventory CSV saved.
- [ ] At least two genuinely comparable observations identified, or the audit records that no pair was found.
- [ ] Selected pair has same maturity and compatible acquisition geometry/product properties.
- [ ] Exact product IDs and acquisition times added to `scene_pair_decision.csv`.
- [ ] Only then download the selected products.
- [ ] HDF5 dataset tree inspected and relevant variables identified.

**No data availability result is assumed by this starter kit. Run it and use the returned catalog records as the evidence.**
