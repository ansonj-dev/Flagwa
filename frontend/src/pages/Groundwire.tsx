import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Lightbulb,
  MapPin,
  MessageCircle,
  Radio,
  RefreshCw,
  Satellite,
  TriangleAlert,
} from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import { Empty, ErrorState, Loading, StatusBadge } from "../components/ui";
import {
  api,
  terminalStates,
  useJobs,
  useLocations,
  useReady,
  useResults,
} from "../services/data";
import type { AnalysisResult, Job, LocationRecord } from "../types/domain";
import { formatDate, formatNumber, resultLocation } from "../utils/science";
import {
  acquisitionWindow,
  makeGroundwireBrief,
  signalProfile,
} from "../features/groundwire/model";
import type { SignalProfile } from "../features/groundwire/model";
import "../features/groundwire/groundwire.css";

type FeedFilter = "all" | "review" | "processing";

function isValidated(result: AnalysisResult) {
  return ["validated", "approved"].includes(
    result.validation_status.toLowerCase(),
  );
}

function resultDate(result: AnalysisResult) {
  const dates = result.metadata.acquisition_dates ?? [];
  return dates.reduce((latest, date) => {
    const parsed = Date.parse(date);
    return Number.isFinite(parsed) && parsed > latest ? parsed : latest;
  }, 0);
}

function Profile({ profile }: { profile: SignalProfile }) {
  if (!profile) return null;
  if (profile.kind === "classes")
    return (
      <div
        className="groundwire-class-profile"
        role="img"
        aria-label={`Reported classification pixel counts, ${formatNumber(profile.total)} total pixels`}
      >
        <div className="groundwire-class-bar">
          {profile.entries.map((entry) => (
            <span
              key={entry.key}
              style={{
                width: `${(entry.count / profile.total) * 100}%`,
                background: entry.color,
              }}
              title={`${entry.label}: ${formatNumber(entry.count)} pixels`}
            />
          ))}
        </div>
        <ul>
          {profile.entries.map((entry) => (
            <li key={entry.key}>
              <span style={{ background: entry.color }} />
              {entry.label} · {formatNumber(entry.count)}
            </li>
          ))}
        </ul>
      </div>
    );

  const span = profile.maximum - profile.minimum,
    meanPosition =
      span > 0
        ? Math.max(
            0,
            Math.min(100, ((profile.mean - profile.minimum) / span) * 100),
          )
        : 50;
  return (
    <div
      className="groundwire-range-profile"
      role="img"
      aria-label={`Reported range ${formatNumber(profile.minimum, 2)} to ${formatNumber(profile.maximum, 2)} ${profile.units}; mean ${formatNumber(profile.mean, 2)} ${profile.units}`}
    >
      <div className="groundwire-range-track">
        <span style={{ left: `${meanPosition}%` }} />
      </div>
      <div>
        <span>
          Min {formatNumber(profile.minimum, 2)} {profile.units}
        </span>
        <b>
          Mean {formatNumber(profile.mean, 2)} {profile.units}
        </b>
        <span>
          Max {formatNumber(profile.maximum, 2)} {profile.units}
        </span>
      </div>
    </div>
  );
}

