import type { AnalysisResult, JsonRecord } from "../types/domain";
export const candidateCaveat =
  "These are radar-derived potential inundation candidates. They have not been independently validated as confirmed flooding.";
export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function formatNumber(value: unknown, digits = 0) {
  const number = numeric(value);
  return number === null
    ? "—"
    : new Intl.NumberFormat("en", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(number);
}
export function formatDate(value?: string | null, time = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date not reported";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(time
      ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" as const }
      : {}),
    timeZone: "UTC",
  }).format(new Date(value));
}
export function classCounts(result: AnalysisResult) {
  return (result.statistics.class_pixel_counts ?? {}) as JsonRecord;
}
export function resultLocation(result: AnalysisResult) {
  return typeof result.metadata.location === "string"
    ? result.metadata.location
    : "";
}
export function valueAt(record: JsonRecord, key: string) {
  return typeof record[key] === "string"
    ? (record[key] as string)
    : "Not reported";
}
export function isCategorical(result: AnalysisResult) {
  return [
    "potential_inundation",
    "forest_disturbance_candidates",
    "fire_associated_radar_optical_candidates",
  ].includes(result.result_type);
}
export function resultLabel(result: AnalysisResult) {
  return (
    (
      {
        potential_inundation: "Potential inundation",
        forest_disturbance_candidates: "Forest disturbance candidates",
        fire_associated_radar_optical_candidates:
          "Fire-associated radar change",
        agricultural_temporal_surface_response: "Agricultural surface response",
        glacier_radar_coordinate_offset_rate: "Glacier radar-coordinate rate",
        apparent_relative_los_displacement:
          "Apparent relative LOS displacement",
      } as Record<string, string>
    )[result.result_type] ?? result.result_type.replaceAll("_", " ")
  );
}
export function measurementStyle(result: AnalysisResult, change = false) {
  if (!change && isCategorical(result))
    return { palette: "class", minimum: 0, maximum: 4 };
  const minimum = numeric(
    change || result.result_type === "potential_inundation"
      ? result.statistics.min_change_db
      : result.statistics.minimum,
  );
  const maximum = numeric(
    change || result.result_type === "potential_inundation"
      ? result.statistics.max_change_db
      : result.statistics.maximum,
  );
  if (minimum === null || maximum === null) return null;
  if (!change && result.result_type === "glacier_radar_coordinate_offset_rate")
    return { palette: "sequential", minimum, maximum };
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  return { palette: "diverging", minimum: -magnitude, maximum: magnitude };
}
export function overviewMetrics(result: AnalysisResult) {
  const stats = result.statistics,
    area = numeric(stats.candidate_area_m2),
    units = String(stats.units ?? result.metadata.units ?? "");
  if (result.result_type === "potential_inundation")
    return [
      {
        label: "Candidate area",
        value: area === null ? null : area / 1e6,
        units: "km²",
        digits: 2,
      },
      {
        label: "Mean backscatter change",
        value: numeric(stats.mean_change_db),
        units: "dB",
        digits: 2,
      },
    ];
  if (isCategorical(result))
    return [
      {
        label: "Candidate area",
        value: area === null ? null : area / 1e6,
        units: "km²",
        digits: 2,
      },
      {
        label: "Candidate pixels",
        value: numeric(stats.candidate_pixels),
        units: "pixels",
        digits: 0,
      },
    ];
  return [
    { label: "Mean measurement", value: numeric(stats.mean), units, digits: 4 },
    {
      label: "Valid measurements",
      value: numeric(stats.valid_pixels),
      units: "pixels",
      digits: 0,
    },
    { label: "Minimum", value: numeric(stats.minimum), units, digits: 4 },
    { label: "Maximum", value: numeric(stats.maximum), units, digits: 4 },
  ];
}
