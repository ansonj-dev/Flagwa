import type { AnalysisResult } from "../../types/domain";
import type { ScoreDataset, ScoreStage } from "./model";
import { integrityStatement, themeColor } from "./model";
import { paintScore } from "./renderer";
export interface ExportScoreOptions {
  result: AnalysisResult;
  location: string;
  dataset: ScoreDataset;
  stage: ScoreStage;
  maximum: number;
  sector: number | null;
  selectedId: string | null;
}
export function scoreProvenance(options: ExportScoreOptions) {
  return {
    brand: "FLAGWA · THE EARTHSCORE",
    artistic_encoding: true,
    location: options.location,
    analysis_id: options.result.id,
    result_type: options.result.result_type,
    validation_status: options.result.validation_status,
    statistics: options.result.statistics,
    processing_parameters: options.result.metadata.parameters,
    source_scenes: options.result.metadata.source_scenes ?? [],
    acquisition_dates: options.result.metadata.acquisition_dates ?? [],
    algorithm_version: options.result.metadata.algorithm_version,
    stage: options.stage,
    variables: options.dataset.variables,
    normalization: {
      magnitude_minimum: 0,
      magnitude_maximum: options.maximum,
      clipping: "Display and pitch saturate; original values are unchanged.",
    },
    sampling: options.dataset.sampling,
    overview: options.dataset.overview,
    warnings: options.dataset.warnings,
    selected_sector: options.sector,
    selected_sample: options.selectedId,
    samples: options.dataset.samples,
    interpretation: integrityStatement,
  };
}
function download(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
export function exportProvenance(options: ExportScoreOptions) {
  download(
    new Blob([JSON.stringify(scoreProvenance(options), null, 2)], {
      type: "application/json",
    }),
    `flagwa-earthscore-${options.result.id}.json`,
  );
}
export async function exportScore(options: ExportScoreOptions) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1800;
  const lines: { text: string; color: string; size: number }[] = [];
  const measuring = canvas.getContext("2d")!;
  function wrap(text: string, size = 22, color = "#9aaac0") {
    measuring.font = `${size}px Inter, sans-serif`;
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (measuring.measureText(next).width > 1650) {
        lines.push({ text: line, color, size });
        line = word;
      } else line = next;
    }
    if (line) lines.push({ text: line, color, size });
  }
  const variable = options.dataset.variables.find(
    (item) => item.key === options.stage.key,
  );
  wrap(
    `${options.location} · ${variable?.label ?? "Missing stage"} · ${variable?.units ?? "No value"}`,
    30,
    "#d9e2ed",
  );
  wrap(
    `Acquisitions (UTC): ${(options.result.metadata.acquisition_dates ?? []).join(" / ")}`,
  );
  wrap(
    `Result ${options.result.id} · ${options.result.validation_status} · ${options.result.metadata.algorithm_version ?? "Algorithm not reported"}`,
  );
  const selected = options.dataset.samples.find(
    (sample) => sample.id === options.selectedId,
  );
  if (selected)
    wrap(
      `Selected sample ${selected.id}: ${options.stage.key ? (selected.values[options.stage.key] ?? "Missing") : "Missing"} ${variable?.units ?? ""}. ${selected.longitude === null ? "Whole-study aggregate" : `Cell centre ${selected.latitude}, ${selected.longitude} (WGS84)`}.`,
    );
  wrap(
    `Legend: horizontal anchor = actual acquisition time; rows = geographic bands; length = |value| / ${options.maximum} ${variable?.units ?? ""}, clipped to 1; left/right = negative/positive; amber fragments = explicit uncertain classification; gaps = missing values.`,
  );
  wrap(options.dataset.sampling);
  wrap(
    "Data source: NASA–ISRO NISAR via the existing FLAGWA processed-result API. Source scenes:",
  );
  for (const source of options.result.metadata.source_scenes ?? [])
    wrap(source, 19);
  for (const warning of options.dataset.warnings) wrap(warning, 20);
  wrap(integrityStatement, 22, "#e9b653");
  canvas.height =
    1060 + lines.reduce((height, line) => height + line.size * 1.6, 0);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#050811";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#20c8d2";
  context.font = "600 24px Inter, sans-serif";
  context.fillText("FLAGWA / ARTISTIC ENCODING", 70, 65);
  context.fillStyle = "#d9e2ed";
  context.font = "500 64px Inter, sans-serif";
  context.fillText("THE EARTHSCORE", 70, 145);
  context.save();
  context.translate(60, 180);
  paintScore(context, options.dataset, options.stage, {
    width: 1680,
    height: 780,
    maximum: options.maximum,
    sector: options.sector,
    selectedId: options.selectedId,
    color: themeColor(options.result),
  });
  context.restore();
  let top = 1010;
  for (const line of lines) {
    context.fillStyle = line.color;
    context.font = `${line.size}px Inter, sans-serif`;
    context.fillText(line.text, 70, top);
    top += line.size * 1.6;
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The artwork could not be exported.")),
      "image/png",
    ),
  );
  download(blob, `flagwa-earthscore-${options.result.id}.png`);
}