function ResultMessage({
  result,
  location,
  reduced,
  index,
}: {
  result: AnalysisResult;
  location?: LocationRecord;
  reduced: boolean | null;
  index: number;
}) {
  const brief = makeGroundwireBrief(result),
    profile = signalProfile(result),
    acquisition = acquisitionWindow(result);
  return (
    <motion.article
      className="groundwire-message"
      data-testid="groundwire-result"
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduced ? 0 : 0.3,
        delay: reduced ? 0 : index * 0.045,
      }}
    >
      <div className="groundwire-message-rail">
        <span className="groundwire-message-avatar">
          <Satellite size={17} />
        </span>
        <span className="groundwire-message-line" />
      </div>
      <div className="groundwire-message-body">
        <header className="groundwire-message-head">
          <div>
            <span className="groundwire-sender">
              <MapPin size={12} />
              {location
                ? `${location.name} · ${location.country}`
                : "Unlinked study area"}
            </span>
            <span className="groundwire-message-time">
              {acquisition
                ? `${acquisition.count} ${acquisition.count === 1 ? "pass" : "passes"} · ${formatDate(acquisition.last)}`
                : "Acquisition date not reported"}
            </span>
          </div>
          <StatusBadge
            status={result.validation_status}
            experimental={result.result_type !== "potential_inundation"}
          />
        </header>
        {result.metadata.synthetic && (
          <p className="groundwire-fixture-note">
            SOFTWARE FIXTURE · NOT ENVIRONMENTAL EVIDENCE
          </p>
        )}
        <span className="eyebrow groundwire-message-kind">
          RADAR FIELD REPORT / {result.id.slice(0, 8)}
        </span>
        <h2>{brief.label}</h2>
        <p className="groundwire-message-copy">{brief.message}</p>
        <Profile profile={profile} />
        <div className="groundwire-hypothesis">
          <Lightbulb size={15} />
          <p>
            <strong>Research lead · hypothesis</strong>
            {brief.hypothesis}
          </p>
        </div>
        <div className="groundwire-caveat">
          <TriangleAlert size={14} /> {brief.caveat}
        </div>
        <footer className="groundwire-message-footer">
          <span>
            {result.metadata.polarization ?? "Polarization not reported"} ·{" "}
            {result.metadata.frequency ?? "Frequency not reported"}
          </span>
          <Link
            to={
              location
                ? `/explore/${location.slug}/results/${result.id}`
                : "/explore"
            }
          >
            Open evidence <ArrowUpRight size={14} />
          </Link>
        </footer>
      </div>
    </motion.article>
  );
}

