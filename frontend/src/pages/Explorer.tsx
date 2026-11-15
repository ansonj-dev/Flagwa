import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Database,
  FileCheck2,
  FlaskConical,
  Globe2,
  Layers,
  ListFilter,
  LockKeyhole,
  MapPin,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  Search,
  Users,
  X,
} from "lucide-react";
import type { FeatureCollection } from "geojson";
import {
  api,
  useAvailability,
  useExposure,
  useLocations,
  useManifest,
  useReady,
  useResult,
  useResults,
  useSourceScenes,
} from "../services/data";
import { useExplorer } from "../store/explorer";
import type { Panel } from "../store/explorer";
import type { AnalysisResult } from "../types/domain";
import {
  formatDate,
  formatNumber,
  isCategorical,
  measurementStyle,
  numeric,
  resultLabel,
  resultLocation,
} from "../utils/science";
import { MapCanvas } from "../components/map/MapCanvas";
import { ResultOverview } from "../components/ResultOverview";
import {
  AnalysisPanel,
  CatalogPanel,
  CommunityPanel,
  EvidencePanel,
  JobsPanel,
  themeNames,
} from "../components/ScientificPanels";
import {
  Empty,
  ErrorState,
  IconButton,
  Loading,
  SectionTitle,
} from "../components/ui";
import { OperatorAccess } from "../components/OperatorAccess";

