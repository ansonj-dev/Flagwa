import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Download,
  ExternalLink,
  FileJson,
  Info,
  MapPin,
  Maximize2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { SiteHeader } from "../components/SiteHeader";
import {
  Empty,
  ErrorState,
  IconButton,
  JsonView,
  Loading,
  StatusBadge,
} from "../components/ui";
import {
  api,
  useLocations,
  useManifest,
  useResult,
  useResults,
} from "../services/data";
import { useExplorer } from "../store/explorer";
import { formatDate, resultLabel, resultLocation } from "../utils/science";
import {
  defaultMaximum,
  integrityStatement,
  plainMeaning,
  qualityFor,
  stageValue,
  themeColor,
} from "../features/earthscore/model";
import type { ScoreDataset, ScoreStage } from "../features/earthscore/model";
import { useScore } from "../features/earthscore/useScore";
import { ScoreCanvas } from "../features/earthscore/ScoreCanvas";
import { SignalDispatch } from "../features/earthscore/SignalDispatch";
import { LocatorMap } from "../features/earthscore/LocatorMap";
import { EarthscoreAudio } from "../features/earthscore/audio";
import { exportProvenance, exportScore } from "../features/earthscore/export";
import "../features/earthscore/earthscore.css";

const exact = (value: number | null | undefined) =>
  value === null || value === undefined ? "Missing" : String(value);