function JobMessage({
  job,
  location,
}: {
  job: Job;
  location?: LocationRecord;
}) {
  const progress = Math.max(0, Math.min(100, job.progress));
  return (
    <article className="groundwire-job" data-testid="groundwire-job">
      <div className="groundwire-job-icon">
        <Activity size={17} />
      </div>
      <div className="groundwire-job-content">
        <div className="groundwire-job-head">
          <span className="eyebrow">
            PROCESSOR UPDATE · {job.id.slice(0, 8)}
          </span>
          <span className="groundwire-live-label">
            <i /> {job.status.replaceAll("_", " ").toLowerCase()}
          </span>
        </div>
        <h2>{location?.name ?? "Study area processing"}</h2>
        <p>
          {job.job_type.replaceAll("_", " ")} · {job.input_scenes.length} source
          {job.input_scenes.length === 1 ? " scene" : " scenes"}
        </p>
        <div
          className="groundwire-progress"
          role="progressbar"
          aria-label={`Processing ${job.progress}% complete`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="groundwire-job-footer">
          <span>
            Started {formatDate(job.started_at ?? job.created_at, true)}
          </span>
          <span>{formatNumber(progress)}%</span>
        </div>
      </div>
    </article>
  );
}

export function Groundwire() {
  const reduced = useReducedMotion(),
    locations = useLocations(),
    results = useResults(true),
    jobs = useJobs(),
    ready = useReady();
  const [locationFilter, setLocationFilter] = useState("all"),
    [filter, setFilter] = useState<FeedFilter>("all");
  const allResults = results.data ?? [],
    allJobs = jobs.data ?? [],
    activeJobs = allJobs.filter((job) => !terminalStates.has(job.status)),
    locationsById = new Map(
      (locations.data ?? []).map((location) => [location.id, location]),
    ),
    locationsBySlug = new Map(
      (locations.data ?? []).map((location) => [location.slug, location]),
    );
  const locationResults = allResults.filter(
      (result) =>
        locationFilter === "all" || resultLocation(result) === locationFilter,
    ),
    visibleResults = locationResults
      .filter((result) => filter !== "review" || !isValidated(result))
      .slice()
      .sort((first, second) => resultDate(second) - resultDate(first)),
    visibleJobs = activeJobs.filter((job) => {
      if (filter === "review") return false;
      if (locationFilter === "all") return true;
      return locationsById.get(job.location_id ?? "")?.slug === locationFilter;
    }),
    reviewCount = locationResults.filter(
      (result) => !isValidated(result),
    ).length;
  const retry = () => {
    void locations.refetch();
    void results.refetch();
    void jobs.refetch();
    void ready.refetch();
  };
  const refreshed = results.dataUpdatedAt
    ? formatDate(new Date(results.dataUpdatedAt).toISOString(), true)
    : "Waiting for first sync";

  return (
    <main className="groundwire-page">
      <a className="skip-link" href="#groundwire-feed">
        Skip to the signal feed
      </a>
      <SiteHeader />
      <div className="groundwire-shell">
        <header className="groundwire-title">
          <div>
            <span className="eyebrow">
              <Radio size={13} /> GLOBAL RADAR / FIELD CHANNEL 01
            </span>
            <h1>GROUNDWIRE</h1>
            <p>
              The radar signal inbox. Reports, live processing, and the next
              question.
            </p>
          </div>
          <div className="groundwire-sync">
            <span
              className={
                ready.data?.status === "ready"
                  ? "groundwire-api-state is-ready"
                  : "groundwire-api-state"
              }
            >
              <i />
              {ready.data?.status === "ready"
                ? "API READY"
                : ready.isError
                  ? "API STATUS UNKNOWN"
                  : "CHECKING API"}
            </span>
            <span aria-live="polite">
              {results.isFetching
                ? "Syncing results…"
                : `Last sync · ${refreshed}`}
            </span>
            <button
              className="groundwire-refresh"
              type="button"
              onClick={retry}
              aria-label="Refresh Groundwire feed"
              title="Refresh Groundwire feed"
            >
              <RefreshCw
                size={15}
                className={results.isFetching ? "is-spinning" : ""}
              />
            </button>
          </div>
        </header>

        <section className="groundwire-counts" aria-label="Groundwire totals">
          <div>
            <span>STUDY AREAS</span>
            <strong>{locations.data?.length ?? "—"}</strong>
          </div>
          <div>
            <span>RESULTS ON FILE</span>
            <strong>{results.data ? allResults.length : "—"}</strong>
          </div>
          <div>
            <span>PROCESSING NOW</span>
            <strong>{jobs.data ? activeJobs.length : "—"}</strong>
          </div>
          <div>
            <span>VALIDATION QUEUE</span>
            <strong>
              {results.data
                ? allResults.filter((item) => !isValidated(item)).length
                : "—"}
            </strong>
          </div>
        </section>

        <div className="groundwire-layout">
          <aside
            className="groundwire-places"
            aria-label="Filter by study area"
          >
            <div className="groundwire-aside-heading">
              <span className="eyebrow">STUDY AREAS</span>
              <MapPin size={14} />
            </div>
            <button
              className="groundwire-place-filter"
              type="button"
              aria-pressed={locationFilter === "all"}
              onClick={() => setLocationFilter("all")}
            >
              <span>All locations</span>
              <small>{allResults.length}</small>
            </button>
            {locations.data?.map((location) => {
              const count = allResults.filter(
                (result) => resultLocation(result) === location.slug,
              ).length;
              return (
                <button
                  className="groundwire-place-filter"
                  type="button"
                  key={location.id}
                  aria-pressed={locationFilter === location.slug}
                  onClick={() => setLocationFilter(location.slug)}
                >
                  <span>
                    {location.name}
                    <small>{location.country}</small>
                  </span>
                  <small>{count}</small>
                </button>
              );
            })}
            <div className="groundwire-legend">
              <span className="eyebrow">EVIDENCE KEY</span>
              <p>
                <i className="legend-observed" /> Reported measurement
              </p>
              <p>
                <i className="legend-hypothesis" /> Research hypothesis
              </p>
              <p>
                <i className="legend-limit" /> Validation required
              </p>
            </div>
          </aside>

          <section
            className="groundwire-stream"
            id="groundwire-feed"
            aria-label="Radar signal feed"
          >
            <div className="groundwire-stream-head">
              <div>
                <span className="eyebrow">INCOMING / SOURCE-LINKED</span>
                <h2>Signal feed</h2>
              </div>
              <div
                className="groundwire-filters"
                role="group"
                aria-label="Signal filter"
              >
                {(
                  [
                    ["all", "All signals"],
                    ["review", "Review queue"],
                    ["processing", "In progress"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                    {value === "review" && <small>{reviewCount}</small>}
                    {value === "processing" && (
                      <small>{visibleJobs.length}</small>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {locations.isPending || results.isPending ? (
              <Loading label="Connecting to study records and radar results" />
            ) : locations.error || results.error ? (
              <ErrorState
                error={locations.error ?? results.error}
                retry={retry}
              />
            ) : (
              <div className="groundwire-feed-list" aria-live="polite">
                {visibleJobs.map((job) => (
                  <JobMessage
                    key={job.id}
                    job={job}
                    location={locationsById.get(job.location_id ?? "")}
                  />
                ))}
                {filter !== "processing" &&
                  visibleResults.map((result, index) => (
                    <ResultMessage
                      key={result.id}
                      result={result}
                      location={locationsBySlug.get(resultLocation(result))}
                      reduced={reduced}
                      index={index}
                    />
                  ))}
                {!visibleJobs.length && !visibleResults.length && (
                  <Empty
                    title={
                      filter === "processing"
                        ? "No analysis is running right now"
                        : filter === "review"
                          ? "No results are waiting for validation"
                          : "No radar reports for this location"
                    }
                  >
                    New records appear here when the backend publishes a
                    completed analysis.
                  </Empty>
                )}
              </div>
            )}
          </section>

          <aside className="groundwire-context" aria-label="Field desk context">
            <div className="groundwire-context-block">
              <span className="eyebrow">PROCESSOR STATUS</span>
              <h2>
                <Activity size={17} /> Work in flight
              </h2>
              {activeJobs.length ? (
                activeJobs.slice(0, 4).map((job) => (
                  <div className="groundwire-queue-item" key={job.id}>
                    <span>
                      {locationsById.get(job.location_id ?? "")?.name ??
                        "Study area"}
                    </span>
                    <b>{job.status.replaceAll("_", " ").toLowerCase()}</b>
                  </div>
                ))
              ) : (
                <p className="groundwire-context-note">
                  No active processing jobs.
                </p>
              )}
            </div>
            <div className="groundwire-context-block groundwire-next-question">
              <span className="eyebrow">READ THE SIGNAL</span>
              <h2>
                <MessageCircle size={17} /> Evidence before impact
              </h2>
              <p>
                A radar change can flag a place to investigate. It does not
                identify a cause, confirm damage, or replace local observations.
              </p>
              <Link to="/radar-lab">
                Radar field guide <ArrowRight size={14} />
              </Link>
            </div>
            <div className="groundwire-context-block">
              <span className="eyebrow">REVIEW QUEUE</span>
              <div className="groundwire-review-count">
                <Clock3 size={18} />
                <strong>
                  {results.data
                    ? allResults.filter((item) => !isValidated(item)).length
                    : "—"}
                </strong>
                <span>unvalidated results</span>
              </div>
              <p className="groundwire-context-note">
                Review state comes from each result record. Candidate area is
                not a confirmed affected area.
              </p>
            </div>
          </aside>
        </div>
        <footer className="groundwire-footer">
          <CheckCircle2 size={14} />
          <span>
            Messages use reported result metadata and statistics. Hypotheses are
            prompts for follow-up, not model-generated findings.
          </span>
          <span className="groundwire-polling">
            <i /> RESULTS POLL EVERY 30 SEC
          </span>
        </footer>
      </div>
    </main>
  );
}
