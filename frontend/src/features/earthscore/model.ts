import type { Polygon } from "geojson";
import type { AnalysisResult } from "../../types/domain";

export type MeasurementKey =
  "before" | "after" | "change" | "measurement" | "area";
export interface ScoreVariable {
  key: MeasurementKey;
  label: string;
  units: string;
  kind: "observed" | "derived";
  source: string;
}
export interface ScoreStage {
  id: string;
  label: string;
  date: string;
  kind: "observed" | "derived";
  key?: MeasurementKey;
}
export interface ScoreSample {
  id: string;
  sector: number;
  column: number;
  longitude: number | null;
  latitude: number | null;
  geometry: Polygon | null;
  values: Partial<Record<MeasurementKey, number | null>>;
  storedValues?: Partial<Record<MeasurementKey, number | null>>;
  classCode: number | null;
  pixel?: { column: number; row: number; overview: number };
}
export interface ScoreDataset {
  mode: "spatial" | "aggregate";
  samples: ScoreSample[];
  variables: ScoreVariable[];
  stages: ScoreStage[];
  sectors: { id: number; label: string; geometry: Polygon | null }[];
  sampling: string;
  warnings: string[];
  crs?: string;
  overview?: {
    width: number;
    height: number;
    baseWidth: number;
    baseHeight: number;
    index: number;
  };
}
export interface ScoreGlyph {
  id: string;
  anchorX: number;
  endX: number;
  y: number;
  bend: number;
  magnitude: number;
  value: number | null;
  quality: "missing" | "uncertain" | "unassessed";
  link?: {
    startX: number;
    endX: number;
    control1X: number;
    control2X: number;
    bend: number;
  };
}
export const integrityStatement =
  "Every visual movement represents a documented transformation of the underlying data. The composition is an artistic interpretation of scientific measurements, not a separate scientific observation.";
