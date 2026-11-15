import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Cloud, Radio, Sun, Waves } from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { useExplorer } from "../store/explorer";
export function RadarLab() {
  const [surface, setSurface] = useState("water"),
    [clouds, setClouds] = useState(true),
    [night, setNight] = useState(false),
    [polarization, setPolarization] = useState("HHHH");
  const slug = useExplorer((state) => state.selectedLocation);
  const explanations: Record<string, string> = {
    water:
      "Smooth open water often scatters energy away from the sensor, giving a weak return. Wind-roughened water can return more energy. Dark pixels alone do not establish flooding.",
    forest:
      "Branches, trunks and leaves scatter in many directions. Cross-polarized power can be sensitive to vegetation structure, but moisture and acquisition geometry also matter.",
    urban:
      "Walls and ground can produce strong double-bounce returns. Dense buildings may cause layover and radar shadow; brightness is not a population count.",
    soil: "Roughness and moisture both affect exposed-soil backscatter. A stronger return is not a direct measurement of water content or crop yield.",
  };
  return (
    <main className="lab-page">
      <SiteHeader />
      <div className="page-heading">
        <span className="eyebrow">THE RADAR LAB · EDUCATIONAL MODEL</span>
        <h1>
          Make sense of
          <br />
          the signal.
        </h1>
        <p>
          Explore the interactions behind an observation. This illustration is
          qualitative, not simulated or measured NISAR data.
        </p>
      </div>
      <section className="lab-workspace">
        <div
          className={`lab-scene surface-${surface} ${clouds ? "cloudy" : ""} ${night ? "night" : ""}`}
          role="img"
          aria-label={`Qualitative radar illustration over ${surface}, ${clouds ? "cloudy" : "clear"}, ${night ? "night" : "day"}`}
        >
          <div className="lab-orbit">
            <Radio size={42} />
            <span>NISAR</span>
          </div>
          {clouds && (
            <div className="lab-clouds">
              <Cloud size={90} />
              <Cloud size={65} />
            </div>
          )}
          <div className="lab-rays">
            <i />
            <i />
            <i />
          </div>
          <div className="lab-ground">
            <span>
              {surface === "water" ? (
                <Waves size={70} />
              ) : surface === "forest" ? (
                "╱╲ ╱╲ ╱╲"
              ) : surface === "urban" ? (
                "▥ ▥ ▥"
              ) : (
                "∿ ∿ ∿"
              )}
            </span>
          </div>
          <div className="lab-scene-label mono">
            QUALITATIVE ILLUSTRATION
            <br />
            NOT A SCIENTIFIC MEASUREMENT
          </div>
        </div>
        <div className="lab-controls">
          <h2>Surface interaction</h2>
          <fieldset>
            <legend>Surface</legend>
            <div className="segmented wrap">
              {["water", "forest", "urban", "soil"].map((value) => (
                <button
                  key={value}
                  aria-pressed={surface === value}
                  onClick={() => setSurface(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="lab-toggles">
            <label>
              <Cloud size={17} /> Clouds
              <input
                type="checkbox"
                checked={clouds}
                onChange={(event) => setClouds(event.target.checked)}
              />
            </label>
            <label>
              <Sun size={17} /> Night
              <input
                type="checkbox"
                checked={night}
                onChange={(event) => setNight(event.target.checked)}
              />
            </label>
          </div>
          <p>
            Radar supplies its own illumination and can observe through clouds,
            in daylight or darkness.
          </p>
          <label htmlFor="polarization">Covariance term</label>
          <select
            id="polarization"
            value={polarization}
            onChange={(event) => setPolarization(event.target.value)}
          >
            <option>HHHH</option>
            <option>HVHV</option>
            <option>VHVH</option>
            <option>VVVV</option>
          </select>
          <p>
            {polarization === "HHHH" || polarization === "VVVV"
              ? "Co-polarized power: transmit and receive in the same polarization."
              : "Cross-polarized power: transmit and receive in different polarizations."}{" "}
            Availability depends on the real source product; this selector does
            not assert scene availability.
          </p>
          <h3>{surface[0].toUpperCase() + surface.slice(1)}</h3>
          <p aria-live="polite">{explanations[surface]}</p>
        </div>
      </section>
      <section className="lab-notes">
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
            Apparent line-of-sight displacement requires phase units, measured
            radar frequency, a stable reference, quality masks and correction
            assessment. It is not interchangeable with GCOV amplitude change.
          </p>
        </div>
        <div>
          <span className="eyebrow">OFFSET TRACKING</span>
          <h2>Coordinates matter.</h2>
          <p>
            Radar-coordinate offset rates are not automatically horizontal
            glacier speed. Geometry, units, acquisition intervals and
            independent validation are indispensable.
          </p>
        </div>
      </section>
      <div className="lab-exit">
        <Link className="primary-button" to={`/explore/${slug}`}>
          Read a real observation <ArrowRight size={16} />
        </Link>
      </div>
    </main>
  );
}
