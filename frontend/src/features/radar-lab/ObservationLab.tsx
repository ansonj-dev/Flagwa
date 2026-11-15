import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Download,
  ExternalLink,
  FileSearch,
  RefreshCw,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  useCases,
  useExposure,
  useInspection,
  useLocations,
  useManifest,
  useResult,
  useResultMetadata,
  useResults,
  useResultStatistics,
  useScene,
} from "../../services/data";
import { ApiError } from "../../services/api-client";
import type {
  AnalysisResult,
  Inspection,
  Job,
  JsonRecord,
  LocationRecord,
  Scene,
} from "../../types/domain";
import {
  Empty,
  ErrorState,
  IconButton,
  JsonView,
  Loading,
  StatusBadge,
} from "../../components/ui";
import {
  formatDate,
  formatNumber,
  isCategorical,
  measurementStyle,
  resultLabel,
  resultLocation,
} from "../../utils/science";
import { useExplorer } from "../../store/explorer";
import {
  frequencyGroups,
  measuredSummary,
  polarizationDescription,
  powerDatasets,
  productGuides,
  productOf,
  reported,
} from "./observation";

const MapCanvas = lazy(() =>
  import("../../components/map/MapCanvas").then((module) => ({
    default: module.MapCanvas,
  })),
);
type Asset = "preview" | "geotiff" | "geojson" | "summary";
type MapLayer = "result" | "before" | "after" | "change";

function useAsset(id: string, asset: Asset) {
  return useQuery({
    queryKey: ["radar-asset", id, asset],
    queryFn: async ({ signal }) => {
      const url = api.url(
        asset === "preview"
          ? `/api/v1/results/${id}/preview`
          : `/api/v1/exports/${id}/${asset}`,
      );
      const response = await fetch(url, {
        signal,
        headers: { Range: "bytes=0-0" },
      });
      const type = response.headers.get("content-type") ?? "";
      const validType =
        asset === "preview"
          ? type.includes("image/png")
          : asset === "geotiff"
            ? type.includes("tiff")
            : type.includes("json");
      await response.body?.cancel();
      if (!response.ok || !validType)
        throw new ApiError(
          `The ${asset} asset is unavailable.`,
          response.status,
          "ASSET_UNAVAILABLE",
        );
      return url;
    },
    retry: false,
    staleTime: 60_000,
  });
}

