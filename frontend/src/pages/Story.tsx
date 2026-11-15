import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Cloud,
  Eye,
  Layers2,
  Radio,
  ShieldCheck,
  TriangleAlert,
  Waves,
} from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { useCases, useLocations, useResults } from "../services/data";
import { Empty, ErrorState, Loading, StatusBadge } from "../components/ui";
import { formatDate, resultLocation } from "../utils/science";
import { themeNames } from "../components/ScientificPanels";
import { useExplorer } from "../store/explorer";
export function Story() {
  const reduced = useReducedMotion(),
    locations = useLocations(),
    cases = useCases(),
    results = useResults(),
    slug = useExplorer((state) => state.selectedLocation);
  const earthscoreResult = results.data?.find(
    (result) => resultLocation(result) === slug && !result.metadata.synthetic,
  );
  const earthscoreDates = earthscoreResult?.metadata.acquisition_dates ?? [];
  const reveal = {
    initial: { opacity: 0, y: reduced ? 0 : 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.2 },
    transition: { duration: reduced ? 0 : 0.65 },
  };
  return (
    <main className="story-page">
      <SiteHeader />
      <section className="earth-hero" aria-labelledby="hero-title">
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="signal-dot" /> NASA–ISRO NISAR · L-BAND RADAR
          </span>
          <h1 id="hero-title">FLAGWA</h1>
          <p className="hero-title">
            Earth changes.
            <br />
            Look closer.
          </p>
          <p className="hero-description">
            A surface that looks still is anything but.
            <br />
            Read the signals. Compare the observations.
            <br />
            Follow the evidence.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" to={`/explore/${slug}`}>
              Enter the explorer <ArrowUpRight size={17} />
            </Link>
            <Link className="text-button" to="/radar-lab">
              Discover the science <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="hero-coordinates mono">
          GLOBAL SURFACE CHANGE EXPLORER
          <br />
          <span>OBSERVATION ≠ CONFIRMATION</span>
        </div>
        <p className="image-credit">
          Illustrative Earth imagery · NASA Blue Marble
          <br />
          Not a NISAR measurement
        </p>
        <a className="scroll-cue" href="#earthscore">
          <ArrowDown size={18} /> Follow the Earthscore
        </a>
      </section>
      <section
        id="earthscore"
        className="earthscore-feature"
        aria-labelledby="earthscore-feature-title"
      >
        <motion.div {...reveal}>
          <span className="eyebrow">
            THE FLAGWA SIGNATURE / ARTISTIC ENCODING
          </span>
          <h2 id="earthscore-feature-title">
            THE EARTHSCORE<span>.</span>
          </h2>
          <p>Experience the rhythms of a changing Earth.</p>
          <p className="earthscore-feature-note">
            An artistic encoding of actual NISAR measurements. Scientific
            uncertainty stays part of the composition.
          </p>
          <Link
            className="primary-button"
            to={
              earthscoreResult
                ? `/earthscore/${slug}/results/${earthscoreResult.id}`
                : `/earthscore/${slug}`
            }
          >
            Experience THE EARTHSCORE <ArrowUpRight size={17} />
          </Link>
        </motion.div>
        <div className="earthscore-feature-source">
          {earthscoreDates.length >= 2 ? (
            <>
              <span className="eyebrow">
                {earthscoreResult?.metadata.location} / {earthscoreDates.length}{" "}
                ACTUAL ACQUISITIONS
              </span>
              <ol>
                <li>
                  <span>01 / REFERENCE</span>
                  <time dateTime={earthscoreDates[0]}>
                    {formatDate(earthscoreDates[0])}
                  </time>
                </li>
                <li>
                  <span>02 / OBSERVATION</span>
                  <time dateTime={earthscoreDates.at(-1)}>
                    {formatDate(earthscoreDates.at(-1))}
                  </time>
                </li>
                <li>
                  <span>03 / CHANGE</span>
                  <strong>Derived interval</strong>
                  <small>Not another acquisition</small>
                </li>
              </ol>
              <p>Observed. Derived. Interpreted. Never invented.</p>
            </>
          ) : (
            <p>
              Only completed scientific results can become a score. Missing
              observations remain visible gaps.
            </p>
          )}
        </div>
      </section>
      <section id="signal" className="story-section signal-section">
        <motion.div {...reveal} className="section-intro">
          <span className="eyebrow">01 / BEYOND THE VISIBLE</span>
          <h2>
            A different kind
            <br />
            of light.
          </h2>
          <p>
            Clouds and darkness obscure optical views. Radar sends its own
            microwave signal and measures what returns from Earth's surface.
          </p>
          <Link className="text-button" to="/radar-lab">
            Inside the radar lab <ArrowUpRight size={16} />
          </Link>
        </motion.div>
        <motion.div
          {...reveal}
          className="signal-diagram"
          role="img"
          aria-label="Educational illustration: microwave radar travels through clouds and returns from the ground; this is not a measured signal"
        >
          <Radio className="orbit-icon" size={38} />
          <div className="radar-beams">
            <i />
            <i />
            <i />
          </div>
          <Cloud className="cloud-icon" size={68} />
          <div className="terrain-line" />
          <span className="diagram-label mono">
            ILLUSTRATION · NOT OBSERVED DATA
          </span>
          <div className="signal-label">Transmit. Interact. Return.</div>
        </motion.div>
      </section>
      <section className="story-section evidence-section">
        <motion.div {...reveal} className="section-intro">
          <span className="eyebrow">02 / CHANGE, WITH CONTEXT</span>
          <h2>
            Two observations.
            <br />
            Better questions.
          </h2>
          <p>
            A change in radar backscatter is a clue, not a conclusion. Surface
            water, soil moisture, vegetation and viewing geometry can all change
            the return.
          </p>
          <p className="body-note">
            The Kuttanad workflow reports potential inundation candidates.
            Independent validation is still pending.
          </p>
          <Link className="primary-button" to="/explore/kuttanad/compare">
            Compare the real observations <ArrowUpRight size={16} />
          </Link>
        </motion.div>
        <motion.div {...reveal} className="evidence-principles">
          <div>
            <Eye />
            <span>01</span>
            <h3>Observed</h3>
            <p>
              Actual acquisition dates, source scenes and measured radar power.
            </p>
          </div>
          <div>
            <Layers2 />
            <span>02</span>
            <h3>Derived</h3>
            <p>
              Reproducible processing, explicit parameters and spatially aligned
              outputs.
            </p>
          </div>
          <div>
            <TriangleAlert />
            <span>03</span>
            <h3>Candidate</h3>
            <p>
              Uncertainty stays visible. No candidate is promoted to confirmed
              impact.
            </p>
          </div>
        </motion.div>
      </section>
      <section className="places-section">
        <div className="places-heading">
          <span className="eyebrow">03 / A PLANET OF QUESTIONS</span>
          <h2>Start with a place.</h2>
          <p>
            Eight research windows. Different surface processes. Evidence at
            different stages.
          </p>
        </div>
        {locations.isPending ? (
          <Loading />
        ) : locations.error ? (
          <ErrorState
            error={locations.error}
            retry={() => locations.refetch()}
          />
        ) : (
          <div className="place-grid">
            {locations.data?.map((location, index) => {
              const completed =
                  results.data?.filter(
                    (result) => resultLocation(result) === location.slug,
                  ) ?? [],
                study = cases.data?.find((item) => item.slug === location.slug);
              return (
                <motion.article
                  {...reveal}
                  transition={{
                    duration: reduced ? 0 : 0.5,
                    delay: reduced ? 0 : (index % 4) * 0.05,
                  }}
                  className="place-item"
                  key={location.id}
                >
                  <Link to={`/explore/${location.slug}`}>
                    <div
                      className={`place-visual theme-${location.hazard_type}`}
                    >
                      <img src="/earth.jpg" alt="" loading="lazy" />
                      <span className="place-index mono">0{index + 1}</span>
                      <ArrowUpRight size={20} />
                    </div>
                    <div className="place-info">
                      <span className="eyebrow">
                        {location.country} /{" "}
                        {themeNames[location.hazard_type] ??
                          location.hazard_type}
                      </span>
                      <h3>{location.name}</h3>
                      <p>
                        {study?.scientific_question ?? location.description}
                      </p>
                      <div className="place-status">
                        {completed.length ? (
                          <StatusBadge
                            status={completed[0].validation_status}
                          />
                        ) : (
                          <StatusBadge experimental />
                        )}
                        <span>
                          {completed.length
                            ? `${completed.length} completed analyses`
                            : "No completed analysis"}
                        </span>
                      </div>
                    </div>
                  </Link>
                </motion.article>
              );
            })}
          </div>
        )}
        <p className="section-footnote">
          Place imagery is illustrative NASA Earth imagery, not site-specific
          observation. Only backend-linked results appear as scientific
          evidence.
        </p>
      </section>
      <section className="trust-section">
        <ShieldCheck size={34} />
        <h2>
          A clear view includes
          <br />
          what we don't know.
        </h2>
        <p>
          Every result carries its acquisition history, algorithm version,
          validation status and limitations. Five advanced scientific workflows
          remain experimental, not operational monitoring.
        </p>
        <Link className="text-button" to="/about">
          Read the evidence standard <ArrowRight size={16} />
        </Link>
      </section>
      <footer className="site-footer">
        <Link className="brand" to="/">
          <Radio size={21} />
          FLAGWA
        </Link>
        <span>Global Surface Change Explorer</span>
        <a href="https://nisar.jpl.nasa.gov/" target="_blank" rel="noreferrer">
          NASA–ISRO NISAR <ArrowUpRight size={14} />
        </a>
        <span>Science first. Uncertainty visible.</span>
      </footer>
    </main>
  );
}
