# User Guide

FLAGWA helps inspect surface-change evidence. It is not an emergency-warning service, a confirmed
impact inventory or a substitute for scientific review. Every view should be read together with its
actual measurement units, acquisition dates, provenance and validation status.

## Navigation

| Route | Experience |
| --- | --- |
| `/` and `/stories` | Story introduction, research places and signature entry |
| `/explore` | Explorer using the current selected study location |
| `/explore/:locationSlug` | Location-specific map and evidence |
| `/explore/:locationSlug/compare` | Genuine prepared before/after comparison when available |
| `/explore/:locationSlug/results/:resultId` | A specific completed result |
| `/earthscore` | Earthscore for the current study location |
| `/earthscore/:locationSlug` | Data-art experience for actual completed results |
| `/earthscore/:locationSlug/results/:resultId` | A specific result's artistic encoding |
| `/radar-lab` | Radar education and concept controls |
| `/radar-lab?mode=observations` | Evidence-linked real-observation lab |
| `/groundwire` | Source-grounded briefs and interpretation limits |
| `/about` | Evidence standards and scientific maturity |

Some routes use query parameters for selection; use the controls rather than inventing product IDs.
The mobile navigation menu retains access to all experiences.

## Scientific Explorer

### Select A Place And Result

Choose a study location and an existing completed analysis. Research entries do not imply an operational
result. If none exists, the application shows an explicit empty state rather than substituting a demo.
Study geometry can be draft or unreviewed; a place without geometry cannot receive an invented marker.

### Read The Map

The map combines separately labelled contextual cartography/optical imagery with scientific layers.
Use zoom/fit controls, the layer panel and opacity to distinguish the derived product from context.
Candidate polygons, source footprints, draft boundaries and registered community features are different
types of evidence. A coordinate popup is a map coordinate, not a newly sampled scientific measurement.

Flood classes distinguish invalid observations, no detected candidate, permanent water, potential new
inundation and uncertainty. Continuous advanced products display their own units and measured scales,
not a reused flood palette. Missing values are not zero.

### Compare Observations

Comparison requires genuine prepared before/after power rasters. Both maps use synchronized cameras
and a shared dB display scale. Drag the divider; keyboard Arrow moves it 10 percent and Shift+Arrow
moves it 1 percent. Actual source dates appear on the acquisition timeline.

If prepared observations are unavailable, the app says so. An optical basemap is not a replacement
for NISAR evidence. The optional server artifact bridge must be configured to expose these existing roles.

### Inspect Evidence And Export

The evidence panel exposes source IDs, actual acquisition times, frequency/group, polarization,
algorithm, parameters, AOI/context provenance, uncertainty and review history. HDF5 inspection lists
actual acquired-product dataset paths, not server filesystem paths. Public result exports include COG,
GeoJSON and summary; availability varies with the actual completed record.

### Context And Exposure

Population, settlements, infrastructure, land cover, hydrology, permanent water, rainfall and boundaries
appear only when registered with source/version/reuse metadata. Proximity buffers are explicit user
parameters. Exposure estimates are geographic overlays, not confirmed affected-person or damage counts.
A class raster may require a reviewed class selection. Missing coverage stays unavailable.

## Catalogue, Processing And Jobs

Catalogue discovery and compatibility checks use typed fields from the live API schema. Select dates,
maturity and products deliberately; returned records do not guarantee download authorization.
Download and scientific processing require an authorized operator session when enabled on the deployment.
Source dataset paths and quality-mask codes must come from the actual inspected product.

Follow queued jobs in the processing panel. Running progress is not a scientific confidence score.
Cancellation is cooperative. Explicit retry creates a new job; it does not erase the failed history.
Independent validation is a separate evidence-driven workflow, not a button that certifies arbitrary results.

## THE EARTHSCORE

### What The Artwork Means

Earthscore is a deterministic artistic encoding of a real processed result. For the two-observation MVP:

1. **REFERENCE:** first actual acquisition and prepared power, if available.
2. **OBSERVATION:** second actual acquisition and prepared power, if available.
3. **CHANGE:** derived interval anchored to the last acquisition, not a third pass.

Horizontal anchors use actual timestamps. Tracks represent geographic northing bands. Stroke length is
normalized magnitude, direction retains the measurement's sign, and density reflects available samples.
Amber fragments mean explicit uncertain interpretation. Missing observations appear as gaps. Connecting
ribbons are artistic associations, not measured trajectories or intermediate satellite observations.

The sampled-cell resolution is displayed. Stored overview averages must not be described as native
full-resolution pixels or complete sector means. The scientific inspector retains native stored values
and the documented dB conversion. Mean dB change need not equal the difference of two logged mean powers.

### Link Artwork, Geography And Values

Click a stroke/ribbon or choose a sample to highlight its real geographic footprint and exact value.
Click a map sample to select the same visual feature. Region/measurement selectors and native controls
provide keyboard alternatives. Changing the documented normalization clips the artistic display only;
it does not change the original stored measurement. Return to the scientific raster view at any time.

If spatial rasters are unavailable, a clearly labelled aggregate composition can use a reported statistic.
Unavailable reference/observation values remain missing. Actual multi-date metadata can add dated stages,
but absent processed per-date values are never interpolated or silently filled.

### Listen To The Change

Audio starts only after an explicit action. Play/pause/resume/stop, mute, volume and selected-cell/region
playback are available. Magnitude maps to 110–880 Hz; longitude controls stereo and sample order follows
the documented geographic lattice. Missing samples are silent rests; explicit uncertainty has a fragmented
note treatment. Loudness and pitch do not mean disaster severity. This is sonification, not recorded satellite audio.

### Export Responsibly

The PNG retains branding, location, dates, source, result/algorithm/validation, measurement/units,
normalization, legend, sampling limits and the artistic-interpretation statement. The JSON includes
exact sampled values/footprints and processing provenance. Do not crop away these explanations and
present the composition as a new observation or validated event detection.

## Radar Lab

Concept mode illustrates signal interaction with water, forest, built-up areas and soil. Cloud/night
controls change the educational scene, not a measured return trace. It has no scientific scale.

Observation mode uses actual completed results, source scenes, preview/COG exports and stored HDF5
inspection. Only genuinely acquired variables should be enabled. A provider's `HH/HV` catalogue entry
does not establish that the downloaded derivative contains `HHHH/HVHV`. Missing covariance terms,
quality information and products are reported instead of synthesized. Inspection is a bounded inventory,
not an unlimited filesystem browser.

## Groundwire

Groundwire presents real dates, reported metrics and a plain-language brief with explicit hypotheses
and caveats. It can summarize categorical class distributions or continuous ranges when those statistics
exist. It does not supply causal attribution, confirmed deforestation, burn severity, crop yield,
glacier retreat or absolute vertical subsidence from an unrelated scalar measurement.

## Accessibility And Interpretation

Icon controls have names, native controls provide keyboard access, tables/text accompany visual metrics,
and reduced-motion settings remove unnecessary animation. Audio is never required. Small screens use
mobile navigation and an expandable evidence sheet in Explorer. A contextual provider outage should
not turn a missing dataset into a scientific zero.

Always retain this distinction: **observed measurement, derived indicator, contextual source, artistic
encoding, and independent scientific validation are not interchangeable.**