function Fields({ rows }: { rows: [string, unknown][] }) {
  return (
    <dl className="lab-data-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{reported(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ObservationLab({ initialSlug }: { initialSlug: string }) {
  const locations = useLocations();
  const results = useResults();
  const cases = useCases();
  const [requestedSlug, setRequestedSlug] = useState(initialSlug);
  const location =
    locations.data?.find((item) => item.slug === requestedSlug) ??
    locations.data?.[0];
  const slug = location?.slug;
  const error = locations.error ?? results.error;
  const localResults =
    results.data?.filter((result) => resultLocation(result) === slug) ?? [];
  const caseStudy = cases.data?.find(
    (item) => item.location_id === location?.id || item.slug === slug,
  );

  return (
    <section
      className="lab-observations"
      aria-label="Real NISAR observation lab"
    >
      <div className="lab-observation-heading">
        <div>
          <span className="eyebrow">REAL OBSERVATIONS · READ-ONLY</span>
          <h2>Follow the evidence.</h2>
        </div>
        <IconButton
          label="Refresh observations"
          onClick={() => {
            void locations.refetch();
            void results.refetch();
          }}
        >
          <RefreshCw size={17} />
        </IconButton>
      </div>
      {locations.isPending || results.isPending ? (
        <Loading label="Reading actual locations and completed results" />
      ) : error ? (
        <ErrorState
          error={error}
          retry={() => {
            void locations.refetch();
            void results.refetch();
          }}
        />
      ) : !locations.data?.length ? (
        <Empty title="No study locations are currently available" />
      ) : (
        <>
          <div className="lab-location-select">
            <label htmlFor="lab-location">Study location</label>
            <select
              id="lab-location"
              value={slug}
              onChange={(event) => setRequestedSlug(event.target.value)}
            >
              {locations.data.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.name} · {item.country}
                </option>
              ))}
            </select>
            {caseStudy && <p>{caseStudy.scientific_question}</p>}
          </div>
          {location && (
            <ResultSelection
              key={slug}
              location={location}
              results={localResults}
            />
          )}
          {(results.data?.length ?? 0) >= 100 && (
            <p className="body-note">
              Showing the 100 most recent completed results from the backend.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ResultSelection({
  location,
  results,
}: {
  location: LocationRecord;
  results: AnalysisResult[];
}) {
  const [selectedId, setSelectedId] = useState("");
  const [product, setProduct] = useState("");
  const products = [
    ...new Set(
      results
        .map((item) => item.metadata.processing_level)
        .filter((item): item is string => Boolean(item)),
    ),
  ];
  const filtered = results.filter(
    (item) => !product || item.metadata.processing_level === product,
  );
  const selected =
    filtered.find((item) => item.id === selectedId) ?? filtered[0];
  if (!results.length)
    return (
      <>
        <Empty title="No processed NISAR observation is currently available for this study area.">
          No sample measurements are substituted. Catalogue search and
          compatibility checks remain in the full Explorer.
        </Empty>
        <div className="button-row">
          <Link
            className="secondary-button"
            to={`/explore/${location.slug}`}
            onClick={() => useExplorer.getState().setPanel("catalog")}
          >
            <FileSearch size={16} /> Open Catalogue and Compatibility{" "}
            <ArrowRight size={16} />
          </Link>
          <Link className="text-button" to={`/explore/${location.slug}`}>
            Open in FLAGWA Explorer <ArrowRight size={16} />
          </Link>
        </div>
        <FailedAnalyses location={location} />
      </>
    );
  return (
    <>
      <div className="lab-result-selectors">
        <div>
          <label htmlFor="lab-product">Product type</label>
          <select
            id="lab-product"
            value={product}
            onChange={(event) => {
              setProduct(event.target.value);
              setSelectedId("");
            }}
          >
            <option value="">All reported products</option>
            {products.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="lab-result">Completed analysis result</label>
          <select
            id="lab-result"
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {filtered.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} · {resultLabel(item)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {selected ? (
        <ObservationResult
          key={selected.id}
          id={selected.id}
          location={location}
        />
      ) : (
        <Empty title="No completed result for this product type" />
      )}
    </>
  );
}

function FailedAnalyses({ location }: { location: LocationRecord }) {
  const jobs = useQuery({
    queryKey: ["radar-job-history", location.id],
    queryFn: ({ signal }) => api.get<Job[]>("/api/v1/jobs?limit=50", signal),
    retry: false,
  });
  const failed =
    jobs.data?.filter(
      (job) => job.location_id === location.id && job.status === "FAILED",
    ) ?? [];
  return failed.length ? (
    <div className="caution" role="status">
      {failed.length} failed analysis job(s) reported. Failed processing is not
      a scientific result.
      <Link
        className="text-button"
        to={`/explore/${location.slug}`}
        onClick={() => useExplorer.getState().setPanel("jobs")}
      >
        Review processing jobs <ArrowRight size={15} />
      </Link>
    </div>
  ) : null;
}

function ObservationResult({
  id,
  location,
}: {
  id: string;
  location: LocationRecord;
}) {
  const query = useResult(id);
  const metadata = useResultMetadata(id);
  const statistics = useResultStatistics(id);
  const [requestedScene, setRequestedScene] = useState("");
  const record = query.data;
  const result = record
    ? {
        ...record,
        metadata: metadata.data ?? record.metadata,
        statistics: statistics.data ?? record.statistics,
      }
    : undefined;
  const sceneIds = result?.metadata.source_scenes ?? [];
  const sceneId = sceneIds.includes(requestedScene)
    ? requestedScene
    : sceneIds[0];
  const scene = useScene(sceneId);
  const inspection = useInspection(sceneId);
  const product = result ? productOf(result, scene.data) : "Not reported";
  const guide = productGuides[product];
  if (query.isPending) return <Loading label="Reading result provenance" />;
  if (query.error)
    return <ErrorState error={query.error} retry={() => query.refetch()} />;
  if (!result) return <Empty title="The selected result is unavailable" />;
  return (
    <div className="lab-result-detail">
      <header className="lab-evidence-title">
        <div>
          <span className="eyebrow">{guide?.title ?? product}</span>
          <h2>{resultLabel(result)}</h2>
        </div>
        <StatusBadge status={result.validation_status} />
      </header>
      {result.metadata.synthetic === true && (
        <p className="caution">
          Synthetic software fixture — not observational evidence.
        </p>
      )}
      {guide ? (
        <p className="lab-science-note">{guide.note}</p>
      ) : (
        <Empty title="Unsupported product visualization">
          Only metadata and verified assets are shown for this product.
        </Empty>
      )}
      {(metadata.error || statistics.error) && (
        <div className="lab-partial-error">
          <p>
            Some detail endpoints are unavailable. Any retained values below
            come from the selected result record, not a substitute measurement.
          </p>
          {metadata.error && (
            <ErrorState
              error={metadata.error}
              retry={() => metadata.refetch()}
            />
          )}
          {statistics.error && (
            <ErrorState
              error={statistics.error}
              retry={() => statistics.refetch()}
            />
          )}
        </div>
      )}
      <ProductVisualization
        key={`${id}-${product}`}
        result={result}
        location={location}
        scene={scene.data}
        product={product}
      />
      <div className="lab-evidence-grid">
        <section
          className="lab-evidence-section"
          aria-label="Actual observation metadata"
        >
          <h3>Observation & lineage</h3>
          <Fields
            rows={[
              ["Analysis ID", result.analysis_job_id],
              ["Result ID", id],
              ["Product type", product],
              ["Algorithm version", result.metadata.algorithm_version],
              ["Acquisition dates (UTC)", result.metadata.acquisition_dates],
              [
                "Processed frequency / group",
                [
                  result.metadata.frequency ?? "Not reported",
                  result.metadata.frequency_group ?? "Not reported",
                ],
              ],
              ["Processed polarization", result.metadata.polarization],
              [
                "Output units",
                result.statistics.units ?? result.metadata.units,
              ],
              ["Change units", result.statistics.change_units],
              ["Data maturity", result.metadata.data_maturity],
            ]}
          />
          <ProductDetails result={result} product={product} />
        </section>
        <section
          className="lab-evidence-section"
          aria-label="Real measured statistics"
        >
          <h3>Measured summary</h3>
          {statistics.isPending ? (
            <Loading label="Reading scientific statistics" />
          ) : (
            <MeasurementSummary result={result} product={product} />
          )}
          <details>
            <summary>All reported statistics</summary>
            <JsonView value={result.statistics} />
          </details>
        </section>
      </div>
      <section
        className="lab-source-section"
        aria-label="Source scene inspection"
      >
        <h3>Inside the source product</h3>
        {sceneIds.length ? (
          <>
            <label htmlFor="lab-scene-select">Relevant source scene</label>
            <select
              id="lab-scene-select"
              value={sceneId}
              onChange={(event) => setRequestedScene(event.target.value)}
            >
              {sceneIds.map((value, index) => (
                <option key={value} value={value}>
                  Observation {index + 1} · {value}
                </option>
              ))}
            </select>
            {scene.isPending ? (
              <Loading label="Reading source-scene metadata" />
            ) : scene.error ? (
              <ErrorState error={scene.error} retry={() => scene.refetch()} />
            ) : (
              scene.data && (
                <>
                  <Fields
                    rows={[
                      ["Scene ID", scene.data.scene_id],
                      [
                        "Mission",
                        inspection.data?.identification.missionId ??
                          scene.data.dataset,
                      ],
                      ["Dataset provider", scene.data.source],
                      ["Source product", scene.data.product_type],
                      ["Source maturity", scene.data.data_maturity],
                      ["Acquisition (UTC)", scene.data.acquisition_datetime],
                      ["Frequency", scene.data.frequency],
                      ["Polarization channels", scene.data.polarizations],
                      ["Orbit direction", scene.data.flight_direction],
                      ["Download status", scene.data.download_status],
                    ]}
                  />
                  {scene.data.download_status &&
                    scene.data.download_status !== "COMPLETED" && (
                      <p className="caution">
                        Scene not downloaded. A catalogue record alone does not
                        provide a locally renderable radar raster.
                      </p>
                    )}
                </>
              )
            )}
            {inspection.isPending ? (
              <Loading label="Reading actual HDF5 hierarchy" />
            ) : inspection.error ? (
              <>
                <Empty title="HDF5 inspection unavailable">
                  The source may not have been acquired and inspected on this
                  deployment. No dataset paths or power terms are assumed.
                </Empty>
                <ErrorState
                  error={inspection.error}
                  retry={() => inspection.refetch()}
                />
              </>
            ) : (
              inspection.data && (
                <HDF5Inspector
                  key={sceneId}
                  inspection={inspection.data}
                  scene={scene.data}
                />
              )
            )}
          </>
        ) : (
          <Empty title="No NISAR source scenes reported for this result" />
        )}
      </section>
      <ValidationPanel result={result} />
      <details className="lab-context">
        <summary>Community context availability</summary>
        <ContextOnDemand slug={location.slug} resultId={id} />
      </details>
      <footer className="lab-observation-footer">
        <Link
          className="primary-button"
          to={`/explore/${location.slug}/results/${id}`}
        >
          Open in FLAGWA Explorer <ArrowRight size={16} />
        </Link>
      </footer>
    </div>
  );
}

function ProductDetails({
  result,
  product,
}: {
  result: AnalysisResult;
  product: string;
}) {
  const request = result.metadata.parameters ?? {};
  const parameters: JsonRecord =
    request.parameters &&
    typeof request.parameters === "object" &&
    !Array.isArray(request.parameters)
      ? (request.parameters as JsonRecord)
      : request;
  const reports = Array.isArray(result.metadata.processing_report)
    ? (result.metadata.processing_report as JsonRecord[])
    : [];
  const dates = result.metadata.acquisition_dates ?? [];
  const interval =
    dates.length >= 2
      ? (Date.parse(dates[1]) - Date.parse(dates[0])) / 86_400_000
      : NaN;
  if (product === "GUNW")
    return (
      <>
        <h4>Interferometric inputs</h4>
        <Fields
          rows={[
            ["Phase dataset", request.phase_dataset],
            [
              "Phase units",
              reports.find((item) => item.dataset === request.phase_dataset)
                ?.units,
            ],
            ["Coherence dataset", request.coherence_dataset],
            ["Minimum coherence threshold", parameters.minimum_coherence],
            ["Connected components", request.connected_components_dataset],
            ["Reference location (WGS84)", parameters.reference_point],
            ["Reference justification", parameters.reference_justification],
            [
              "Measured center frequency (Hz)",
              reports.find((item) => item.center_frequency_hz !== undefined)
                ?.center_frequency_hz,
            ],
            ["Correction assessment", parameters.correction_assessment],
          ]}
        />
        <p className="body-note">
          Thresholds are processing settings, not measured coherence statistics.
          Actual dataset values are not exposed as a pixel time series by the
          inspection API.
        </p>
      </>
    );
  if (product === "GOFF")
    return (
      <>
        <h4>Radar-coordinate offset inputs</h4>
        <Fields
          rows={[
            ["Along-track offset dataset", request.along_track_dataset],
            ["Slant-range offset dataset", request.slant_range_dataset],
            [
              "Offset source units",
              reports.find(
                (item) => item.dataset === request.along_track_dataset,
              )?.units,
            ],
            ["Quality dataset", request.quality_dataset],
            ["Quality metric", parameters.quality_metric],
            ["Minimum quality threshold", parameters.minimum_quality],
            [
              "Acquisition interval",
              Number.isFinite(interval) && interval > 0
                ? `${interval} days (derived from reported acquisition dates)`
                : undefined,
            ],
            [
              "Along-track source pixel spacing (m)",
              parameters.along_track_pixel_spacing_m,
            ],
            [
              "Slant-range source pixel spacing (m)",
              parameters.slant_range_pixel_spacing_m,
            ],
            ["Pixel spacing source", parameters.pixel_spacing_source],
          ]}
        />
        <p className="body-note">
          Separate offset/quality rasters are not assumed publicly exported. The
          available processed map shows the backend's recorded output units, not
          horizontal glacier speed.
        </p>
      </>
    );
  return null;
}

function HDF5Inspector({
  inspection,
  scene,
}: {
  inspection: Inspection;
  scene?: Scene;
}) {
  const [groupChoice, setGroupChoice] = useState("");
  const [termChoice, setTermChoice] = useState("");
  const [channelChoice, setChannelChoice] = useState("");
  const [search, setSearch] = useState("");
  const groups = frequencyGroups(inspection);
  const group = groups.includes(groupChoice) ? groupChoice : (groups[0] ?? "");
  const terms = powerDatasets(inspection, group);
  const dataset =
    terms.find((item) => item.dataset_path === termChoice) ?? terms[0];
  const channels = scene?.polarizations ?? [];
  const channel = channels.includes(channelChoice)
    ? channelChoice
    : (channels[0] ?? "");
  const datasets = inspection.datasets.filter((item) =>
    item.dataset_path.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="lab-inspector">
      <div className="lab-result-selectors">
        <div>
          <label htmlFor="lab-frequency-group">Inspected frequency group</label>
          <select
            id="lab-frequency-group"
            value={group}
            disabled={!groups.length}
            onChange={(event) => {
              setGroupChoice(event.target.value);
              setTermChoice("");
            }}
          >
            {!groups.length && <option value="">Not reported</option>}
            {groups.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="lab-channel">Catalogue polarization channel</label>
          <select
            id="lab-channel"
            value={channel}
            disabled={!channels.length}
            onChange={(event) => setChannelChoice(event.target.value)}
          >
            {!channels.length && <option value="">Not reported</option>}
            {channels.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          {channel && <p>{polarizationDescription(channel)}</p>}
        </div>
        <div>
          <label htmlFor="lab-power-term">
            Available inspected GCOV power term
          </label>
          <select
            id="lab-power-term"
            value={dataset?.dataset_path ?? ""}
            disabled={!terms.length}
            onChange={(event) => setTermChoice(event.target.value)}
          >
            {!terms.length && (
              <option value="">No inspected GCOV power term</option>
            )}
            {terms.map((item) => (
              <option key={item.dataset_path} value={item.dataset_path}>
                {item.dataset_path.split("/").at(-1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {scene?.product_type === "GCOV" &&
        channel &&
        !terms.some((item) =>
          item.dataset_path.endsWith(`/${channel.repeat(2)}`),
        ) && (
          <p className="caution">
            Catalogue channel {channel} has no {channel.repeat(2)} power layer
            among the inspected datasets in frequency group{" "}
            {group || "not reported"}. No raster is inferred from the channel
            name.
          </p>
        )}
      {dataset ? (
        <div className="lab-dataset-selection">
          <p>
            <strong>{dataset.dataset_path.split("/").at(-1)}</strong> is a GCOV
            diagonal power term for channel{" "}
            {dataset.dataset_path.split("/").at(-1)?.slice(0, 2)}. Source units:{" "}
            {reported(dataset.attributes.units)}.
          </p>
          <code>{dataset.dataset_path}</code>
          <p>
            Inspection selection shows product structure only. It does not
            change or reprocess the selected result, whose processed
            polarization is reported above.
          </p>
        </div>
      ) : (
        <p className="caution">
          No GCOV power layer was inspected in this group. GUNW and GOFF use
          their own phase, coherence, offset and quality datasets below.
        </p>
      )}
      <p className="lab-science-note">
        HDF5 paths are internal product addresses, not image URLs or server
        filesystem paths. Catalogue channels do not guarantee that every term
        exists in an acquired subset.
      </p>
      <details>
        <summary>Product identification attributes</summary>
        <JsonView value={inspection.identification} />
      </details>
      <label htmlFor="lab-dataset-search">Filter HDF5 dataset paths</label>
      <input
        id="lab-dataset-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <p className="body-note">
        {datasets.length} of {inspection.datasets.length} inspected datasets.
        This browser reads up to 1,000 entries from the inspection endpoint.
      </p>
      <div className="lab-dataset-browser">
        {datasets.length ? (
          datasets.map((item) => (
            <details key={item.dataset_path}>
              <summary>
                <code>{item.dataset_path}</code>
                <span>
                  {item.dtype} ·{" "}
                  {item.shape?.length ? item.shape.join(" × ") : "scalar"}
                </span>
              </summary>
              <Fields
                rows={[
                  ["Shape", item.shape?.length ? item.shape : "Scalar"],
                  ["Data type", item.dtype],
                  ["Fill value", item.fill_value],
                ]}
              />
              <h4>Dataset attributes</h4>
              <JsonView value={item.attributes} />
            </details>
          ))
        ) : (
          <Empty title="No inspected datasets match this filter" />
        )}
      </div>
    </div>
  );
}

function ProductVisualization({
  result,
  location,
  scene,
  product,
}: {
  result: AnalysisResult;
  location: LocationRecord;
  scene?: Scene;
  product: string;
}) {
  const manifest = useManifest(result.id);
  const preview = useAsset(result.id, "preview");
  const geotiff = useAsset(result.id, "geotiff");
  const geojson = useAsset(result.id, "geojson");
  const summary = useAsset(result.id, "summary");
  const [view, setView] = useState<"preview" | MapLayer>("preview");
  const [imageFailed, setImageFailed] = useState(false);
  const layers = manifest.data?.enabled ? manifest.data.layers : undefined;
  const scale = measurementStyle(result, view === "change");
  const gcov = product === "GCOV";
  const options: {
    id: "preview" | MapLayer;
    label: string;
    available: boolean;
  }[] = [
    { id: "preview", label: "PNG preview", available: Boolean(preview.data) },
    {
      id: "result",
      label: "Processed map",
      available: Boolean(geotiff.data && scale && productGuides[product]),
    },
    ...(gcov
      ? [
          {
            id: "before" as const,
            label: "Before power",
            available: Boolean(layers?.before_power),
          },
          {
            id: "after" as const,
            label: "After power",
            available: Boolean(layers?.after_power),
          },
          {
            id: "change" as const,
            label: "Backscatter change",
            available: Boolean(
              layers?.change_geotiff && measurementStyle(result, true),
            ),
          },
        ]
      : []),
  ];
  const assets = [
    { label: "GeoTIFF", query: geotiff },
    { label: "GeoJSON", query: geojson },
    { label: "Summary JSON", query: summary },
  ];
  return (
    <section
      className="lab-product-visualization"
      aria-label="Actual result visualization"
    >
      <div className="lab-asset-toolbar">
        <div className="segmented wrap" aria-label="Result view">
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={view === item.id}
              disabled={!item.available && item.id !== "preview"}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {preview.data && (
          <a
            className="text-button"
            href={preview.data}
            target="_blank"
            rel="noreferrer"
          >
            Open actual preview <ExternalLink size={15} />
          </a>
        )}
      </div>
      <div className="lab-result-media">
        {view === "preview" ? (
          preview.isPending ? (
            <Loading label="Checking the actual result preview" />
          ) : !preview.data || imageFailed ? (
            <Empty title="Result preview unavailable">
              The backend has no readable PNG preview here. Metadata, statistics
              and available exports remain accessible.
            </Empty>
          ) : (
            <img
              src={preview.data}
              alt={`Actual processed ${resultLabel(result).toLowerCase()} preview for ${location.name}; ${result.validation_status.replaceAll("_", " ")}`}
              onError={() => setImageFailed(true)}
            />
          )
        ) : (
          <Suspense
            fallback={<Loading label="Opening the existing scientific map" />}
          >
            <MapCanvas
              location={location}
              result={result}
              manifest={gcov ? manifest.data : undefined}
              scenes={scene ? [scene] : []}
              labLayer={view}
            />
          </Suspense>
        )}
      </div>
      <div className="lab-result-caption">
        <span>
          {reported(result.metadata.processing_level)} · Processed polarization:{" "}
          {reported(result.metadata.polarization)}
        </span>
        <StatusBadge status={result.validation_status} />
      </div>
      {view === "before" || view === "after" ? (
        <div className="lab-inline-legend">
          <strong>
            Observed GCOV power · 10 log₁₀(linear gamma-zero power)
          </strong>
          <div className="color-scale power" />
          <span>Display range −30 to 0 dB · not a measured min/max</span>
          <p>
            {view === "before" ? "Before" : "After"} acquisition:{" "}
            {formatDate(
              result.metadata.acquisition_dates?.[view === "before" ? 0 : 1],
              true,
            )}
          </p>
        </div>
      ) : isCategorical(result) && view !== "change" ? (
        <div className="lab-inline-legend">
          <strong>Processed classification · not a radar photograph</strong>
          <ul>
            {Object.entries(result.metadata.class_legend ?? {}).map(
              ([key, value]) => (
                <li key={key}>
                  <code>{key}</code> {value.replaceAll("_", " ")}
                </li>
              ),
            )}
          </ul>
        </div>
      ) : scale && view !== "preview" ? (
        <div className="lab-inline-legend">
          <div className={`color-scale ${scale.palette}`} />
          <span>
            {formatNumber(scale.minimum, 3)} to {formatNumber(scale.maximum, 3)}{" "}
            {reported(
              view === "change"
                ? result.statistics.change_units
                : (result.statistics.units ?? result.metadata.units),
            )}
          </span>
        </div>
      ) : null}
      {manifest.isPending ? (
        <Loading label="Checking prepared COG layers" />
      ) : (
        (!manifest.data?.enabled ||
          manifest.error ||
          !Object.keys(layers ?? {}).length) && (
          <p className="caution">
            Prepared COG manifest unavailable.{" "}
            {manifest.data?.reason ??
              "The public processed export or PNG preview may still be available."}
          </p>
        )
      )}
      {gcov &&
        layers &&
        (!layers.before_power ||
          !layers.after_power ||
          !layers.change_geotiff) && (
          <p className="caution">
            Some prepared polarization or change layers are unavailable on this
            deployment. Only published layers are enabled.
          </p>
        )}
      <div className="download-row">
        {assets.map(({ label, query }) =>
          query.data ? (
            <a key={label} href={query.data}>
              <Download size={15} /> {label}
            </a>
          ) : (
            <span key={label}>
              {label}: {query.isPending ? "checking" : "unavailable"}
            </span>
          ),
        )}
      </div>
    </section>
  );
}

function MeasurementSummary({
  result,
  product,
}: {
  result: AnalysisResult;
  product: string;
}) {
  const summary = measuredSummary(product, result.statistics);
  return (
    <>
      <p className="body-note">
        Product: {product} · Source: result statistics API · Validation:{" "}
        {result.validation_status.replaceAll("_", " ")}
      </p>
      <p className="body-note">
        Acquisitions:{" "}
        {result.metadata.acquisition_dates
          ?.map((value) => formatDate(value, true))
          .join(" → ") || "Not reported"}
      </p>
      {summary ? (
        <>
          <h4>
            {summary.name} ({summary.units})
          </h4>
          <div
            className="lab-measurement-chart"
            role="img"
            aria-label={`${summary.name} in ${summary.units}; actual spatial statistics, not a time series`}
          >
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={summary.values} margin={{ left: 4, right: 18 }}>
                <CartesianGrid stroke="#ffffff0d" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#9aaac0", fontSize: 11 }}
                />
                <YAxis width={70} tick={{ fill: "#9aaac0", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "#101e2a",
                    border: "1px solid #314251",
                  }}
                  formatter={(value) => [value, summary.units]}
                />
                <Bar
                  dataKey="value"
                  fill="#20c8d2"
                  maxBarSize={38}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Fields
            rows={summary.values.map((value) => [
              value.name,
              `${value.value} ${summary.units}`,
            ])}
          />
          <p className="body-note">
            Spatial summary only, not an acquisition time series. No per-date
            measured series was supplied; no temporal curve is generated.
          </p>
        </>
      ) : (
        <Empty title="Measured chart unavailable">
          No supported numerical summary with reported units was supplied for
          this product. Raw reported statistics remain available.
        </Empty>
      )}
      <p className="lab-science-note">
        {productGuides[product]?.note ??
          "Unsupported measurement type. No interpretation is inferred."}
      </p>
    </>
  );
}

function ValidationPanel({ result }: { result: AnalysisResult }) {
  const notes = [
    ...new Set([
      ...result.uncertainty_notes,
      ...(result.metadata.uncertainty_notes ?? []),
    ]),
  ];
  return (
    <section
      className="lab-validation"
      aria-label="Scientific validation and uncertainty"
    >
      <div className="lab-evidence-title">
        <h3>Evidence, not certainty.</h3>
        <StatusBadge status={result.validation_status} />
      </div>
      {result.result_type === "potential_inundation" && (
        <p className="caution">
          Radar-derived candidate changes require independent validation before
          being interpreted as confirmed inundation.
        </p>
      )}
      <p>
        Processing completion is not scientific validation. Current backend
        state: <code>{result.validation_status}</code>.
      </p>
      {notes.length ? (
        <ul className="uncertainty-list">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <p>Uncertainty notes: Not reported.</p>
      )}
      <details>
        <summary>Validation sources and review history</summary>
        {result.metadata.validation_sources?.length ? (
          <JsonView value={result.metadata.validation_sources} />
        ) : (
          <p>No independent validation sources reported.</p>
        )}
        {result.metadata.validation_history?.length ? (
          <JsonView value={result.metadata.validation_history} />
        ) : (
          <p>No validation review history reported.</p>
        )}
      </details>
    </section>
  );
}

function ContextOnDemand({
  slug,
  resultId,
}: {
  slug: string;
  resultId: string;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <ContextStatus slug={slug} resultId={resultId} />
  ) : (
    <button className="text-button" onClick={() => setOpen(true)}>
      Check registered context <ArrowRight size={15} />
    </button>
  );
}

function ContextStatus({ slug, resultId }: { slug: string; resultId: string }) {
  const query = useExposure(slug, resultId);
  if (query.isPending)
    return <Loading label="Checking registered context availability" />;
  if (query.error)
    return (
      <>
        <ErrorState error={query.error} retry={() => query.refetch()} />
        <p>
          Missing context, including HTTP 424, means unavailable evidence, never
          zero population or exposure.
        </p>
      </>
    );
  return (
    <>
      {query.data?.estimates.map((item) => (
        <p key={item.context_layer_id}>
          {item.layer_type}: {item.source} · {item.version}
        </p>
      ))}
      {!!query.data?.unavailable_layer_types.length && (
        <p>
          Context unavailable: {query.data.unavailable_layer_types.join(", ")}.
          This does not mean zero population or exposure.
        </p>
      )}
      {query.data?.limitations.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </>
  );
}