function Interpretation({
  dataset,
  stage,
}: {
  dataset: ScoreDataset;
  stage: ScoreStage;
}) {
  const valid = dataset.samples.filter(
    (sample) => stageValue(sample, stage) !== null,
  ).length;
  return (
    <div className="earthscore-caption">
      <span className="earthscore-signal" />
      <span>
        {dataset.mode === "spatial"
          ? `${valid} / ${dataset.samples.length} sampled cells`
          : "Whole-study aggregate"}{" "}
        ·{" "}
        {stage.kind === "derived"
          ? "derived interval, not another acquisition"
          : "actual acquisition"}
      </span>
      <span className="earthscore-caption-end">ARTISTIC ENCODING</span>
    </div>
  );
}
export function Earthscore() {
  const params = useParams(),
    navigate = useNavigate(),
    reduced = useReducedMotion();
  const slug = params.locationSlug ?? useExplorer.getState().selectedLocation;
  const locations = useLocations(),
    results = useResults(),
    direct = useResult(params.resultId);
  const place = locations.data?.find((location) => location.slug === slug),
    candidates =
      results.data?.filter((result) => resultLocation(result) === slug) ?? [];
  const result = params.resultId
    ? direct.data?.metadata.location === slug
      ? direct.data
      : undefined
    : candidates[0];
  const manifest = useManifest(result?.id),
    score = useScore(result, manifest.data, manifest.isFetched);
  const dataset = score.data;
  const [stageIndex, setStageIndex] = useState(0),
    [sector, setSector] = useState<number | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [maximum, setMaximum] = useState(1);
  const [visualPlaying, setVisualPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [audioState, setAudioState] = useState<"stopped" | "playing" | "paused">(
      "stopped",
    ),
    [volume, setVolume] = useState(0.25),
    [muted, setMuted] = useState(false),
    [selectedOnly, setSelectedOnly] = useState(false);
  const [error, setError] = useState<unknown>(),
    [exporting, setExporting] = useState(false),
    [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const audio = useRef<EarthscoreAudio | null>(null);
  const stage =
    dataset?.stages[Math.min(stageIndex, dataset.stages.length - 1)];
  const selected = dataset?.samples.find((sample) => sample.id === selectedId),
    variable = dataset?.variables.find(
      (variable) => variable.key === stage?.key,
    );
  const inRegion =
    dataset?.samples.filter(
      (sample) => sector === null || sample.sector === sector,
    ) ?? [];
  useEffect(() => {
    useExplorer.getState().selectLocation(slug);
  }, [slug]);
  useEffect(() => {
    if (!dataset?.stages.length) return;
    const index = Math.max(0, dataset.stages.length - 1);
    setStageIndex(index);
    setSector(null);
    setSelectedId(
      dataset.samples.find(
        (sample) => stageValue(sample, dataset.stages[index]) !== null,
      )?.id ??
        dataset.samples[0]?.id ??
        null,
    );
    setVisualPlaying(false);
  }, [dataset]);
  useEffect(() => {
    if (dataset && stage) setMaximum(defaultMaximum(dataset, stage));
  }, [dataset, stage]);
  useEffect(() => {
    audio.current?.stop();
    setAudioState("stopped");
  }, [result?.id, stage?.id, sector, maximum, speed, selectedOnly]);
  useEffect(() => () => audio.current?.dispose(), []);
  useEffect(() => {
    if (!visualPlaying || !dataset) return;
    const timer = setTimeout(() => {
      if (stageIndex >= dataset.stages.length - 1) setVisualPlaying(false);
      else setStageIndex(stageIndex + 1);
    }, 2200 / speed);
    return () => clearTimeout(timer);
  }, [visualPlaying, stageIndex, dataset, speed]);
  const selectSample = (id: string) => {
    const sample = dataset?.samples.find((sample) => sample.id === id);
    if (!sample) return;
    audio.current?.stop();
    setAudioState("stopped");
    setSelectedId(id);
    setSector(sample.sector);
  };
  const selectStage = (index: number) => {
    setStageIndex(index);
    setVisualPlaying(false);
  };
  const selectRegion = (next: number | null) => {
    setSector(next);
    const sample =
      dataset?.samples.find(
        (sample) =>
          (next === null || sample.sector === next) &&
          stage &&
          stageValue(sample, stage) !== null,
      ) ??
      dataset?.samples.find(
        (sample) => next === null || sample.sector === next,
      );
    if (sample) setSelectedId(sample.id);
  };
  async function listen() {
    setError(undefined);
    try {
      if (audioState === "playing") {
        await audio.current?.pause();
        setAudioState("paused");
        return;
      }
      if (audioState === "paused") {
        await audio.current?.resume();
        setAudioState("playing");
        return;
      }
      if (!stage || !dataset) return;
      const samples = selectedOnly && selected ? [selected] : inRegion;
      if (!samples.some((sample) => stageValue(sample, stage) !== null))
        throw new Error(
          "This selection has no available measurements. Missing observations are silent.",
        );
      audio.current ??= new EarthscoreAudio();
      audio.current.setVolume(volume, muted);
      await audio.current.play(
        samples,
        stage,
        maximum,
        speed,
        (id) => setSelectedId(id),
        () => setAudioState("stopped"),
      );
      setAudioState("playing");
    } catch (failure) {
      setError(failure);
      setAudioState("stopped");
    }
  }
  const stopAudio = () => {
    audio.current?.stop();
    setAudioState("stopped");
  };
  async function saveArtwork() {
    if (!result || !dataset || !stage) return;
    setError(undefined);
    setExporting(true);
    try {
      await exportScore({
        result,
        dataset,
        stage,
        maximum,
        sector,
        selectedId,
        location: place?.name ?? slug,
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setExporting(false);
    }
  }
  const stateError =
    locations.error ?? results.error ?? direct.error ?? score.error;
  return (
    <main className="earthscore-page">
      <a className="skip-link" href="#earthscore-inspector">
        Skip artwork to scientific values
      </a>
      <SiteHeader />
      <div className="earthscore-shell">
        <header className="earthscore-title">
          <div>
            <span className="eyebrow">
              <Radio size={13} /> FLAGWA / SIGNATURE EXPERIENCE
            </span>
            <h1>
              THE EARTHSCORE<span aria-hidden="true">.</span>
            </h1>
            <p>Experience the rhythms of a changing Earth.</p>
          </div>
          <Link
            className="earthscore-return"
            to={
              result
                ? `/explore/${slug}/results/${result.id}`
                : `/explore/${slug}`
            }
          >
            <Maximize2 size={16} /> Scientific raster view{" "}
            <ExternalLink size={13} />
          </Link>
        </header>
        <div className="earthscore-sourcebar">
          <div>
            <MapPin size={15} />
            <label className="sr-only" htmlFor="earthscore-place">
              Earthscore location
            </label>
            <select
              id="earthscore-place"
              value={slug}
              onChange={(event) =>
                navigate(`/earthscore/${event.target.value}`)
              }
            >
              {locations.data?.map((location) => (
                <option key={location.id} value={location.slug}>
                  {location.name}, {location.country}
                </option>
              ))}
            </select>
          </div>
          <div className="earthscore-result-picker">
            <label className="sr-only" htmlFor="earthscore-result">
              Earthscore processed result
            </label>
            <select
              id="earthscore-result"
              value={result?.id ?? ""}
              disabled={!candidates.length}
              onChange={(event) =>
                navigate(`/earthscore/${slug}/results/${event.target.value}`)
              }
            >
              {candidates.length ? (
                candidates.map((result) => (
                  <option key={result.id} value={result.id}>
                    {resultLabel(result)} · {result.id.slice(0, 8)}
                  </option>
                ))
              ) : (
                <option value="">No completed result</option>
              )}
            </select>
          </div>
          {result && (
            <StatusBadge
              status={result.validation_status}
              experimental={result.result_type !== "potential_inundation"}
            />
          )}
        </div>
        {stateError ? (
          <ErrorState
            error={stateError}
            retry={() => {
              void results.refetch();
              void score.refetch();
            }}
          />
        ) : locations.isPending ||
          results.isPending ||
          (result && (score.isPending || manifest.isPending)) ? (
          <div className="earthscore-loading">
            <Loading label="Reading real observations and bounded COG samples" />
            <p>
              No artwork is generated until documented measurements are
              available.
            </p>
          </div>
        ) : !result ? (
          <Empty title="No completed scientific result for this location">
            No illustrative or synthetic measurements are substituted.{" "}
            <Link className="text-button" to={`/explore/${slug}`}>
              Return to the study map <ArrowRight size={14} />
            </Link>
          </Empty>
        ) : !dataset?.samples.length || !stage ? (
          <Empty title="No supported numeric measurement is available">
            Review the original result's metadata and raster exports. This
            product is not reinterpreted as an unrelated measurement.
          </Empty>
        ) : (
          <>
            {result.metadata.synthetic && (
              <p className="caution">
                Synthetic software fixture. This is not scientific observation
                or live environmental evidence.
              </p>
            )}
            <div className="earthscore-workspace">
              <aside
                className="earthscore-geography"
                aria-label="Earthscore geography"
              >
                <div className="earthscore-panel-label">
                  <span>01 / LOCATE</span>
                  <MapPin size={14} />
                </div>
                <LocatorMap
                  dataset={dataset}
                  study={result.metadata.study_aoi ?? place?.geometry}
                  selectedId={selectedId}
                  sector={sector}
                  stage={stage}
                  onSelect={selectSample}
                />
                <p className="earthscore-map-note">
                  {dataset.mode === "spatial"
                    ? "Real sampled COG cell footprints · WGS84"
                    : "Study area only · no subregional data"}
                </p>
                <label htmlFor="earthscore-sector">Geographic region</label>
                <select
                  id="earthscore-sector"
                  value={sector ?? "all"}
                  onChange={(event) =>
                    selectRegion(
                      event.target.value === "all"
                        ? null
                        : Number(event.target.value),
                    )
                  }
                >
                  <option value="all">
                    All{" "}
                    {dataset.mode === "spatial"
                      ? "geographic bands"
                      : "study data"}
                  </option>
                  {dataset.sectors.map((band) => (
                    <option key={band.id} value={band.id}>
                      {band.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="earthscore-variable">
                  Available measurement
                </label>
                <select
                  id="earthscore-variable"
                  value={stage.key ?? ""}
                  onChange={(event) => {
                    const index = dataset.stages.findIndex(
                      (item) => item.key === event.target.value,
                    );
                    if (index >= 0) selectStage(index);
                  }}
                >
                  {!stage.key && (
                    <option value="">Unavailable at this acquisition</option>
                  )}
                  {dataset.variables.map((variable) => (
                    <option key={variable.key} value={variable.key}>
                      {variable.label} · {variable.units}
                    </option>
                  ))}
                </select>
                <label htmlFor="earthscore-sample">
                  Sample / exact source value
                </label>
                <select
                  id="earthscore-sample"
                  value={selectedId ?? ""}
                  onChange={(event) => selectSample(event.target.value)}
                >
                  {inRegion.map((sample) => (
                    <option key={sample.id} value={sample.id}>
                      {dataset.mode === "aggregate"
                        ? "Study aggregate"
                        : `B${sample.sector + 1} / ${String(sample.column + 1).padStart(2, "0")}`}{" "}
                      · {exact(stageValue(sample, stage))} {variable?.units}
                    </option>
                  ))}
                </select>
                <div className="earthscore-normalization">
                  <label htmlFor="earthscore-maximum">
                    Magnitude display range{" "}
                    {variable?.units && `(${variable.units})`}
                  </label>
                  <div>
                    <span className="mono">0 →</span>
                    <input
                      id="earthscore-maximum"
                      aria-label="Normalization maximum"
                      type="number"
                      min="0.000001"
                      step="any"
                      disabled={!variable}
                      value={maximum}
                      onChange={(event) => {
                        const value = event.target.valueAsNumber;
                        if (Number.isFinite(value) && value > 0)
                          setMaximum(value);
                      }}
                    />
                    <IconButton
                      label="Reset normalization to sampled maximum"
                      onClick={() => setMaximum(defaultMaximum(dataset, stage))}
                    >
                      <RotateCcw size={15} />
                    </IconButton>
                  </div>
                  <small>Display clipping never changes stored values.</small>
                </div>
                <details>
                  <summary>Sampling & source resolution</summary>
                  <p>{dataset.sampling}</p>
                  {dataset.overview && <JsonView value={dataset.overview} />}
                  <p>CRS: {dataset.crs ?? "Study aggregate"}</p>
                </details>
              </aside>
              <section
                className="earthscore-composition"
                aria-label="Artistic Earthscore"
              >
                <Interpretation dataset={dataset} stage={stage} />
                <ScoreCanvas
                  dataset={dataset}
                  stage={stage}
                  maximum={maximum}
                  sector={sector}
                  selectedId={selectedId}
                  color={themeColor(result)}
                  onSelect={selectSample}
                  onExportCanvas={setCanvas}
                />
                <div className="earthscore-timeline">
                  <div className="earthscore-transport">
                    <IconButton
                      label={
                        visualPlaying
                          ? "Pause stage playback"
                          : "Play observation stages"
                      }
                      aria-pressed={visualPlaying}
                      onClick={() => {
                        if (
                          !visualPlaying &&
                          stageIndex === dataset.stages.length - 1
                        )
                          setStageIndex(0);
                        setVisualPlaying(!visualPlaying);
                      }}
                    >
                      {visualPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </IconButton>
                    <IconButton
                      label="Previous documented stage"
                      disabled={stageIndex <= 0}
                      onClick={() => selectStage(stageIndex - 1)}
                    >
                      <ArrowLeft size={15} />
                    </IconButton>
                    <input
                      aria-label="Documented observation stage"
                      type="range"
                      min="0"
                      max={dataset.stages.length - 1}
                      step="1"
                      value={stageIndex}
                      onChange={(event) =>
                        selectStage(Number(event.target.value))
                      }
                    />
                    <IconButton
                      label="Next documented stage"
                      disabled={stageIndex >= dataset.stages.length - 1}
                      onClick={() => selectStage(stageIndex + 1)}
                    >
                      <ArrowRight size={15} />
                    </IconButton>
                    <label className="sr-only" htmlFor="earthscore-speed">
                      Playback speed
                    </label>
                    <select
                      id="earthscore-speed"
                      value={speed}
                      onChange={(event) => setSpeed(Number(event.target.value))}
                    >
                      <option value="0.5">0.5×</option>
                      <option value="1">1×</option>
                      <option value="2">2×</option>
                    </select>
                  </div>
                  <div className="earthscore-stage-buttons">
                    {dataset.stages.map((step, index) => (
                      <button
                        key={step.id}
                        aria-pressed={stageIndex === index}
                        onClick={() => selectStage(index)}
                      >
                        <span>
                          {String(index + 1).padStart(2, "0")} / {step.label}
                        </span>
                        <time dateTime={step.date}>
                          {formatDate(step.date)}
                        </time>
                        <small>
                          {step.kind === "derived"
                            ? "Derived interval · not a third acquisition"
                            : step.key
                              ? "Actual source acquisition"
                              : "Acquisition known · value unavailable"}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <motion.aside
                id="earthscore-inspector"
                className="earthscore-science"
                aria-label="Scientific measurement inspector"
                initial={{ opacity: reduced ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: reduced ? 0 : 0.25 }}
              >
                <div className="earthscore-panel-label">
                  <span>03 / UNDERSTAND</span>
                  <Info size={14} />
                </div>
                <span className="eyebrow">
                  {stage.label} / {variable?.kind ?? "MISSING"}
                </span>
                <h2>{variable?.label ?? "No measurement at this stage"}</h2>
                <div className="earthscore-exact-value">
                  <strong data-testid="earthscore-exact-value">
                    {selected
                      ? exact(stageValue(selected, stage))
                      : "No sample selected"}
                  </strong>
                  <span>{variable?.units ?? "No value available"}</span>
                </div>
                <p className="earthscore-meaning">{plainMeaning(result)}</p>
                {selected && (
                  <>
                    <dl className="data-list">
                      <div>
                        <dt>Reference power</dt>
                        <dd>
                          {exact(selected.values.before)}
                          {selected.values.before != null ? " dB" : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Observation power</dt>
                        <dd>
                          {exact(selected.values.after)}
                          {selected.values.after != null ? " dB" : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Stored derived change</dt>
                        <dd>
                          {exact(
                            selected.values.change ??
                              selected.values.measurement ??
                              selected.values.area,
                          )}{" "}
                          {
                            dataset.variables.find(
                              (item) => item.kind === "derived",
                            )?.units
                          }
                        </dd>
                      </div>
                      <div>
                        <dt>Sample</dt>
                        <dd
                          className="mono"
                          data-testid="earthscore-selected-id"
                        >
                          {selected.id}
                        </dd>
                      </div>
                      <div>
                        <dt>Quality</dt>
                        <dd>
                          {qualityFor(selected, stage) === "uncertain"
                            ? "Explicit class 4 · uncertain interpretation"
                            : qualityFor(selected, stage) === "missing"
                              ? "Missing / masked"
                              : "No confidence value reported"}
                        </dd>
                      </div>
                      {selected.longitude !== null && (
                        <div>
                          <dt>Cell centre</dt>
                          <dd className="mono">
                            {selected.latitude?.toFixed(6)},{" "}
                            {selected.longitude.toFixed(6)}
                          </dd>
                        </div>
                      )}
                    </dl>
                    <details>
                      <summary>Exact cell & stored values</summary>
                      <p>
                        storedValues retains the exact native COG cell values.
                        values contains the documented display conversion, such
                        as 10 log₁₀(averaged power). No full-resolution pixel
                        value is inferred from an overview.
                      </p>
                      <JsonView value={selected} />
                    </details>
                  </>
                )}
                <dl className="data-list">
                  <div>
                    <dt>Acquisition UTC</dt>
                    <dd>{stage.date}</dd>
                  </div>
                  <div>
                    <dt>Algorithm</dt>
                    <dd>
                      {result.metadata.algorithm_version ?? "Not reported"}
                    </dd>
                  </div>
                  <div>
                    <dt>Polarization</dt>
                    <dd>{result.metadata.polarization ?? "Not reported"}</dd>
                  </div>
                  <div>
                    <dt>Frequency / group</dt>
                    <dd>
                      {result.metadata.frequency ?? "Not reported"} /{" "}
                      {result.metadata.frequency_group ?? "Not reported"}
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary>Source scenes & processing</summary>
                  {(result.metadata.source_scenes ?? []).map((id) => (
                    <code className="earthscore-scene-id" key={id}>
                      {id}
                    </code>
                  ))}
                  <p>Result: {result.id}</p>
                  <JsonView
                    value={{
                      processing_parameters: result.metadata.parameters,
                      geometry_semantics: result.metadata.geometry_semantics,
                    }}
                  />
                  <p>{variable?.source}</p>
                  {result.uncertainty_notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </details>
                <a
                  className="text-button"
                  href={api.url(`/api/v1/exports/${result.id}/summary`)}
                >
                  <ExternalLink size={14} /> Original scientific summary
                </a>
              </motion.aside>
            </div>
            <SignalDispatch
              result={result}
              dataset={dataset}
              selected={selected}
              regionSamples={inRegion}
              placeName={place?.name ?? slug}
            />
            <section
              className="earthscore-audio"
              aria-labelledby="earthscore-audio-title"
            >
              <div>
                <span className="eyebrow">OPTIONAL / DATA SONIFICATION</span>
                <h2 id="earthscore-audio-title">
                  <AudioLines size={20} /> LISTEN TO THE CHANGE
                </h2>
                <p>Not audio recorded by the satellite.</p>
              </div>
              <div className="earthscore-audio-controls">
                <button
                  className="secondary-button"
                  aria-label={
                    audioState === "playing"
                      ? "Pause sonification"
                      : audioState === "paused"
                        ? "Resume sonification"
                        : "Play sonification"
                  }
                  onClick={listen}
                >
                  {audioState === "playing" ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}{" "}
                  {audioState === "playing"
                    ? "Pause"
                    : audioState === "paused"
                      ? "Resume"
                      : "Play"}
                </button>
                <IconButton label="Stop sonification" onClick={stopAudio}>
                  <Square size={16} />
                </IconButton>
                <IconButton
                  label={muted ? "Unmute sonification" : "Mute sonification"}
                  aria-pressed={muted}
                  onClick={() => {
                    setMuted(!muted);
                    audio.current?.setVolume(volume, !muted);
                  }}
                >
                  {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </IconButton>
                <label className="sr-only" htmlFor="earthscore-volume">
                  Sonification volume
                </label>
                <input
                  id="earthscore-volume"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={volume}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setVolume(value);
                    audio.current?.setVolume(value, muted);
                  }}
                />
                <label className="earthscore-audio-selection">
                  <input
                    type="checkbox"
                    checked={selectedOnly}
                    onChange={(event) => setSelectedOnly(event.target.checked)}
                  />
                  Selected cell only
                </label>
                <span className="earthscore-audio-status" role="status">
                  {audioState === "playing"
                    ? "Playing documented values"
                    : audioState === "paused"
                      ? "Paused"
                      : "Audio off"}
                </span>
              </div>
            </section>
            <section
              className="earthscore-legend"
              aria-label="Visual and audio mapping"
            >
              <div>
                <span className="eyebrow">HOW TO READ THE SCORE</span>
                <p>
                  <b>Time</b> · actual dated anchors. <b>Tracks</b> · geographic
                  northing bands. <b>Length</b> · absolute value / selected
                  maximum. <b>Direction</b> · negative left, positive right;
                  zero is a point. <b>Density</b> · available sampled cells, not
                  hazard extent.
                </p>
                <p>
                  <span className="earthscore-legend-stroke" /> Theme-colored
                  strokes: available measurement.{" "}
                  <span className="earthscore-legend-fragment" /> Amber
                  fragments: explicitly uncertain interpretation. Empty gaps:
                  unavailable values, never zero change.
                </p>
              </div>
              <div>
                <span className="eyebrow">HOW TO LISTEN</span>
                <p>
                  Magnitude maps logarithmically from 110–880 Hz (A2–A5).
                  West–east position controls stereo. Samples play
                  north-to-south, then west-to-east within the chosen region.
                  Missing cells are silent rests; explicit class-4 uncertainty
                  is a pair of short notes. Loudness is not severity.
                </p>
                <p>
                  Reference/observation power uses 10 log₁₀(stored averaged
                  power). The derived stage uses the stored average change, not
                  a subtraction of those two displayed values.
                </p>
              </div>
            </section>
            <details className="earthscore-method">
              <summary>Scientific limits, sampling and normalization</summary>
              {dataset.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
              <p>
                Source overview data and the deterministic 24-column × 8-band
                lattice fix every footprint and value. Crossfades animate the
                artistic encoding only. Missing acquisitions and unavailable
                per-date products are never interpolated. Denser or additional
                dated scores require genuinely compatible, processed source
                measurements.
              </p>
              <p>
                Audio uses the same clamped magnitude as stroke length:
                frequency = 110 × 2^(3 × normalized magnitude). Stereo is the
                selected cell's actual longitude scaled across the playback
                selection; aggregate statistics play centrally. The visual
                timeline never starts audio.
              </p>
              <p>
                For LOS products the source sign convention is retained. Glacier
                offset rate is not a retreat vector. Forest change is not
                confirmed deforestation. Unvalidated art is not a detection or
                prediction.
              </p>
            </details>
            <footer className="earthscore-footer">
              <p>{integrityStatement}</p>
              <div>
                <button
                  className="secondary-button"
                  disabled={exporting || !canvas}
                  onClick={saveArtwork}
                >
                  <Download size={16} />
                  {exporting
                    ? "Preparing source-labelled artwork…"
                    : "Export artistic score"}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    exportProvenance({
                      result,
                      dataset,
                      stage,
                      maximum,
                      sector,
                      selectedId,
                      location: place?.name ?? slug,
                    })
                  }
                >
                  <FileJson size={16} /> Values & provenance
                </button>
              </div>
            </footer>
            {Boolean(error) && <ErrorState error={error} />}
          </>
        )}
      </div>
    </main>
  );
}