export const finiteValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export function candidateCellArea(
  classCode: number | null,
  legend: Record<string, string>,
  areaKm2: number,
): number | null {
  if (classCode === null || !Number.isFinite(areaKm2) || areaKm2 < 0)
    return null;
  const label = legend[String(classCode)]?.toLowerCase() ?? "";
  if (!label || /invalid|uncertain/.test(label)) return null;
  if (/no[_\s-]*candidate/.test(label)) return 0;
  return /candidate|inundation|disturbance|fire/.test(label) ? areaKm2 : 0;
}
export function makeStages(
  dates: string[],
  variables: ScoreVariable[],
): ScoreStage[] {
  const actual = [
    ...new Set(dates.filter((date) => Number.isFinite(Date.parse(date)))),
  ].sort((first, second) => Date.parse(first) - Date.parse(second));
  const has = (key: MeasurementKey) =>
    variables.some((variable) => variable.key === key);
  const stages: ScoreStage[] = actual.map((date, index) => ({
    id: `observed-${date}`,
    label: index === 0 ? "REFERENCE" : "OBSERVATION",
    date,
    kind: "observed",
    key:
      index === 0 && has("before")
        ? "before"
        : index === actual.length - 1 && has("after")
          ? "after"
          : undefined,
  }));
  const derived = variables.find((variable) => variable.kind === "derived");
  if (derived && actual.length)
    stages.push({
      id: "derived",
      label: "CHANGE",
      date: actual.at(-1)!,
      kind: "derived",
      key: derived.key,
    });
  return stages;
}
export function aggregateScore(result: AnalysisResult): ScoreDataset {
  const change = finiteValue(result.statistics.mean_change_db),
    mean = finiteValue(result.statistics.mean),
    area = finiteValue(result.statistics.candidate_area_m2);
  const variable: ScoreVariable | null =
    change !== null
      ? {
          key: "change",
          label: "Mean backscatter change",
          units: "dB",
          kind: "derived",
          source: "statistics.mean_change_db",
        }
      : mean !== null && typeof result.statistics.units === "string"
        ? {
            key: "measurement",
            label: "Mean measured value",
            units: result.statistics.units,
            kind: "derived",
            source: "statistics.mean",
          }
        : area !== null
          ? {
              key: "area",
              label: "Radar-derived candidate area",
              units: "km²",
              kind: "derived",
              source: "statistics.candidate_area_m2 / 1,000,000",
            }
          : null;
  const variables = variable ? [variable] : [];
  return {
    mode: "aggregate",
    samples: variable
      ? [
          {
            id: "study-aggregate",
            sector: 0,
            column: 0,
            longitude: null,
            latitude: null,
            geometry: null,
            values: {
              [variable.key]:
                variable.key === "change"
                  ? change
                  : variable.key === "measurement"
                    ? mean
                    : area === null
                      ? null
                      : area / 1e6,
            },
            classCode: null,
          },
        ]
      : [],
    variables,
    stages: makeStages(result.metadata.acquisition_dates ?? [], variables),
    sectors: [{ id: 0, label: "Whole-study aggregate", geometry: null }],
    sampling:
      "One reported study statistic. No pixel or subregional measurements are inferred.",
    warnings: [
      "Aggregate composition: spatial variation and per-acquisition values are unavailable. Missing stages are gaps, not unchanged Earth.",
    ],
  };
}
export function stageValue(
  sample: ScoreSample,
  stage: ScoreStage,
): number | null {
  return stage.key ? finiteValue(sample.values[stage.key]) : null;
}
export function qualityFor(
  sample: ScoreSample,
  stage: ScoreStage,
): ScoreGlyph["quality"] {
  if (stage.kind === "derived" && sample.classCode === 4) return "uncertain";
  if (stageValue(sample, stage) === null) return "missing";
  return "unassessed";
}
export function timeFraction(date: string, stages: ScoreStage[]): number {
  const values = stages
    .filter((stage) => stage.kind === "observed")
    .map((stage) => Date.parse(stage.date));
  const first = Math.min(...values),
    last = Math.max(...values);
  return last > first ? (Date.parse(date) - first) / (last - first) : 0.5;
}
export function defaultMaximum(
  dataset: ScoreDataset,
  stage: ScoreStage,
): number {
  return Math.max(
    ...dataset.samples.map((sample) =>
      Math.abs(stageValue(sample, stage) ?? 0),
    ),
    0.000001,
  );
}
export function layoutScore(
  dataset: ScoreDataset,
  stage: ScoreStage,
  maximum: number,
  width: number,
  height: number,
): ScoreGlyph[] {
  if (!Number.isFinite(maximum) || maximum <= 0)
    throw new Error("A positive, finite normalization maximum is required.");
  const columns = Math.max(
      1,
      ...dataset.samples.map((sample) => sample.column + 1),
    ),
    rows = Math.max(1, dataset.sectors.length);
  const trackHeight = Math.max(1, height - 128) / rows,
    anchorX = width * (0.22 + timeFraction(stage.date, dataset.stages) * 0.54);
  return dataset.samples.map((sample) => {
    const value = stageValue(sample, stage),
      magnitude = value === null ? 0 : Math.min(1, Math.abs(value) / maximum);
    return {
      id: sample.id,
      anchorX,
      endX: anchorX + Math.sign(value ?? 0) * magnitude * width * 0.19,
      y:
        68 +
        (sample.sector + 0.2 + ((sample.column + 0.5) / columns) * 0.6) *
          trackHeight,
      bend:
        (sample.column % 2 === 0 ? 1 : -1) *
        magnitude *
        Math.min(18, trackHeight * 0.2),
      magnitude,
      value,
      quality: qualityFor(sample, stage),
    };
  });
}
export function plainMeaning(result: AnalysisResult): string {
  if (result.result_type === "potential_inundation")
    return "Backscatter change is a radar signal difference, not confirmed flooding, water depth or disaster severity.";
  if (result.result_type.includes("los"))
    return "Source-convention apparent line-of-sight displacement; not absolute vertical uplift or subsidence.";
  if (result.result_type.includes("glacier"))
    return "Radar-coordinate offset rate; not glacier retreat, ice-mass loss or a complete ground-motion vector.";
  if (result.result_type.includes("forest"))
    return "Radar-derived disturbance candidates are not confirmed deforestation.";
  return "An artistic encoding of this product's reported measurement, not a new detection, prediction or validated severity scale.";
}
export function themeColor(result: AnalysisResult): string {
  if (result.result_type.includes("forest")) return "#718CFF";
  if (result.result_type.includes("fire")) return "#E9B653";
  if (result.result_type.includes("agricultur")) return "#A4CED0";
  if (result.result_type.includes("glacier")) return "#C3E6FF";
  if (result.result_type.includes("los")) return "#B58CFF";
  return "#20C8D2";
}

export interface SignalBeat {
  id: string;
  label: string;
  title: string;
  body: string;
  date?: string;
  value?: string;
}

function storyValue(value: number, units: string): string {
  return `${new Intl.NumberFormat("en", {
    maximumFractionDigits: 2,
    signDisplay: "always",
  }).format(value)} ${units}`;
}

