# Kuttanad, Alappuzha — Flagship Study

> **Where water, land and livelihoods meet.**
>
> Kuttanad is FLAGWA's flagship study area because its low-lying wetland-agricultural landscape asks a genuinely difficult remote-sensing question: how can we interpret changing radar response where water, vegetation, soil, cultivation and human water management interact?

## 1. Why this place

Kuttanad lies in Alappuzha district, Kerala, and is widely known as the Rice Bowl of Kerala. Its landscape is shaped by paddy fields, rivers, canals, lakes/backwaters, settlements, transport routes and managed water levels. Parts of the agricultural system are cultivated below sea level, making embankments, drainage and water management integral to land use.

For FLAGWA, this is a meaningful study environment, not just a hometown label. A radar response over an open canal is not the same physical scene as a radar response over a paddy plot, a tree-covered bund, a built-up bank or wet soil. Seasonal crop structure and water level can change radar response even when no disaster has occurred.

The study is framed around **observing and interpreting surface response**, not automatically labelling every detected difference as inundation.

## 2. Research question

**How does NISAR L-band radar response across the Kuttanad wetland–paddy landscape differ between compatible acquisitions, and which independent observations are needed to distinguish hydrological change from normal seasonal, agricultural and radar effects?**

Supporting questions:
- Which backscatter layers and polarization terms are actually present in the selected GCOV products?
- Are selected observations compatible in frequency, polarization, orbit direction, look geometry, product maturity and processing baseline?
- Where do candidate pixels occur relative to a documented permanent-water reference, land cover, terrain and reviewed study boundary?
- Could differences plausibly relate to open water, flooded vegetation, wet soil, crop stage, field management, wind/roughness or acquisition geometry?
- Which interpretation remains supportable after independent validation?

## 3. Study boundary and spatial caution

The repository includes `config/kuttanad_aoi.geojson`. The original boundary is a **draft rectangular search AOI**, not a legally defined Kuttanad boundary, hydrological catchment, floodplain, administrative boundary or validated agricultural footprint.

Historical starter-kit bounds were:
- West: 76.25°E
- East: 76.55°E
- South: 9.20°N
- North: 9.50°N

A final area estimate should use a reviewed polygon and an appropriate projected metric CRS. A rectangular query footprint is not an impact boundary. The exact AOI stored with each result is the geometry that must be used to interpret that result.

## 4. Demonstrated observation pair

The backend verification record documents two actual L-band GCOV acquisitions used by the Kuttanad AOI workflow:

| Attribute | Observation A | Observation B |
|---|---|---|
| Acquisition date | 29 October 2026 | 10 November 2026 |
| Frequency | L-band | L-band |
| Product | GCOV | GCOV |
| Frequency group | A | A |
| Polarization selection recorded | HHHH | HHHH |
| Orbit direction | Descending | Descending |
| Track / frame | 77 / 84 | 77 / 84 |
| Look direction | Left-looking | Left-looking |

The pair was selected because recorded geometry and product properties permit a meaningful exploratory comparison. A processing-maturity and baseline check must still be retained in result metadata; never infer comparability from the table alone.

The demonstrated processing record describes an AOI subset workflow, not acquisition of complete source granules. Use the exact source scene IDs, product metadata and processing report stored with the result. Historical identifiers and result UUIDs belong in the evidence record, not in reusable example commands.

## 5. What the current result says—and does not say

The documented result is a **radar-derived candidate change layer** with result status `pending_validation`. Its reported candidate area is approximately **8.10 km²** in the processing record. This value describes the current algorithm's candidate class over the processed draft AOI and its chosen parameters. It is not independently validated flood extent, not flood depth, not a count of affected homes or farms, and not an official disaster estimate.

The workflow uses GCOV backscatter evidence and a permanent-water contextual baseline. The historical verification record notes a JRC permanent-water reference layer from 2021 and exploratory thresholds. That baseline can be incomplete or temporally mismatched to current water conditions; it cannot alone distinguish seasonal water, agricultural flooding, wet soil and event inundation.

Responsible communication:

> **A candidate radar-response change identified for further investigation in Kuttanad. The candidate requires review against current water conditions, terrain, land use, rainfall/hydrology and independent event evidence. It is not a confirmed flood map.**

Do not say “NISAR detected the Kuttanad flood” unless independent evidence, reviewed boundaries, validated processing and qualified review substantiate that exact claim.

## 6. Physical drivers to investigate

The following are plausible hypotheses, not claims that the current result proves them.

