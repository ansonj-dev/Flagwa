import type { AnalysisResult } from "../../types/domain";
import {
  classCounts,
  formatNumber,
  isCategorical,
  numeric,
  overviewMetrics,
  resultLabel,
} from "../../utils/science";

export interface AcquisitionWindow {
  first: string;
  last: string;
  count: number;
  elapsedDays: number;
}

export interface GroundwireBrief {
  label: string;
  message: string;
  hypothesis: string;
  caveat: string;
  metrics: { label: string; value: number; units: string; digits: number }[];
  acquisition: AcquisitionWindow | null;
}

export type SignalProfile =
  | {
      kind: "classes";
      total: number;
      entries: { key: string; label: string; count: number; color: string }[];
    }
  | {
      kind: "range";
      minimum: number;
      mean: number;
      maximum: number;
      units: string;
    }
  | null;

const classColors = ["#53c7b4", "#dfb352", "#e27d61", "#86a9d4", "#a8c76a"];

export function acquisitionWindow(
  result: AnalysisResult,
): AcquisitionWindow | null {
  const dates = [
    ...new Set(
      (result.metadata.acquisition_dates ?? []).filter((date) =>
        Number.isFinite(Date.parse(date)),
      ),
    ),
  ].sort((first, second) => Date.parse(first) - Date.parse(second));
  if (!dates.length) return null;
  return {
    first: dates[0],
    last: dates.at(-1)!,
    count: dates.length,
    elapsedDays: Math.round(
      (Date.parse(dates.at(-1)!) - Date.parse(dates[0])) / 86400000,
    ),
  };
}

function hypothesisFor(result: AnalysisResult): string {
  if (result.result_type === "potential_inundation")
    return "Surface water, soil moisture, roughness, and viewing geometry can all alter radar return. Compare same-date rainfall and water levels before attributing the change to flooding.";
  if (result.result_type.includes("forest"))
    return "Canopy structure, seasonal moisture, and disturbance can shift radar return. Check independent forest-cover or optical records before calling this forest loss.";
  if (result.result_type.includes("fire"))
    return "Burn effects are one possible explanation for this radar/optical change. Compare a dated fire perimeter and independent post-fire observations.";
  if (result.result_type.includes("agricultur"))
    return "Crop stage, irrigation, and soil moisture may affect the response. Compare the acquisition dates with local crop calendars and rainfall records.";
  if (result.result_type.includes("glacier"))
    return "Seasonal ice flow and surface conditions may affect radar-coordinate offsets. Independent outlines and field or altimetry records are needed to assess retreat or mass loss.";
  if (result.result_type.includes("los"))
    return "Tectonics, groundwater change, or other deformation may contribute to relative line-of-sight motion. Compare with GNSS, leveling, and local geologic records.";
  return "Several surface processes can change a radar return. This result alone cannot isolate a driver; compare it with independently dated local records.";
}

function caveatFor(result: AnalysisResult): string {
  if (result.result_type === "potential_inundation")
    return "Potential inundation candidates only. Not confirmed flooding, water depth, or disaster severity.";
  if (result.result_type.includes("forest"))
    return "Radar-derived disturbance candidates are not confirmed deforestation.";
  if (result.result_type.includes("fire"))
    return "Fire-associated radar change is not a confirmed burn perimeter or damage assessment.";
  if (result.result_type.includes("glacier"))
    return "Radar-coordinate offset rate is not glacier retreat or ice-mass loss.";
  if (result.result_type.includes("los"))
    return "Relative line-of-sight displacement is not absolute vertical uplift or subsidence.";
  return "A reported measurement is not, by itself, a validated impact or causal explanation.";
}

export function makeGroundwireBrief(result: AnalysisResult): GroundwireBrief {
  const metrics = overviewMetrics(result).filter(
      (metric): metric is typeof metric & { value: number } =>
        metric.value !== null,
    ),
    acquisition = acquisitionWindow(result),
    metricSummary = metrics
      .slice(0, 2)
      .map(
        (metric) =>
          `${metric.label.toLowerCase()} ${formatNumber(metric.value, metric.digits)} ${metric.units}`,
      )
      .join(" · ");
  const acquisitionSummary = acquisition
    ? acquisition.count === 1
      ? `One acquisition is dated ${acquisition.first.slice(0, 10)}.`
      : `${acquisition.count} acquisitions span ${acquisition.first.slice(0, 10)} to ${acquisition.last.slice(0, 10)} (${acquisition.elapsedDays} days).`
    : "Acquisition dates are not reported.";
  return {
    label: resultLabel(result),
    message: `${acquisitionSummary} ${metricSummary ? `The reported summary is ${metricSummary}.` : "No numeric summary is available for this result."}`,
    hypothesis: hypothesisFor(result),
    caveat: caveatFor(result),
    metrics,
    acquisition,
  };
}

export function signalProfile(result: AnalysisResult): SignalProfile {
  if (isCategorical(result)) {
    const entries = Object.entries(classCounts(result))
      .filter(
        ([key, value]) =>
          key !== "invalid_observation" && numeric(value) !== null,
      )
      .map(([key, value], index) => ({
        key,
        label: result.metadata.class_legend?.[key] ?? key.replaceAll("_", " "),
        count: numeric(value)!,
        color: classColors[index % classColors.length],
      }))
      .filter((entry) => entry.count > 0);
    const total = entries.reduce((sum, entry) => sum + entry.count, 0);
    return total ? { kind: "classes", total, entries } : null;
  }

  const flood = result.result_type === "potential_inundation",
    minimum = numeric(
      flood ? result.statistics.min_change_db : result.statistics.minimum,
    ),
    mean = numeric(
      flood ? result.statistics.mean_change_db : result.statistics.mean,
    ),
    maximum = numeric(
      flood ? result.statistics.max_change_db : result.statistics.maximum,
    );
  if (minimum === null || mean === null || maximum === null) return null;
  return {
    kind: "range",
    minimum,
    mean,
    maximum,
    units: String(result.statistics.units ?? result.metadata.units ?? ""),
  };
}
