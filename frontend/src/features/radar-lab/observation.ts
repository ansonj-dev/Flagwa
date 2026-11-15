import type {
  AnalysisResult,
  DatasetInfo,
  Inspection,
  JsonRecord,
  Scene,
} from "../../types/domain";
import { numeric } from "../../utils/science";

export const productGuides: Record<string, { title: string; note: string }> = {
  GCOV: {
    title: "GCOV · Backscatter",
    note: "Gamma-zero power and comparable backscatter changes describe scattering response, not confirmed impact. Linear power and dB are different representations; the processed classification is not a power image.",
  },
  GUNW: {
    title: "GUNW · Interferometry",
    note: "Phase differences require coherence, connected components, a stable reference and correction assessment. Referenced apparent line-of-sight displacement is not vertical subsidence or a deformation time series.",
  },
  GOFF: {
    title: "GOFF · Offset tracking",
    note: "Along-track and slant-range offsets require source units, quality filtering, pixel spacing and the actual acquisition interval. Radar-coordinate rates are not automatically horizontal or three-dimensional glacier velocity.",
  },
};

export function reported(value: unknown): string {
  if (value === null || value === undefined || value === "")
    return "Not reported";
  if (Array.isArray(value))
    return value.length ? value.map(reported).join(", ") : "Not reported";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function productOf(result: AnalysisResult, scene?: Scene) {
  return (
    scene?.product_type ?? result.metadata.processing_level ?? "Not reported"
  );
}

export function datasetGroup(path: string) {
  return /(?:^|\/)frequency([A-Za-z0-9]+)(?:\/|$)/.exec(path)?.[1];
}

export function frequencyGroups(inspection?: Inspection) {
  return [
    ...new Set(
      [
        ...(inspection?.frequency_groups ?? []).map(datasetGroup),
        ...(inspection?.datasets ?? []).map((item) =>
          datasetGroup(item.dataset_path),
        ),
      ].filter((value): value is string => Boolean(value)),
    ),
  ].sort();
}

export function powerDatasets(
  inspection?: Inspection,
  group?: string,
): DatasetInfo[] {
  return (inspection?.datasets ?? []).filter(
    (item) =>
      /\/(HHHH|HVHV|VHVH|VVVV)$/.test(item.dataset_path) &&
      (!group || datasetGroup(item.dataset_path) === group),
  );
}

export function polarizationDescription(channel: string) {
  if (!/^[HV]{2}$/.test(channel))
    return "Polarization convention not reported.";
  const orientation = (letter: string) =>
    letter === "H" ? "horizontal" : "vertical";
  return `${channel[0] === channel[1] ? "Co-polarization" : "Cross-polarization"}: transmit ${orientation(channel[0])}, receive ${orientation(channel[1])}.`;
}

export interface MeasuredSummary {
  name: string;
  units: string;
  values: { name: string; value: number }[];
}

export function measuredSummary(
  product: string,
  statistics: JsonRecord,
): MeasuredSummary | null {
  const keys =
    product === "GCOV"
      ? [
          ["Minimum", "min_change_db"],
          ["Mean", "mean_change_db"],
          ["Maximum", "max_change_db"],
        ]
      : [
          ["Minimum", "minimum"],
          ["Mean", "mean"],
          ["Maximum", "maximum"],
        ];
  const units = product === "GCOV" ? statistics.change_units : statistics.units;
  if (typeof units !== "string" || !units || !productGuides[product])
    return null;
  const values = keys.flatMap(([name, key]) => {
    const value = numeric(statistics[key]);
    return value === null ? [] : [{ name, value }];
  });
  return values.length
    ? {
        name:
          product === "GCOV"
            ? "Spatial backscatter-change summary"
            : product === "GUNW"
              ? "Spatial apparent LOS summary"
              : "Spatial radar-coordinate rate summary",
        units,
        values,
      }
    : null;
}
