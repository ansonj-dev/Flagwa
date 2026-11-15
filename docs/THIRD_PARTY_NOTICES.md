# Third-party Notices and Source Register

This register supports the 2026 NASA Space Apps requirement to identify third-party solution materials and cite every resource used. It is a repository-level starting point, not a substitute for recording the exact sources and versions used in a particular result or submission.

## 1. Project licence boundary

Original FLAGWA source code and project documentation authored by Anson Joseph are licensed under Apache-2.0; see the repository-root LICENSE and NOTICE files.

The Apache-2.0 licence does not extend to third-party code, datasets, imagery, map tiles, fonts, trademarks, hosted services or content that remains subject to another party's licence or terms.

## 2. Identified imagery and map services

| Material | Where used / role | Source and attribution | Licence or use boundary |
|---|---|---|---|
| NASA image PIA18033, “Earth” / Earth by Suomi NPP | Bundled illustrative image at frontend/public/earth.jpg; a visual illustration, not NISAR data | NASA Photojournal: https://science.nasa.gov/photojournal/earth/ and https://science.nasa.gov/image-detail/amf-pia18033/ . Credit: NASA. | NASA's media guidance says NASA-created imagery is generally not subject to copyright in the United States, subject to its media-use rules. Do not imply NASA endorsement. Check an asset's page for any third-party copyright notice before reuse. |
| Esri World Imagery basemap | External map tiles requested by the frontend; not bundled as source data | Follow the live Esri attribution returned with the service. Esri's published attribution for World Imagery identifies Esri and its imagery providers. | Not licensed by FLAGWA's Apache-2.0 grant. Use is subject to current Esri/ArcGIS service terms, attribution, eligibility and request limits. Do not scrape, download, self-host or redistribute tiles unless a separate permission expressly allows it. Confirm that the current service terms are appropriate for the actual hackathon submission and deployment. |
| Kerala Tourism Kuttanad photograph | No longer embedded in README; a gallery page is linked only as contextual reading | Kerala Tourism Kuttanad gallery: https://www.keralatourism.org/photo-gallery/kuttanad-rice-bowl-of-kerala-alappuzha/2738 | Kerala Tourism's copyright page states that photographs may not be reproduced without written permission. The photo embed was removed; do not copy or redistribute Kerala Tourism photos without permission from the rights holder. |

NASA media-use references:
- https://www.nasa.gov/nasa-brand-center/images-and-media/
- https://science.nasa.gov/earth/faq/

Esri attribution reference:
- https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040

Kerala Tourism copyright reference:
- https://www.keralatourism.org/copyright

## 3. Data and scientific sources

The following sources are represented in the application, its source registry, research documentation or planned context workflows. Only list a source as an input to a particular result if that source was actually used for that result. Preserve the exact collection/version, product identifier, acquisition or observation date, access date, processing level, licence/terms and any required attribution.

| Source | Role | Source / licence notes |
|---|---|---|
| NASA–ISRO NISAR | Primary L-band and S-band SAR products | Cite exact scene/granule IDs, acquisition dates, product type, frequency, maturity and the relevant NASA/ASF or ISRO/NRSC product guide. NISAR data are not relicensed by FLAGWA. |
| NASA Earthdata / ASF DAAC | Catalogue discovery, product metadata and authorised downloads | Access/authentication provider. Cite the collection and actual product records used; protect credentials and private download URLs. |
| ISRO/NRSC Bhoonidhi | Potential S-band data access and product information | Separate portal/API permissions apply. Cite only products actually obtained and used. |
| JRC Global Surface Water | Historical water occurrence / permanent-water context | Cite the exact product/version and temporal range. A historical baseline is not same-date ground truth. |
| ESA WorldCover | Land-cover context | Cite product year/version and the ESA reuse/attribution terms applicable to the specific product. |
| Copernicus DEM / SRTM | Elevation and terrain context | Cite the exact elevation product, release and its reuse terms; inspect vertical datum and resolution. |
| NASA GPM IMERG | Potential rainfall context | A catalogue result alone is not an ingested rainfall input. Cite only an actual downloaded/used product and time range. |
| WorldPop | Potential gridded population context | Cite exact year, geography, product version and licence. Do not infer zero population from absent data. |
| OpenStreetMap | Potential roads, buildings and place context | OSM data are under the Open Database Licence (ODbL); provide the required OpenStreetMap contributor attribution and link to https://www.openstreetmap.org/copyright when used. The current Kuttanad audit documented OSM access as unavailable at that time, so do not claim it contributed to that result unless the current result provenance says otherwise. |
| Optical imagery and local/event records | Independent supporting evidence | Record sensor/owner, scene or record ID, date, cloud/quality status, licence, attribution and temporal relationship to the SAR acquisition. |

