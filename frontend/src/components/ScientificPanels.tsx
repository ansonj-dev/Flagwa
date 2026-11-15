import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Download,
  FileCheck2,
  FlaskConical,
  RefreshCw,
  Search,
  Square,
  TriangleAlert,
  X,
  ExternalLink,
} from "lucide-react";
import type {
  AnalysisResult,
  ContextLayer,
  Job,
  JsonRecord,
  LocationRecord,
  Scene,
  Theme,
} from "../types/domain";
import {
  api,
  localApi,
  useContext,
  useContract,
  useExposure,
  useInspection,
  useJob,
  useJobs,
  useOperator,
  useProviders,
  terminalStates,
} from "../services/data";
import {
  Empty,
  ErrorState,
  IconButton,
  JsonView,
  Loading,
  SectionTitle,
  StatusBadge,
} from "./ui";
import {
  candidateCaveat,
  formatDate,
  formatNumber,
  numeric,
} from "../utils/science";
import { SchemaForm } from "./SchemaForm";

export const themeNames: Record<Theme, string> = {
  flood: "Flood & water",
  forest: "Forest disturbance",
  agriculture: "Agricultural response",
  glacier: "Glacier motion",
  wildfire: "Fire-associated change",
  deformation: "Ground deformation",
};
export function AnalysisPanel({
  location,
  scenes,
  onJob,
}: {
  location?: LocationRecord;
  scenes: Scene[];
  onJob: (id: string) => void;
}) {
  const contract = useContract(),
    providers = useProviders(),
    session = useOperator();
  const [theme, setTheme] = useState<Theme>(location?.hazard_type ?? "flood");
  useEffect(() => setTheme(location?.hazard_type ?? "flood"), [location?.slug]);
  const schema =
    contract.data?.paths[`/api/v1/analysis/${theme}`]?.post?.requestBody
      ?.content["application/json"].schema;
  const capability = providers.data?.analysis_capabilities[theme];
  const seed: JsonRecord = { location_slug: location?.slug ?? "" };
  if (["flood", "forest", "wildfire"].includes(theme)) {
    if (scenes[0]) seed.before_scene_id = scenes[0].scene_id;
    if (scenes[1]) seed.after_scene_id = scenes[1].scene_id;
  }
  return (
    <>
      <SectionTitle>Scientific workbench</SectionTitle>
      <label htmlFor="analysis-theme">Analysis theme</label>
      <select
        id="analysis-theme"
        value={theme}
        onChange={(event) => setTheme(event.target.value as Theme)}
      >
        {Object.entries(themeNames).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <StatusBadge
        status="pending_validation"
        experimental={theme !== "flood"}
      />
      <p className="body-note">
        {theme === "flood"
          ? candidateCaveat
          : (capability?.requires ??
            "This experimental workflow requires appropriate measured inputs and independent scientific validation.")}
      </p>
      <dl className="data-list">
        <div>
          <dt>Required product</dt>
          <dd>{capability?.product ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Scientific status</dt>
          <dd>{capability?.status.replaceAll("_", " ") ?? "Not reported"}</dd>
        </div>
      </dl>
      {!session.data?.authorized && (
        <p className="caution">
          <TriangleAlert size={16} /> Restricted operator session required to
          submit processing. Inputs are validated against the live backend
          contract.
        </p>
      )}
      {contract.isPending ? (
        <Loading label="Reading live request schema" />
      ) : contract.error ? (
        <ErrorState error={contract.error} />
      ) : schema && contract.data ? (
        <SchemaForm
          key={theme}
          schema={schema}
          contract={contract.data}
          seed={seed}
          disabled={!session.data?.authorized}
          label="Queue scientific analysis"
          onSubmit={async (body) => {
            const job = await localApi.post<Job>(
              `/operator/api/v1/analysis/${theme}`,
              body,
            );
            onJob(job.id);
          }}
        />
      ) : (
        <Empty title="This API does not expose the requested workflow" />
      )}
    </>
  );
}
export function JobDetail({
  id,
  onClose,
  onRetry,
}: {
  id: string;
  onClose?: () => void;
  onRetry?: (id: string) => void;
}) {
  const query = useJob(id),
    client = useQueryClient(),
    session = useOperator();
  const mutation = useMutation({
    mutationFn: (action: "cancel" | "retry") =>
      localApi.post<Job>(`/operator/api/v1/jobs/${id}/${action}`, {}),
    onSuccess: async (job) => {
      if (job.id !== id) onRetry?.(job.id);
      await client.invalidateQueries({ queryKey: ["job", id] });
      await client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  useEffect(() => {
    if (query.data?.status === "COMPLETED")
      void client.invalidateQueries({ queryKey: ["results"] });
  }, [query.data?.status]);
  if (query.isPending) return <Loading label="Reading job status" />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const job = query.data!;
  return (
    <div className="job-detail">
      <SectionTitle
        action={
          onClose && (
            <IconButton label="Close job detail" onClick={onClose}>
              <X size={15} />
            </IconButton>
          )
        }
      >
        {job.job_type} job
      </SectionTitle>
      <code>{job.id}</code>
      <div className="job-status" role="status">
        <span className={`status-dot ${job.status.toLowerCase()}`} />
        {job.status} · {formatNumber(job.progress)}%
      </div>
      <progress
        max={100}
        value={job.progress}
        aria-label="Processing progress"
      />
      <dl className="data-list">
        <div>
          <dt>Started</dt>
          <dd>{formatDate(job.started_at, true)}</dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd>{formatDate(job.heartbeat_at, true)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{formatDate(job.completed_at, true)}</dd>
        </div>
      </dl>
      {job.error_message && <p className="error-text">{job.error_message}</p>}
      {session.data?.authorized && (
        <div className="button-row">
          {!terminalStates.has(job.status) && (
            <button
              className="secondary-button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("cancel")}
            >
              <Square size={14} /> Cancel job
            </button>
          )}
          {["FAILED", "CANCELLED"].includes(job.status) && (
            <button
              className="secondary-button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("retry")}
            >
              <RefreshCw size={14} /> Explicit retry
            </button>
          )}
        </div>
      )}
      {mutation.error && <ErrorState error={mutation.error} />}
    </div>
  );
}
export function JobsPanel({
  trackedJob,
  onSelect,
}: {
  trackedJob?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const jobs = useJobs();
  return (
    <>
      <SectionTitle
        action={
          <IconButton label="Refresh jobs" onClick={() => jobs.refetch()}>
            <RefreshCw size={15} />
          </IconButton>
        }
      >
        Processing jobs
      </SectionTitle>
      {trackedJob && (
        <JobDetail
          id={trackedJob}
          onClose={() => onSelect(undefined)}
          onRetry={onSelect}
        />
      )}{" "}
      {jobs.isPending ? (
        <Loading />
      ) : jobs.error ? (
        <ErrorState error={jobs.error} />
      ) : !jobs.data?.length ? (
        <Empty title="No processing jobs registered" />
      ) : (
        <div className="record-list">
          {jobs.data.map((job) => (
            <button
              className="record-row"
              key={job.id}
              onClick={() => onSelect(job.id)}
            >
              <span>
                <strong>{job.job_type}</strong>
                <small>{formatDate(job.created_at, true)}</small>
                <code>{job.id.slice(0, 12)}…</code>
              </span>
              <span className="job-state">
                {job.status}
                <ChevronRight size={15} />
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function EvidencePanel({
  result,
  scenes,
  onJob,
}: {
  result?: AnalysisResult;
  scenes: Scene[];
  onJob: (id: string) => void;
}) {
  const [inspectionId, setInspectionId] = useState<string>(),
    [showValidation, setShowValidation] = useState(false);
  const inspection = useInspection(inspectionId),
    session = useOperator(),
    contract = useContract();
  const schema =
    result &&
    contract.data?.paths["/api/v1/results/{result_id}/validation"]?.post
      ?.requestBody?.content["application/json"].schema;
  if (!result)
    return (
      <Empty title="No result selected">
        Select a completed analysis to inspect its source chain.
      </Empty>
    );
  return (
    <>
      <SectionTitle>Evidence & provenance</SectionTitle>
      <StatusBadge status={result.validation_status} />
      <dl className="data-list">
        <div>
          <dt>Result</dt>
          <dd className="mono break">{result.id}</dd>
        </div>
        <div>
          <dt>Processing job</dt>
          <dd>
            <button
              className="text-button"
              onClick={() => onJob(result.analysis_job_id)}
            >
              {result.analysis_job_id.slice(0, 12)}…
            </button>
          </dd>
        </div>
        <div>
          <dt>Product / level</dt>
          <dd>{result.metadata.processing_level ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Frequency / group</dt>
          <dd>
            {result.metadata.frequency ?? "Not reported"} /{" "}
            {result.metadata.frequency_group ?? "Not reported"}
          </dd>
        </div>
        <div>
          <dt>Polarization</dt>
          <dd>{result.metadata.polarization ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Algorithm</dt>
          <dd>{result.metadata.algorithm_version ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Synthetic fixture</dt>
          <dd>
            {result.metadata.synthetic === true
              ? "Yes · not scientific evidence"
              : "No explicit fixture flag"}
          </dd>
        </div>
      </dl>
      <SectionTitle>Source observations</SectionTitle>
      {(result.metadata.source_scenes ?? []).map((id, index) => (
        <div className="source-record" key={id}>
          <span className="eyebrow">
            Observation {index + 1} ·{" "}
            {formatDate(result.metadata.acquisition_dates?.[index], true)}
          </span>
          <code className="break">{id}</code>
          <small>
            {scenes[index]?.product_type ?? "Product not reported"} ·{" "}
            {scenes[index]?.data_maturity ?? "Maturity not reported"} ·{" "}
            {scenes[index]?.source ?? "Provider not reported"}
          </small>
          <button
            className="text-button"
            onClick={() =>
              setInspectionId(inspectionId === id ? undefined : id)
            }
          >
            Inspect real HDF5 dataset inventory <ChevronRight size={14} />
          </button>
        </div>
      ))}
      {inspectionId &&
        (inspection.isPending ? (
          <Loading label="Reading HDF5 inspection" />
        ) : inspection.error ? (
          <ErrorState error={inspection.error} />
        ) : (
          <details open>
            <summary>Stored HDF5 inspection</summary>
            <JsonView value={inspection.data} />
          </details>
        ))}
      <SectionTitle>Uncertainty</SectionTitle>
      <ul className="uncertainty-list">
        {result.uncertainty_notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <details>
        <summary>Algorithm parameters</summary>
        <JsonView value={result.metadata.parameters} />
      </details>
      <details>
        <summary>Study boundary provenance</summary>
        <JsonView value={result.metadata.study_boundary} />
      </details>
      <details>
        <summary>Context provenance</summary>
        <JsonView value={result.metadata.context_provenance} />
      </details>
      <details>
        <summary>Validation evidence / history</summary>
        <JsonView
          value={{
            sources: result.metadata.validation_sources ?? [],
            history: result.metadata.validation_history ?? [],
          }}
        />
      </details>
      <details>
        <summary>Complete public metadata</summary>
        <JsonView value={result.metadata} />
      </details>
      <button
        className="secondary-button full"
        disabled={!session.data?.authorized}
        onClick={() => setShowValidation(!showValidation)}
      >
        <FileCheck2 size={16} /> Independent validation review
      </button>
      {showValidation && schema && contract.data && (
        <SchemaForm
          schema={schema}
          contract={contract.data}
          label="Queue independent validation"
          onSubmit={async (body) => {
            const job = await localApi.post<Job>(
              `/operator/api/v1/results/${result.id}/validation`,
              body,
            );
            onJob(job.id);
          }}
        />
      )}
      <div className="download-row">
        {["geotiff", "geojson", "summary"].map((type) => (
          <a key={type} href={api.url(`/api/v1/exports/${result.id}/${type}`)}>
            <Download size={15} />
            {type}
          </a>
        ))}
      </div>
    </>
  );
}
function CommunitySource({ slug, type }: { slug: string; type: string }) {
  const query = useContext(slug, type);
  return (
    <details>
      <summary>
        {type.replaceAll("_", " ")}
        <span className={query.data ? "source-available" : "muted"}>
          {query.isPending
            ? "Checking"
            : query.data
              ? "Registered"
              : "Unavailable"}
        </span>
      </summary>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <JsonView value={query.data} />
      )}
    </details>
  );
}
export function CommunityPanel({
  slug,
  result,
  distance,
  setDistance,
}: {
  slug: string;
  result?: AnalysisResult;
  distance: number;
  setDistance: (value: number) => void;
}) {
  const exposure = useExposure(slug, result?.id, distance);
  return (
    <>
      <SectionTitle>Community context</SectionTitle>
      <p className="body-note">
        Exposure is a spatial overlay estimate, not a count of confirmed
        affected people. Missing coverage is not zero exposure.
      </p>
      <label htmlFor="proximity">
        Proximity threshold <span className="mono">{distance} m</span>
      </label>
      <input
        id="proximity"
        type="range"
        min="0"
        max="1000"
        step="50"
        value={distance}
        onChange={(event) => setDistance(Number(event.target.value))}
      />
      {!result ? (
        <Empty title="No result available for exposure overlay" />
      ) : exposure.isPending ? (
        <Loading label="Calculating registered-context overlay" />
      ) : exposure.error ? (
        <ErrorState error={exposure.error} />
      ) : (
        <>
          <StatusBadge status={exposure.data.validation_status} />
          {exposure.data.estimates.length ? (
            exposure.data.estimates.map((estimate) => (
              <div className="source-record" key={estimate.context_layer_id}>
                <h4>{estimate.layer_type.replaceAll("_", " ")}</h4>
                <span className="eyebrow">
                  {estimate.source} · {estimate.version}
                </span>
                <JsonView value={estimate.exposure} />
                <details>
                  <summary>License and source provenance</summary>
                  <JsonView value={estimate.provenance} />
                </details>
              </div>
            ))
          ) : (
            <Empty title="No exposure estimate available">
              No eligible registered context source covers this analysis.
            </Empty>
          )}
          <p className="body-note">
            Unavailable:{" "}
            {exposure.data.unavailable_layer_types.join(", ") ||
              "None reported"}
          </p>
          <ul className="uncertainty-list">
            {exposure.data.limitations.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
      <SectionTitle>Registered source inventory</SectionTitle>
      {[
        "population",
        "settlements",
        "infrastructure",
        "landcover",
        "hydrology",
        "permanent_water",
        "rainfall",
        "boundaries",
      ].map((type) => (
        <CommunitySource key={type} slug={slug} type={type} />
      ))}
    </>
  );
}

export function CatalogPanel({
  location,
  onJob,
}: {
  location?: LocationRecord;
  onJob: (id: string) => void;
}) {
  const contract = useContract(),
    session = useOperator();
  const [searchResult, setSearchResult] = useState<{
      data: Scene[];
      meta: import("../services/api-client").ResponseMeta;
    }>(),
    [before, setBefore] = useState(""),
    [after, setAfter] = useState(""),
    [compatibility, setCompatibility] = useState<unknown>(),
    [error, setError] = useState<unknown>();
  const [downloadScene, setDownloadScene] = useState("");
  const [searchBody, setSearchBody] = useState<JsonRecord>({});
  const pagination = useMutation({
    mutationFn: () =>
      api.postPage<Scene[]>("/api/v1/catalog/nisar/search", {
        ...searchBody,
        offset:
          (searchResult?.meta.offset ?? 0) + (searchResult?.meta.limit ?? 25),
      }),
    onSuccess: (page) =>
      setSearchResult((previous) => ({
        data: [
          ...new Map(
            [...(previous?.data ?? []), ...page.data].map((scene) => [
              scene.scene_id,
              scene,
            ]),
          ).values(),
        ],
        meta: page.meta,
      })),
  });
  const searchSchema =
    contract.data?.paths["/api/v1/catalog/nisar/search"]?.post?.requestBody
      ?.content["application/json"].schema;
  const downloadSchema =
    contract.data?.paths["/api/v1/scenes/{scene_id}/download"]?.post
      ?.requestBody?.content["application/json"].schema;
  const compatibilitySchema =
    contract.data?.paths["/api/v1/catalog/nisar/compatibility-check"]?.post
      ?.requestBody?.content["application/json"].schema;
  const scenes = searchResult?.data ?? [];
  return (
    <>
      <SectionTitle>Discover NISAR observations</SectionTitle>
      <p className="body-note">
        Catalogue discovery does not guarantee download authorization, spatial
        overlap, compatible measurements or scientific validity.
      </p>
      {contract.isPending ? (
        <Loading />
      ) : contract.error ? (
        <ErrorState error={contract.error} />
      ) : (
        searchSchema &&
        contract.data && (
          <details open>
            <summary>Catalogue search</summary>
            <SchemaForm
              schema={searchSchema}
              contract={contract.data}
              seed={
                location?.geometry?.type === "Polygon"
                  ? { aoi: location.geometry, data_maturity: "PROVISIONAL" }
                  : { data_maturity: "PROVISIONAL" }
              }
              label="Search live catalogue"
              onSubmit={async (body) => {
                const response = await api.postPage<Scene[]>(
                  "/api/v1/catalog/nisar/search",
                  body,
                );
                setSearchBody(body);
                setSearchResult(response);
              }}
            />
          </details>
        )
      )}
      {searchResult && (
        <>
          <SectionTitle>{scenes.length} returned observations</SectionTitle>
          {scenes.length ? (
            scenes.map((scene) => (
              <div className="source-record" key={scene.scene_id}>
                <strong>{formatDate(scene.acquisition_datetime, true)}</strong>
                <code className="break">{scene.scene_id}</code>
                <small>
                  {scene.product_type} · {scene.data_maturity} ·{" "}
                  {scene.polarizations.join(" / ")}
                </small>
                <div className="button-row">
                  <button
                    className="text-button"
                    onClick={() => setBefore(scene.scene_id)}
                  >
                    Set before
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setAfter(scene.scene_id)}
                  >
                    Set after
                  </button>
                  <button
                    className="text-button"
                    disabled={!session.data?.authorized}
                    onClick={() => setDownloadScene(scene.scene_id)}
                  >
                    Download
                  </button>
                </div>
              </div>
            ))
          ) : (
            <Empty title="No matching observations">
              Change the query rather than substituting another scene.
            </Empty>
          )}
          <details>
            <summary>Catalogue response metadata</summary>
            <JsonView value={searchResult.meta} />
          </details>
          {searchResult.meta.has_more && (
            <button
              className="secondary-button full"
              disabled={pagination.isPending}
              onClick={() => pagination.mutate()}
            >
              {pagination.isPending
                ? "Reading provider page…"
                : "Load next observations"}
              <ChevronRight size={15} />
            </button>
          )}
          {pagination.error && <ErrorState error={pagination.error} />}
        </>
      )}
      {compatibilitySchema && contract.data && (
        <details>
          <summary>Compatibility check</summary>
          <SchemaForm
            schema={compatibilitySchema}
            contract={contract.data}
            seed={{
              before_scene_id: before,
              after_scene_id: after,
              location_slug: location?.slug ?? "",
            }}
            label="Check measured compatibility"
            onSubmit={async (body) => {
              setCompatibility(
                await api.post(
                  "/api/v1/catalog/nisar/compatibility-check",
                  body,
                ),
              );
            }}
          />
          {Boolean(compatibility) && <JsonView value={compatibility} />}
        </details>
      )}
      {downloadScene && downloadSchema && contract.data && (
        <details open>
          <summary>Download selected scene</summary>
          <code className="break">{downloadScene}</code>
          <SchemaForm
            schema={downloadSchema}
            contract={contract.data}
            seed={{ location_slug: location?.slug ?? "" }}
            disabled={!session.data?.authorized}
            label="Queue authorized download"
            onSubmit={async (body) => {
              const job = await localApi.post<Job>(
                `/operator/api/v1/scenes/${encodeURIComponent(downloadScene)}/download`,
                body,
              );
              onJob(job.id);
            }}
          />
        </details>
      )}
      {Boolean(error) && <ErrorState error={error} />}
    </>
  );
}