export function buildSignalDispatch(
  result: AnalysisResult,
  dataset: ScoreDataset,
  selected: ScoreSample | undefined,
  regionSamples: ScoreSample[],
  placeName: string,
): SignalBeat[] {
  const observed = dataset.stages.filter((item) => item.kind === "observed"),
    reference = observed[0],
    comparison = observed.at(-1),
    derived = dataset.variables.find((item) => item.kind === "derived"),
    referenceUnits =
      dataset.variables.find((item) => item.key === "before")?.units ?? "units",
    comparisonUnits =
      dataset.variables.find((item) => item.key === "after")?.units ?? "units",
    referenceValue = finiteValue(selected?.values.before),
    comparisonValue = finiteValue(selected?.values.after),
    derivedValue = derived ? finiteValue(selected?.values[derived.key]) : null;
  const elapsedDays =
    reference && comparison
      ? Math.round(
          Math.abs(Date.parse(comparison.date) - Date.parse(reference.date)) /
            86400000,
        )
      : null;
  const beats: SignalBeat[] = [
    {
      id: "reference",
      label: "PASS 01 / REFERENCE",
      title: "A place enters the record",
      body: reference
        ? `${placeName}: the reference acquisition is dated ${reference.date.slice(0, 10)}. ${
            referenceValue === null
              ? "A value is not available for the selected sample at this pass."
              : `The selected sample stores ${storyValue(referenceValue, referenceUnits)} averaged power.`
          }`
        : `${placeName}: no dated reference acquisition is reported.`,
      date: reference?.date,
      value:
        referenceValue === null
          ? undefined
          : storyValue(referenceValue, referenceUnits),
    },
    {
      id: "comparison",
      label: "PASS 02 / COMPARISON",
      title: "Another pass returns to the same ground",
      body: comparison
        ? `The comparison acquisition is dated ${comparison.date.slice(0, 10)}${
            elapsedDays === null
              ? "."
              : elapsedDays === 0
                ? ", on the same day as the reference."
                : `, ${elapsedDays} days after the reference.`
          } ${
            comparisonValue === null
              ? "No averaged-power value is available for this sample at that date."
              : `The selected sample stores ${storyValue(comparisonValue, comparisonUnits)} averaged power.`
          }`
        : "No second dated acquisition is reported; a time interval cannot be described.",
      date: comparison?.date,
      value:
        comparisonValue === null
          ? undefined
          : storyValue(comparisonValue, comparisonUnits),
    },
    {
      id: "change",
      label: "DERIVED / NOT A NEW PASS",
      title: derived?.label ?? "No derived measurement",
      body:
        derivedValue === null || !derived
          ? "The selected sample has no stored derived value. Nothing has been interpolated or substituted."
          : `At the selected sample, the stored derived layer reports ${storyValue(derivedValue, derived.units)}. This is the product's reported measure, not a third acquisition.`,
      value:
        derivedValue === null || !derived
          ? undefined
          : storyValue(derivedValue, derived.units),
    },
  ];

  if (dataset.mode === "spatial") {
    const values = derived
      ? regionSamples
          .map((sample) => finiteValue(sample.values[derived.key]))
          .filter((value): value is number => value !== null)
      : [];
    beats.push({
      id: "footprint",
      label: "SAMPLED FOOTPRINT",
      title: "The region has a range, not one voice",
      body: values.length
        ? `${values.length} sampled cells in this selection span ${storyValue(Math.min(...values), derived!.units)} to ${storyValue(Math.max(...values), derived!.units)}. This is a sample range, not an area-weighted estimate or a mapped hazard boundary.`
        : "No derived values are available in the selected region. Empty samples remain gaps, not zero change.",
      value: values.length ? `${values.length} cells` : undefined,
    });
  } else {
    beats.push({
      id: "footprint",
      label: "SPATIAL DETAIL",
      title: "One study-wide statistic",
      body: "This result is an aggregate. It does not contain cell-level or subregional measurements, so no spatial pattern is inferred.",
    });
  }

  const displacement = result.result_type.includes("los"),
    glacier = result.result_type.includes("glacier");
  beats.push(
    {
      id: "hypothesis",
      label: "RESEARCH LEAD / HYPOTHESIS",
      title: "What could be driving the signal?",
      body: displacement
        ? "Relative radar line-of-sight motion can have tectonic, groundwater, or other causes. This result cannot separate them or establish vertical motion; compare with GNSS, leveling, and local geologic records."
        : glacier
          ? "Radar-coordinate offset can reflect ice flow and seasonal dynamics, but it does not establish retreat or ice-mass loss. Compare with independent ice outlines and field or altimetry observations."
          : "A backscatter shift can be consistent with changes in surface water, soil moisture, roughness, or vegetation structure. This measurement cannot distinguish among them; compare acquisition-date rainfall, water levels, and land-cover records before attributing a cause.",
    },
    {
      id: "limit",
      label: "READ BEFORE SHARING",
      title: "What this radar result cannot say",
      body: plainMeaning(result),
    },
  );
  return beats;
}
