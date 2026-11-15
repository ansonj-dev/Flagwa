import { Link } from "react-router-dom";
import { ArrowUpRight, Radio } from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { useProviders } from "../services/data";
import { ErrorState, Loading, StatusBadge } from "../components/ui";
import { themeNames } from "../components/ScientificPanels";
export function About() {
  const providers = useProviders();
  return (
    <main className="about-page">
      <SiteHeader />
      <article className="about-content">
        <span className="eyebrow">FLAGWA / EVIDENCE STANDARD</span>
        <h1>
          Surface change.
          <br />
          With an audit trail.
        </h1>
        <p className="lead">
          FLAGWA connects real NASA–ISRO NISAR observations to reproducible
          surface-change workflows, place-based context and explicit
          uncertainty.
        </p>
        <section>
          <h2>Observation is not confirmation</h2>
          <p>
            The demonstrated GCOV workflow identifies radar-derived potential
            inundation candidates. It does not measure flood depth, establish
            confirmed flooding, or prove impact on a household. Independent
            local reference data and review are required.
          </p>
        </section>
        <section>
          <h2>Scientific maturity</h2>
          {providers.isPending ? (
            <Loading />
          ) : providers.error ? (
            <ErrorState error={providers.error} />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Product</th>
                  <th>Evidence status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(providers.data.analysis_capabilities).map(
                  ([theme, capability]) => (
                    <tr key={theme}>
                      <td>{themeNames[theme as keyof typeof themeNames]}</td>
                      <td className="mono">{capability.product}</td>
                      <td>
                        <StatusBadge
                          status="pending_validation"
                          experimental={theme !== "flood"}
                        />
                        <small>
                          {capability.requires ??
                            capability.status.replaceAll("_", " ")}
                        </small>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h2>Source-grounded context</h2>
          <p>
            Population, settlements, infrastructure, hydrology, land cover,
            rainfall and boundaries appear only when a licensed, versioned
            source has been registered. Missing datasets are unavailable, never
            zero. Proximity-based exposure is an estimate, not a damage
            assessment.
          </p>
        </section>
        <section>
          <h2>Public reading, restricted processing</h2>
          <p>
            Observation, comparison, provenance and exports are public.
            Authorized processing, download, cancellation and validation require
            a short-lived operator session. Administrative credentials stay on
            the server, not in browser code.
          </p>
        </section>
        <section>
          <h2>Read the sources</h2>
          <a
            className="text-button"
            href="https://nisar.jpl.nasa.gov/"
            target="_blank"
            rel="noreferrer"
          >
            NASA–ISRO NISAR <ArrowUpRight size={16} />
          </a>
          <a
            className="text-button"
            href="https://search.asf.alaska.edu/"
            target="_blank"
            rel="noreferrer"
          >
            Alaska Satellite Facility <ArrowUpRight size={16} />
          </a>
          <a
            className="text-button"
            href="https://github.com/ansonj-dev/Flagwa"
            target="_blank"
            rel="noreferrer"
          >
            FLAGWA source and technical documentation <ArrowUpRight size={16} />
          </a>
        </section>
        <Link className="primary-button" to="/explore/kuttanad">
          <Radio size={17} /> Open the evidence
        </Link>
      </article>
    </main>
  );
}
