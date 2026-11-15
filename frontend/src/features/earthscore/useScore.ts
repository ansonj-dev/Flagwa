import { useQuery } from "@tanstack/react-query";
import SamplingWorker from "./sampling.worker?worker";
import { aggregateScore, finiteValue } from "./model";
import type { ScoreDataset, MeasurementKey } from "./model";
import type { AnalysisResult, LayerManifest } from "../../types/domain";
import { api } from "../../services/data";

export function useScore(
  result: AnalysisResult | undefined,
  manifest: LayerManifest | undefined,
  manifestSettled: boolean,
) {
  return useQuery({
    queryKey: ["earthscore", result?.id, manifest?.enabled],
    enabled: Boolean(result && manifestSettled),
    staleTime: Infinity,
    retry: false,
    queryFn: ({ signal }) =>
      new Promise<ScoreDataset>((resolve, reject) => {
        const sources: Partial<
          Record<MeasurementKey | "classification", string>
        > = {};
        if (manifest?.layers.before_power)
          sources.before = new URL(
            manifest.layers.before_power.href,
            location.origin,
          ).href;
        if (manifest?.layers.after_power)
          sources.after = new URL(
            manifest.layers.after_power.href,
            location.origin,
          ).href;
        if (manifest?.layers.change_geotiff)
          sources.change = new URL(
            manifest.layers.change_geotiff.href,
            location.origin,
          ).href;
        if (
          result!.result_type === "potential_inundation" ||
          result!.statistics.units === "class"
        )
          sources.classification = new URL(
            api.url(`/api/v1/exports/${result!.id}/geotiff`),
            location.origin,
          ).href;
        else if (
          finiteValue(result!.statistics.mean) !== null &&
          typeof result!.statistics.units === "string" &&
          result!.statistics.units !== "class"
        )
          sources.measurement = new URL(
            api.url(`/api/v1/exports/${result!.id}/geotiff`),
            location.origin,
          ).href;
        const worker = new SamplingWorker();
        const abort = () => {
          worker.terminate();
          reject(new DOMException("Sampling cancelled", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
        const finish = (data: ScoreDataset) => {
          signal.removeEventListener("abort", abort);
          worker.terminate();
          resolve(data);
        };
        worker.onmessage = (event) => {
          if (event.data.data) finish(event.data.data);
          else {
            const fallback = aggregateScore(result!);
            fallback.warnings.unshift(
              `Spatial sampling unavailable: ${event.data.error}`,
            );
            finish(fallback);
          }
        };
        worker.onerror = () => {
          const fallback = aggregateScore(result!);
          fallback.warnings.unshift(
            "The raster worker could not start. Only actual aggregate statistics are encoded.",
          );
          finish(fallback);
        };
        worker.postMessage({ result, sources });
      }),
  });
}
