import { lazy, Suspense, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Cloud,
  Mountain,
  Radio,
  Sun,
  Trees,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { useExplorer } from "../store/explorer";
import { Loading } from "../components/ui";

const ObservationLab = lazy(() =>
  import("../features/radar-lab/ObservationLab").then((module) => ({
    default: module.ObservationLab,
  })),
);

type Surface = "water" | "forest" | "urban" | "soil";

const surfaces: Record<
  Surface,
  {
    label: string;
    interaction: string;
    typicalReturn: string;
    explanation: string;
    icon: LucideIcon;
    trace: string;
    peak: { x: number; y: number };
  }
> = {
  water: {
    label: "Water",
    interaction: "Specular reflection",
    typicalReturn: "Often weak",
    explanation:
      "Smooth open water often scatters energy away from the sensor. Wind roughness can change the return, and flooded vegetation can behave differently. A dark pixel alone does not establish flooding.",
    icon: Waves,
    trace:
      "M24 75 C56 74 75 72 102 75 S151 80 181 76 S238 73 267 76 S311 80 336 76",
    peak: { x: 181, y: 76 },
  },
  forest: {
    label: "Forest",
    interaction: "Volume scattering",
    typicalReturn: "Variable",
    explanation:
      "Branches, trunks and leaves scatter energy in many directions. L-band and cross-polarized return can help investigate vegetation structure, but moisture and viewing geometry matter too.",
    icon: Trees,
    trace:
      "M24 78 C43 76 47 48 59 75 S76 82 91 55 S111 81 129 70 S148 39 161 73 S184 82 201 53 S218 78 238 66 S257 43 270 73 S300 83 336 64",
    peak: { x: 270, y: 73 },
  },
  urban: {
    label: "Built-up",
    interaction: "Double-bounce scattering",
    typicalReturn: "Can be strong",
    explanation:
      "Vertical walls and horizontal ground can produce strong double-bounce returns. Dense buildings may also cause layover and radar shadow; brightness indicates neither population nor building damage.",
    icon: Building2,
    trace:
      "M24 77 C51 76 67 70 88 75 S116 81 135 72 C148 67 149 28 161 26 C174 27 175 70 191 74 S218 78 236 69 C248 63 249 37 261 35 C274 37 272 72 290 75 S320 78 336 74",
    peak: { x: 261, y: 35 },
  },
  soil: {
    label: "Exposed soil",
    interaction: "Roughness & dielectric response",
    typicalReturn: "Highly variable",
    explanation:
      "Surface roughness affects scattering, while soil moisture changes dielectric properties. A brighter return does not directly equal higher soil moisture or crop yield.",
    icon: Mountain,
    trace:
      "M24 77 C49 72 59 80 81 68 S111 73 129 60 S154 74 178 68 S208 77 231 57 S258 68 277 61 S310 71 336 53",
    peak: { x: 336, y: 53 },
  },
};

const surfaceOptions = Object.keys(surfaces) as Surface[];

export function RadarLab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode =
    searchParams.get("mode") === "observations" ? "observations" : "concept";
  const setMode = (next: "concept" | "observations") =>
    setSearchParams(
      (params) => {
        params.set("mode", next);
        return params;
      },
      { replace: true },
    );
  const [surface, setSurface] = useState<Surface>("water");
  const [clouds, setClouds] = useState(true);
  const [night, setNight] = useState(false);
  const [polarization, setPolarization] = useState("HH");
  const slug = useExplorer((state) => state.selectedLocation);
  const selectedSurface = surfaces[surface];
  const SurfaceIcon = selectedSurface.icon;
  const isCoPolarized = polarization === "HH" || polarization === "VV";

  return (
    <main className="lab-page">
      <SiteHeader />
      <header className="lab-heading">
        <div>
          <span className="eyebrow">FIELD GUIDE · NISAR L-BAND RADAR</span>
          <h1>
            Read the return,
            <br />
            not just the surface.
          </h1>
        </div>
        <p>
          Explore how different surfaces interact with radar signals and learn
          what those measurements can reveal.
        </p>
      </header>

      <div
        className="lab-mode-switch"
        role="tablist"
        aria-label="Radar Lab mode"
      >
        {(
          [
            ["concept", "Learn the signal"],
            ["observations", "Inspect real observations"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="tab"
            id={`lab-tab-${value}`}
            aria-controls={`lab-panel-${value}`}
            aria-selected={mode === value}
            tabIndex={mode === value ? 0 : -1}
            onClick={() => setMode(value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "concept"
                  : event.key === "End"
                    ? "observations"
                    : mode === "concept"
                      ? "observations"
                      : "concept";
              setMode(next);
              document.getElementById(`lab-tab-${next}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="lab-panel-concept"
        aria-labelledby="lab-tab-concept"
        hidden={mode !== "concept"}
      >
        <section className="lab-workspace" aria-label="Interactive radar lab">
          <div
            className={`lab-scene surface-${surface} ${clouds ? "cloudy" : ""} ${night ? "night" : ""}`}
            role="img"
            aria-label={`Conceptual radar view of ${selectedSurface.label.toLowerCase()}, ${clouds ? "under clouds" : "clear sky"}, ${night ? "at night" : "in daylight"}`}
          >
            <div className="lab-scene-top">
              <span>01 / TRANSMIT</span>
              <span className="lab-scene-tag">CONCEPT VIEW</span>
            </div>
            <div className="lab-orbit">
              <div className="lab-orbit-icon">
                <Radio size={25} />
              </div>
              <span>NISAR · L-BAND</span>
            </div>
            <div className="lab-beam" />
            <div className="lab-rays" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <svg
              className="lab-scattering"
              viewBox="0 0 100 70"
              aria-hidden="true"
            >
              <path
                d={
                  surface === "water"
                    ? "M48 58L86 28"
                    : surface === "forest"
                      ? "M48 58L23 26 M48 58L48 17 M48 58L80 32"
                      : surface === "urban"
                        ? "M48 58L68 58L68 38L61 12"
                        : "M48 58L30 36 M48 58L61 20 M48 58L82 42"
                }
              />
            </svg>
            {clouds && (
              <div className="lab-clouds" aria-hidden="true">
                <Cloud size={82} />
                <Cloud size={58} />
              </div>
            )}
            <div className="lab-ground">
              <div className="lab-ground-icon">
                <SurfaceIcon size={58} strokeWidth={1.25} />
              </div>
              <span>{selectedSurface.label.toUpperCase()}</span>
            </div>
            <div className="lab-scene-label mono">
              SCHEMATIC ONLY <span>·</span> NOT A SCIENTIFIC MEASUREMENT
            </div>
          </div>

          <div className="lab-controls">
            <div className="lab-controls-heading">
              <span className="eyebrow">02 / SET THE SCENE</span>
              <h2>What is the signal meeting?</h2>
            </div>
            <fieldset className="lab-surface-select">
              <legend>Surface type</legend>
              <div className="segmented wrap">
                {surfaceOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={surface === value}
                    onClick={() => setSurface(value)}
                  >
                    {surfaces[value].label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="lab-condition-heading">
              <span>Viewing conditions</span>
              <span>Radar brings its own light</span>
            </div>
            <div className="lab-toggles">
              <label>
                <Cloud size={17} />
                <span>Cloud cover</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={clouds}
                  onChange={(event) => setClouds(event.target.checked)}
                />
              </label>
              <label>
                <Sun size={17} />
                <span>Night</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={night}
                  onChange={(event) => setNight(event.target.checked)}
                />
              </label>
            </div>

            <p className="lab-polarization-note">
              Radar provides its own illumination. Daylight and ordinary cloud
              cover do not determine the radar return in the way they do for
              optical imagery.
            </p>

            <label className="lab-polarization-label" htmlFor="polarization">
              Illustrative polarization channel
            </label>
            <select
              id="polarization"
              value={polarization}
              onChange={(event) => setPolarization(event.target.value)}
            >
              <option>HH</option>
              <option>HV</option>
              <option>VH</option>
              <option>VV</option>
            </select>
            <p className="lab-polarization-note" aria-live="polite">
              {isCoPolarized ? "Co-polarization" : "Cross-polarization"}:
              transmit {polarization[0] === "H" ? "horizontal" : "vertical"},
              receive {polarization[1] === "H" ? "horizontal" : "vertical"}.
              Channel {polarization} corresponds to GCOV power term{" "}
              {polarization.repeat(2)} (the channel multiplied by its complex
              conjugate). These are illustrative examples, not a claim of
              acquisition availability.
            </p>

            <div className="lab-readout" aria-live="polite">
              <div className="lab-readout-heading">
                <span className="eyebrow">03 / READ THE RETURN</span>
                <span className="lab-return-tag">
                  {selectedSurface.typicalReturn}
                </span>
              </div>
              <h3>{selectedSurface.interaction}</h3>
              <p>{selectedSurface.explanation}</p>
              <div className="lab-profile">
                <div className="lab-profile-heading">
                  <span>Illustrative return profile</span>
                  <span>NO SCALE</span>
                </div>
                <svg
                  viewBox="0 0 360 110"
                  role="img"
                  aria-labelledby="profile-title"
                  preserveAspectRatio="none"
                >
                  <title id="profile-title">
                    Conceptual radar return over{" "}
                    {selectedSurface.label.toLowerCase()}; not measured data
                  </title>
                  <path
                    className="lab-profile-grid"
                    d="M24 20H336 M24 48H336 M24 76H336"
                  />
                  <path
                    className="lab-profile-fill"
                    d={`${selectedSurface.trace} L336 104 L24 104 Z`}
                  />
                  <path
                    className="lab-profile-line"
                    d={selectedSurface.trace}
                  />
                  <circle
                    className="lab-profile-point"
                    cx={selectedSurface.peak.x}
                    cy={selectedSurface.peak.y}
                    r="4"
                  />
                </svg>
                <div className="lab-profile-foot">
                  <span>Concept sketch</span>
                  <span>Not observed data</span>
                </div>
                <p className="lab-concept-disclaimer">
                  QUALITATIVE CONCEPT — NOT OBSERVED NISAR DATA.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          className="lab-notes lab-frequency"
          aria-label="NISAR frequencies"
        >
          <article>
            <span className="eyebrow">NISAR L-BAND</span>
            <h2>Approximately 24 cm</h2>
            <p>
              Longer wavelengths can provide useful information about vegetation
              structure and land-surface properties. These are nominal
              educational wavelengths, not a frequency measurement from a
              selected product.
            </p>
          </article>
          <article>
            <span className="eyebrow">NISAR S-BAND</span>
            <h2>Approximately 9.4 cm</h2>
            <p>
              Complementary observations with a different acquisition-coverage
              pattern from L-band. Neither band is assumed available at every
              location; actual availability comes from source metadata.
            </p>
          </article>
        </section>

        <section className="lab-notes" aria-label="Radar interpretation notes">
          <div>
            <span className="eyebrow">BACKSCATTER</span>
            <h2>Not a photograph.</h2>
            <p>
              Brightness represents radar energy returned to the sensor.
              Comparable acquisitions need matching frequencies, polarization
              terms, geometry and compatible grids.
            </p>
          </div>
          <div>
            <span className="eyebrow">INTERFEROMETRY</span>
            <h2>Phase needs care.</h2>
            <p>
              Phase differences between acquisitions need coherence assessment,
              actual phase units and radar frequency, a stable reference
              location, quality masks and correction review. Apparent
              line-of-sight displacement is not GCOV amplitude change or
              vertical subsidence.
            </p>
          </div>
          <div>
            <span className="eyebrow">OFFSET TRACKING</span>
            <h2>Coordinates matter.</h2>
            <p>
              Range and azimuth offsets need source units, actual pixel spacing,
              acquisition intervals and quality checks. Radar-coordinate rates
              are not automatically horizontal or three-dimensional glacier
              speed.
            </p>
          </div>
        </section>

        <div className="lab-exit">
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setMode("observations");
              document.getElementById("lab-tab-observations")?.focus();
            }}
          >
            Explore a Real NISAR Observation <ArrowRight size={16} />
          </button>
          <Link className="primary-button" to={`/explore/${slug}`}>
            Open the Full FLAGWA Explorer <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <div
        role="tabpanel"
        id="lab-panel-observations"
        aria-labelledby="lab-tab-observations"
        hidden={mode !== "observations"}
      >
        {mode === "observations" && (
          <Suspense
            fallback={<Loading label="Opening the real observation lab" />}
          >
            <ObservationLab initialSlug={slug} />
          </Suspense>
        )}
      </div>
    </main>
  );
}