The application has a source/provenance guide at [DATA_SOURCES.md](DATA_SOURCES.md), and the flagship case study is documented in [KUTTANAD_STUDY.md](KUTTANAD_STUDY.md). Historical availability is not live availability; query the running context registry and result manifests before asserting what was used.

## 4. Third-party software and fonts

The exact direct and transitive dependency sets are defined by:
- frontend/package.json and frontend/package-lock.json;
- requirements.txt;
- requirements-processing.txt.

The frontend uses third-party libraries including React, React Router, TanStack Query, Zustand, MapLibre GL, GeoTIFF.js, proj4, Recharts, Express, the AWS SDK, AJV, Lucide, Motion, Tailwind and Fontsource Inter/JetBrains Mono. The Python backend uses third-party packages including FastAPI, Pydantic, SQLAlchemy, Alembic, Celery, Redis, ASF Search, Rasterio, NumPy, Shapely, GeoPandas, xarray, h5py, boto3 and related geospatial packages.

These dependencies keep their own upstream licences. This project-level Apache-2.0 licence does not override those licences. The package manifests and lockfiles identify the dependency versions; the actual upstream package metadata and licence files control each dependency's terms.

### Generate a dependency licence inventory

Run these commands from a clean checkout after installing the project dependencies. Review the output for package exceptions, dual licences, bundled assets and transitive dependencies; do not treat an automated report as legal review.

Frontend:
```bash
npm --prefix frontend ci
npx --yes license-checker --production --json > frontend-third-party-licenses.json
```

Python backend:
```bash
python -m pip install -r requirements.txt
python -m pip install pip-licenses
pip-licenses --format=markdown --with-urls --with-description > python-third-party-licenses.md
```

Also run the processing requirements in a separate environment if those optional dependencies are installed/distributed. Include the reviewed reports or a concise generated summary in the final Space Apps submission resources where requested. The manifests may contain dev/test dependencies that are not shipped in the production application; distinguish build-time, test-only and runtime packages.

## 5. Submission checklist

- [ ] The repository LICENSE is Apache-2.0 and the submission names the same SPDX identifier.
- [ ] Every dataset used in the final result is listed with source, version, observation date, licence/terms and attribution.
- [ ] Every image, visual asset, map service, font, icon, software library, text source and AI/tool resource used is listed, even when free or open source.
- [ ] Any content not clearly unrestricted or OSI-licensed has written permission or is replaced with material that meets the Participant Terms.
- [ ] The live basemap provider's terms and attribution are reviewed for the actual deployment/submission.
- [ ] The frontend and Python transitive dependency licence reports are generated and reviewed.
- [ ] NASA, ISRO and other agency names/logos are not used to imply endorsement; restricted insignia are not reproduced without permission.
- [ ] The result's exact NISAR product IDs, acquisition dates, processing method and source context are cited in its own evidence record.

## 6. Official and primary licensing references

- NASA Space Apps 2026 Participant Terms: https://www.spaceappschallenge.org/legal/
- OSI approved licences: https://opensource.org/licenses
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- NASA media usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/
- OpenStreetMap copyright and licence: https://www.openstreetmap.org/copyright
- Esri basemap attribution: https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040