| Possible driver | Why radar response may change | Evidence needed |
|---|---|---|
| Open water expansion | Smooth water may reduce co-polarized backscatter through specular reflection, depending on geometry and roughness. | Current water extent, optical imagery, gauge/field records, comparable geometry and quality masks. |
| Flooded vegetation | Water beneath stems/canopy can create double-bounce or complex scattering; response depends on vegetation structure and polarization. | Actual polarimetric channels/covariance, crop/vegetation state, field observations and optical context. |
| Wet soil / surface moisture | Dielectric properties change with water content; roughness and vegetation also influence the return. | Independent soil-moisture/rainfall observations and suitable NISAR product layers where available. |
| Paddy crop cycle | Plant height, biomass, row structure, transplanting/harvest and standing water change scattering through the season. | Agricultural calendar, crop type, field boundary and multi-date observations. |
| Water-management operations | Drainage, pumping, bund/sluice operation and managed field inundation can alter local water patterns. | Local operating records, water-level data, field reports and temporal context. |
| Wind and surface roughness | Wind changes water-surface roughness and therefore radar return. | Wind observations near acquisition time and independent water evidence. |
| Geometry / acquisition differences | Incidence angle, look direction, orbit geometry, shadow/layover and co-registration can alter apparent differences. | Scene metadata, geometry checks, masks and consistent processing baseline. |

### Why L-band and polarization matter

NISAR combines NASA's L-band SAR and ISRO's S-band SAR. Wavelength affects interactions with vegetation and surface structure, but it does not provide a simple universal classifier. Polarization helps describe scattering mechanisms; useful channels depend on actual acquisition mode and product covariance terms. FLAGWA must inspect the actual product rather than assume every scene has HH, HV, VH and VV.

For the current Kuttanad pair, HHHH is the recorded selected dataset/group. Do not describe the analysis as full quad-polarimetric classification unless the required independent channels and method are genuinely present.

## 7. Required validation plan

A defensible Kuttanad interpretation should assemble and document:

1. **Boundary review:** replace the draft rectangle with a reviewed study polygon and record source, date, CRS and reviewer.
2. **Scene review:** preserve complete metadata, provider maturity, CRID/baseline, orbit, look, incidence geometry, polarization and valid overlap.
3. **Permanent-water baseline:** obtain an appropriate version and inspect temporal relevance; separate permanent water from seasonal/inundated water.
4. **Optical evidence:** use cloud-screened imagery close to the SAR acquisitions, with source/product dates and cloud limitations.
5. **Hydrology and rainfall:** obtain rainfall, river/backwater level, reservoir/sluice operations and/or local water-level records near observation dates.
6. **Agricultural context:** identify paddy calendar, cropping stage, fallow fields, aquaculture and other land uses.
7. **Terrain and infrastructure:** assess elevation, embankments, drainage and water-control structures; do not assume a DEM resolves local microtopography without quality checks.
8. **Local evidence:** compare with dated, attributable reports or field observations; distinguish anecdotal accounts from measured evidence.
9. **Independent review:** record confusion/omission risks, thresholds, masks, reviewer and final decision.
10. **Reproducibility:** publish result ID, scene IDs, dataset paths, processing version, parameters, input checksums, outputs and uncertainty.

## 8. Context availability and current limits

The historical backend completion report records a WorldCover 2021 import and a JRC permanent-water baseline for the Kuttanad workflow. It also records unavailable or unverified context at that stage: population/WorldPop and OSM access were unavailable; IMERG catalogue records were found but a rainfall raster was not fabricated; Copernicus DEM reuse/licensing was flagged for review. These are dated records, not a promise that those providers remain unavailable today.

Use the running context registry/status endpoint and dataset records before describing current coverage. Missing coverage must remain explicit. Never replace missing population with zero or infer household exposure from a candidate polygon alone.

## 9. Historical context is not satellite observation

The devastating Kerala floods of 2018 are part of the region's lived and historical context and can motivate the importance of understanding water dynamics. **NISAR was launched on 30 July 2025; it did not acquire the 2018 event.** Do not present the current NISAR pair as a retrospective observation of that flood, or use 2018 imagery/reports as if they were same-date references for the 2026 scenes.

A historical event can inform research motivation, while the scientific comparison must use the acquisition dates and independent evidence relevant to those dates.

## 10. Future value for Kuttanad

With sustained observations, reviewed boundaries and independent validation, a mature FLAGWA workflow could support seasonal water/crop-scattering monitoring, distinguishing persistent from transient water-response patterns, identifying candidate areas for field inspection after high-water periods, combining satellite evidence with rainfall/levels/land cover, and maintaining a locally understandable evidence archive.

These are potential future applications, not current operational services or public safety alerts.

## 11. Sources

The exact NISAR scene/product metadata and result processing report are the primary evidence for the demonstrated pair. Product interpretation should be grounded in the official [ASF NISAR Data User Guide](https://hyp3-docs.asf.alaska.edu/nisar-docs/products-overview/) and [Using NISAR Data](https://nisar-docs.asf.alaska.edu/using-overview/). For ISRO S-band data products and release notes, consult [NRSC Bhoonidhi NISAR](https://bhoonidhi.nrsc.gov.in/NISAR/NisarProducts.html).

For regional context and Kuttanad imagery, see [Kerala Tourism's Kuttanad gallery](https://www.keralatourism.org/photo-gallery/kuttanad-rice-bowl-of-kerala-alappuzha/2738). Check licensing/attribution before reusing imagery outside this documentation.

---

**Study principle:** celebrate Kuttanad by taking its complexity seriously. The best result is not the boldest colour on a map; it is the clearest account of what the observations support, what they do not, and what evidence the community deserves next.