const panels: { id: Panel; name: string; icon: typeof Layers }[] = [
  { id: "overview", name: "Observation summary", icon: Globe2 },
  { id: "layers", name: "Map layers", icon: Layers },
  { id: "catalog", name: "Catalogue and compatibility", icon: Search },
  { id: "community", name: "Community context", icon: Users },
  { id: "evidence", name: "Evidence and provenance", icon: FileCheck2 },
  { id: "analysis", name: "Scientific workbench", icon: FlaskConical },
  { id: "jobs", name: "Processing jobs", icon: Activity },
];
function LayersPanel({
  result,
  observations,
  change,
}: {
  result?: AnalysisResult;
  observations: boolean;
  change: boolean;
}) {
  const {
    layers,
    toggleLayer,
    opacity,
    setOpacity,
    selectedObservation,
    setObservation,
  } = useExplorer();
  const options = [
    {
      id: "classification",
      label:
        result?.result_type === "potential_inundation"
          ? "Candidate classification"
          : "Derived measurement",
      kind: "derived",
      enabled: Boolean(result),
    },
    {
      id: "change",
      label: "Backscatter change · dB",
      kind: "derived",
      enabled: change,
    },
    {
      id: "candidates",
      label: "Candidate polygons",
      kind: "candidate",
      enabled: Boolean(result?.result_type === "potential_inundation"),
    },
    {
      id: "boundary",
      label: "Draft study boundary",
      kind: "context",
      enabled: true,
    },
    {
      id: "footprints",
      label: "Source scene footprints",
      kind: "observed",
      enabled: true,
    },
    {
      id: "community",
      label: "Registered community features",
      kind: "context",
      enabled: true,
    },
  ];
  return (
    <>
      <SectionTitle>Map layers</SectionTitle>
      <fieldset className="observation-options">
        <legend>Observed · prepared GCOV power</legend>
        <div className="segmented">
          {["Before", "After"].map((label, index) => (
            <button
              key={label}
              disabled={!observations}
              aria-pressed={selectedObservation === index}
              onClick={() => setObservation(index)}
            >
              {label}
            </button>
          ))}
        </div>
        {!observations && (
          <small>Observation bytes unavailable on this deployment.</small>
        )}
      </fieldset>
      <div className="layer-list">
        {options.map((option) => (
          <label className="layer-row" key={option.id}>
            <span className={`layer-swatch ${option.kind}`} />
            <span>
              {option.label}
              <small>
                {option.kind}
                {!option.enabled && " · unavailable"}
              </small>
            </span>
            <input
              type="checkbox"
              checked={Boolean(layers[option.id])}
              disabled={!option.enabled}
              onChange={() => toggleLayer(option.id)}
            />
          </label>
        ))}
      </div>
      <label htmlFor="raster-opacity">
        Derived layer opacity{" "}
        <span className="mono">{Math.round(opacity * 100)}%</span>
      </label>
      <input
        id="raster-opacity"
        type="range"
        min="0"
        max="1"
        step=".05"
        value={opacity}
        onChange={(event) => setOpacity(Number(event.target.value))}
      />
      <p className="body-note">
        Solid cyan: observed. Dashed cyan: derived. Dashed amber: candidate.
        Dotted grey-blue: contextual source.
      </p>
    </>
  );
}
function Legend({
  result,
  change,
  compare,
}: {
  result?: AnalysisResult;
  change: boolean;
  compare: boolean;
}) {
  if (!result) return null;
  if (compare)
    return (
      <div className="map-legend">
        <strong>Observed GCOV power · shared display scale</strong>
        <div className="color-scale power" />
        <div className="scale-labels">
          <span>−30 dB</span>
          <span>10 log₁₀(power)</span>
          <span>0 dB</span>
        </div>
      </div>
    );
  const scale = measurementStyle(result, change);
  return (
    <div className="map-legend">
      <strong>{change ? "Derived change · dB" : resultLabel(result)}</strong>
      {!change && isCategorical(result) ? (
        <div className="legend-items">
          {Object.entries(result.metadata.class_legend ?? {})
            .filter(([key]) => !["0", "1"].includes(key))
            .map(([key, value]) => (
              <span key={key}>
                <i
                  className={
                    key === "2"
                      ? "water"
                      : key === "4"
                        ? "uncertain"
                        : "inundation"
                  }
                />
                {value.replaceAll("_", " ")}
              </span>
            ))}
          <span>
            <i className="nodata" />
            No data / transparent
          </span>
        </div>
      ) : scale ? (
        <>
          <div className={`color-scale ${scale.palette}`} />
          <div className="scale-labels">
            <span>{formatNumber(scale.minimum, 2)}</span>
            <span>
              {String(
                change
                  ? (result.statistics.change_units ?? "dB")
                  : (result.statistics.units ??
                      result.metadata.units ??
                      "Units not reported"),
              )}
            </span>
            <span>{formatNumber(scale.maximum, 2)}</span>
          </div>
        </>
      ) : (
        <p className="body-note">
          Measured display range unavailable. Use the original export.
        </p>
      )}
    </div>
  );
}
export function Explorer() {
  const params = useParams(),
    navigate = useNavigate(),
    route = useLocation();
  const slug = params.locationSlug ?? useExplorer.getState().selectedLocation;
  const locations = useLocations(),
    results = useResults(),
    availability = useAvailability(slug),
    readiness = useReady();
  const direct = useResult(params.resultId);
  const location = locations.data?.find((item) => item.slug === slug);
  const localResults =
    results.data?.filter((item) => resultLocation(item) === slug) ?? [];
  const result = params.resultId
    ? direct.data?.metadata.location === slug
      ? direct.data
      : undefined
    : localResults[0];
  const manifest = useManifest(result?.id),
    sourceQueries = useSourceScenes(result),
    scenes = sourceQueries.flatMap((query) => (query.data ? [query.data] : []));
  const {
    panel,
    setPanel,
    sheet,
    setSheet,
    compare,
    setCompare,
    selectLocation,
    selectedObservation,
    setObservation,
    layers,
    selectedFeature,
  } = useExplorer();
  const [operator, setOperator] = useState(false),
    [panelOpen, setPanelOpen] = useState(true),
    [trackedJob, setTrackedJob] = useState<string>(),
    [distance, setDistance] = useState(100);
  const exposure = useExposure(
    slug,
    panel === "community" ? result?.id : undefined,
    distance,
  );
  const community: FeatureCollection | undefined = exposure.data
    ? {
        type: "FeatureCollection",
        features: exposure.data.estimates.flatMap(
          (estimate) => estimate.exposure.features ?? [],
        ),
      }
    : undefined;
  const candidates = useQuery({
    queryKey: ["candidate-polygons", result?.id],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        api.url(`/api/v1/exports/${result!.id}/geojson`),
        { signal },
      );
      if (!response.ok)
        throw new Error(
          "Candidate geometry could not be read. The raster remains available.",
        );
      return response.json() as Promise<FeatureCollection>;
    },
    enabled: Boolean(result && layers.candidates),
    staleTime: Infinity,
    retry: false,
  });
  const hasObservations = Boolean(
    manifest.data?.layers.before_power && manifest.data?.layers.after_power,
  );
  const compareRequested = route.pathname.endsWith("/compare");
  useEffect(() => {
    selectLocation(slug);
  }, [slug, selectLocation]);
  useEffect(() => {
    setCompare(compareRequested && hasObservations);
  }, [compareRequested, hasObservations, setCompare]);
  const onJob = (id: string) => {
    setTrackedJob(id);
    setPanel("jobs");
  };
  const dates =
    result?.metadata.acquisition_dates ??
    scenes
      .map((scene) => scene.acquisition_datetime)
      .filter((date): date is string => Boolean(date));
  return (
    <main
      className={`explorer ${panelOpen ? "" : "panel-hidden"} sheet-${sheet}`}
    >
      <a className="skip-link" href="#explorer-panel">
        Skip map to evidence
      </a>
      <MapCanvas
        location={location}
        result={result}
        manifest={manifest.data}
        scenes={scenes}
        candidates={candidates.data}
        community={community}
      />
      <aside className="tool-rail" aria-label="Explorer tools">
        <Link className="rail-brand" to="/" aria-label="FLAGWA story">
          <Radio size={25} />
        </Link>
        {panels.map(({ id, name, icon: Icon }) => (
          <IconButton
            key={id}
            label={name}
            aria-pressed={panel === id && panelOpen}
            onClick={() => {
              setPanel(id);
              setPanelOpen(true);
            }}
          >
            <Icon size={20} />
          </IconButton>
        ))}
        <div className="rail-spacer" />
        <IconButton
          label="Restricted operator access"
          onClick={() => setOperator(true)}
        >
          <LockKeyhole size={19} />
        </IconButton>
      </aside>
      <header className="explorer-hud glass">
        <Link className="brand" to="/">
          FLAGWA<span>EARTH OBSERVATORY</span>
        </Link>
        <div className="hud-divider" />
        <div className="location-picker">
          <MapPin size={16} />
          <label className="sr-only" htmlFor="location-select">
            Study location
          </label>
          <select
            id="location-select"
            value={slug}
            onChange={(event) => navigate(`/explore/${event.target.value}`)}
          >
            {locations.data?.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name}, {item.country}
              </option>
            ))}
            {!locations.data && (
              <option value={slug}>Connecting to backend…</option>
            )}
          </select>
        </div>
        <nav className="mode-nav" aria-label="Experience mode">
          <Link to="/">Story</Link>
          <Link className="active" to={`/explore/${slug}`}>
            Explore
          </Link>
          <Link to="/radar-lab">Radar Lab</Link>
        </nav>
        <span
          className={`connection ${readiness.isSuccess ? "" : "offline"}`}
          title={
            readiness.isSuccess
              ? "Backend dependencies ready; this is not scientific validation."
              : "Backend readiness unavailable"
          }
        >
          <span />
          {readiness.isSuccess ? "Backend ready" : "Backend unavailable"}
        </span>
        <IconButton
          label={panelOpen ? "Hide evidence panel" : "Show evidence panel"}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? (
            <PanelRightClose size={19} />
          ) : (
            <PanelRightOpen size={19} />
          )}
        </IconButton>
      </header>
      <div className="map-heading">
        <span className="eyebrow">GLOBAL SURFACE CHANGE EXPLORER</span>
        <h1>{location?.name ?? "Earth, observed"}</h1>
        <p>
          {location
            ? `${location.country} · ${themeNames[location.hazard_type] ?? location.hazard_type}`
            : "Backend-linked scientific evidence"}
        </p>
        <div className="map-actions">
          <button
            className={`secondary-button ${compare ? "selected" : ""}`}
            disabled={!hasObservations}
            onClick={() =>
              navigate(
                compareRequested
                  ? `/explore/${slug}`
                  : `/explore/${slug}/compare`,
              )
            }
          >
            <ArrowLeftRight size={16} />
            {compare ? "Exit comparison" : "Compare observations"}
          </button>
          <span className="map-evidence-label">
            <span className="tiny-dash" />
            Not independently validated
          </span>
        </div>
      </div>
      {compareRequested && !hasObservations && manifest.isFetched && (
        <div className="compare-unavailable" role="status">
          Prepared before/after observations are unavailable. The contextual
          basemap is not a substitute for NISAR evidence.
        </div>
      )}
      <section
        className="context-panel glass"
        id="explorer-panel"
        aria-label={panels.find((item) => item.id === panel)?.name}
      >
        <div className="sheet-handle">
          <button
            aria-label={
              sheet === "peek"
                ? "Expand evidence panel"
                : "Collapse evidence panel"
            }
            onClick={() => setSheet(sheet === "peek" ? "half" : "peek")}
          >
            <span />
          </button>
          <div className="sheet-actions">
            <IconButton
              label="Half-height evidence panel"
              onClick={() => setSheet("half")}
            >
              <ChevronDown size={17} />
            </IconButton>
            <IconButton
              label="Full-height evidence panel"
              onClick={() => setSheet("full")}
            >
              <ChevronUp size={17} />
            </IconButton>
          </div>
        </div>
        <div className="panel-tabs" role="tablist" aria-label="Evidence views">
          {(["overview", "layers", "evidence"] as Panel[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={panel === id}
              onClick={() => setPanel(id)}
            >
              {id === "overview"
                ? "Summary"
                : id === "layers"
                  ? "Layers"
                  : "Evidence"}
            </button>
          ))}
        </div>
        <div className="panel-content" tabIndex={0}>
          {locations.isPending ? (
            <Loading />
          ) : locations.error ? (
            <ErrorState
              error={locations.error}
              retry={() => locations.refetch()}
            />
          ) : !location ? (
            <Empty title="Study location not found">
              <Link to="/explore">Return to the explorer</Link>
            </Empty>
          ) : results.error ? (
            <ErrorState error={results.error} retry={() => results.refetch()} />
          ) : direct.error && params.resultId ? (
            <ErrorState error={direct.error} />
          ) : results.isPending ? (
            <Loading label="Reading completed analysis records" />
          ) : (
            <>
              {localResults.length > 1 && (
                <div className="result-picker">
                  <label htmlFor="result-select">Completed analysis</label>
                  <select
                    id="result-select"
                    value={result?.id ?? ""}
                    onChange={(event) =>
                      navigate(`/explore/${slug}/results/${event.target.value}`)
                    }
                  >
                    {localResults.map((item) => (
                      <option key={item.id} value={item.id}>
                        {formatDate(item.metadata.acquisition_dates?.at(-1))} ·{" "}
                        {item.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {panel === "overview" && (
                <ResultOverview result={result} location={location} />
              )}
              {panel === "layers" && (
                <LayersPanel
                  result={result}
                  observations={hasObservations}
                  change={Boolean(manifest.data?.layers.change_geotiff)}
                />
              )}
              {panel === "catalog" && (
                <CatalogPanel location={location} onJob={onJob} />
              )}
              {panel === "community" && (
                <CommunityPanel
                  slug={slug}
                  result={result}
                  distance={distance}
                  setDistance={setDistance}
                />
              )}
              {panel === "evidence" && (
                <EvidencePanel result={result} scenes={scenes} onJob={onJob} />
              )}
              {panel === "analysis" && (
                <AnalysisPanel
                  location={location}
                  scenes={scenes}
                  onJob={onJob}
                />
              )}
              {panel === "jobs" && (
                <JobsPanel trackedJob={trackedJob} onSelect={setTrackedJob} />
              )}
              {manifest.data && !manifest.data.enabled && (
                <details className="availability-note">
                  <summary>Observation availability</summary>
                  <p>{manifest.data.reason}</p>
                </details>
              )}
              {manifest.error && <ErrorState error={manifest.error} />}
              {candidates.error && <ErrorState error={candidates.error} />}
              {selectedFeature && (
                <details open>
                  <summary>Selected map feature</summary>
                  <dl className="data-list">
                    {Object.entries(selectedFeature).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </>
          )}
        </div>
        <div className="panel-footer">
          <Database size={12} />
          <span>
            {availability.data
              ? `${availability.data.known_catalogue_scenes} catalogue scenes · ${availability.data.completed_results} completed analyses`
              : "Availability not established"}
          </span>
        </div>
      </section>
      <div className="map-bottom">
        <Legend
          result={result}
          change={Boolean(layers.change)}
          compare={compare}
        />
        <section
          className="timeline glass"
          aria-label="Actual acquisition timeline"
        >
          <div className="timeline-heading">
            <span>
              <Radio size={14} /> NISAR acquisition timeline
            </span>
            <small>{dates.length} source observations · UTC</small>
          </div>
          {dates.length ? (
            <div className="timeline-track">
              {dates.map((date, index) => (
                <button
                  key={`${date}-${index}`}
                  aria-pressed={selectedObservation === index}
                  onClick={() => {
                    setObservation(index);
                    useExplorer.setState((state) => ({
                      layers: { ...state.layers, classification: false },
                    }));
                  }}
                >
                  <i />
                  <time dateTime={date}>{formatDate(date)}</time>
                  <small>
                    {index === 0
                      ? "Before"
                      : index === dates.length - 1
                        ? "After"
                        : "Observation"}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-timeline">
              No source acquisitions registered for this location.
            </p>
          )}
        </section>
      </div>
      {operator && <OperatorAccess onClose={() => setOperator(false)} />}
    </main>
  );
}
