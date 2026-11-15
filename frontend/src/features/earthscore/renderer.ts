import { layoutScore, stageValue } from "./model";
import type { ScoreDataset, ScoreGlyph, ScoreStage } from "./model";
export interface ScorePaintOptions {
  width: number;
  height: number;
  maximum: number;
  sector: number | null;
  selectedId: string | null;
  color?: string;
  reveal?: number;
}
export function paintScore(
  context: CanvasRenderingContext2D,
  dataset: ScoreDataset,
  stage: ScoreStage,
  options: ScorePaintOptions,
): ScoreGlyph[] {
  const { width, height, maximum, selectedId, sector } = options,
    color = options.color ?? "#20c8d2";
  const glyphs = layoutScore(dataset, stage, maximum, width, height);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#050811";
  context.fillRect(0, 0, width, height);
  const trackHeight = (height - 128) / Math.max(1, dataset.sectors.length);
  context.font = "9px 'JetBrains Mono', monospace";
  for (const band of dataset.sectors) {
    const top = 68 + band.id * trackHeight;
    context.strokeStyle = band.id === sector ? "#20c8d244" : "#8292a81a";
    context.lineWidth = 1;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(15, top + trackHeight);
    context.lineTo(width - 15, top + trackHeight);
    context.stroke();
    context.fillStyle = band.id === sector ? color : "#8da4b7";
    context.fillText(
      dataset.mode === "aggregate"
        ? "STUDY AGGREGATE"
        : `B${String(band.id + 1).padStart(2, "0")}`,
      12,
      top + 12,
    );
    const count = glyphs.filter(
      (glyph, index) =>
        dataset.samples[index].sector === band.id && glyph.value !== null,
    ).length;
    context.fillStyle = "#708496";
    context.fillText(
      `${count} / ${dataset.samples.filter((sample) => sample.sector === band.id).length}`,
      width - 60,
      top + 12,
    );
  }
  const dates = dataset.stages.filter((item) => item.kind === "observed");
  for (const date of dates) {
    const dateGlyph = layoutScore(
      { ...dataset, samples: dataset.samples.slice(0, 1) },
      date,
      maximum,
      width,
      height,
    )[0];
    if (!dateGlyph) continue;
    context.strokeStyle = "#8292a825";
    context.setLineDash([2, 7]);
    context.beginPath();
    context.moveTo(dateGlyph.anchorX, 40);
    context.lineTo(dateGlyph.anchorX, height - 45);
    context.stroke();
    context.fillStyle = "#9aaac0";
    context.textAlign = "center";
    context.fillText(
      new Date(date.date).toISOString().slice(0, 10),
      dateGlyph.anchorX,
      25,
    );
  }
  context.textAlign = "left";
  const referenceStage = dataset.stages.find((item) => item.key === "before"),
    observationStage = dataset.stages.find((item) => item.key === "after");
  if (referenceStage && observationStage) {
    const before = layoutScore(dataset, referenceStage, maximum, width, height),
      after = layoutScore(dataset, observationStage, maximum, width, height);
    const changeMaximum = Math.max(
      0.000001,
      ...dataset.samples.map((sample) => Math.abs(sample.values.change ?? 0)),
    );
    for (const [index, sample] of dataset.samples.entries()) {
      if (before[index].value === null || after[index].value === null) continue;
      const active = sample.id === selectedId,
        dimmed = sector !== null && sample.sector !== sector;
      if (stageValue(sample, stage) === null) continue;
      const bend =
        ((sample.values.change ?? 0) / changeMaximum) * trackHeight * 0.34;
      glyphs[index].link = {
        startX: before[index].anchorX,
        endX: after[index].anchorX,
        control1X: width * 0.38,
        control2X: width * 0.6,
        bend,
      };
      context.globalAlpha = dimmed ? 0.025 : active ? 0.8 : 0.18;
      context.strokeStyle = sample.classCode === 4 ? "#e9b653" : color;
      context.lineWidth = active ? 2 : 0.8;
      context.setLineDash(sample.classCode === 4 ? [2, 5] : []);
      context.beginPath();
      context.moveTo(before[index].anchorX, before[index].y);
      context.bezierCurveTo(
        width * 0.38,
        before[index].y - bend,
        width * 0.6,
        after[index].y + bend,
        after[index].anchorX,
        after[index].y,
      );
      context.stroke();
    }
  }
  for (const [index, glyph] of glyphs.entries()) {
    const sample = dataset.samples[index],
      active = selectedId === glyph.id,
      dimmed = sector !== null && sample.sector !== sector;
    context.globalAlpha = dimmed
      ? 0.09
      : (options.reveal ?? 1) * (active ? 1 : 0.72);
    if (glyph.quality === "missing") {
      context.setLineDash([]);
      context.strokeStyle = "#60718266";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(glyph.anchorX, glyph.y, 2, 0, Math.PI * 2);
      context.stroke();
      continue;
    }
    const stroke = glyph.quality === "uncertain" ? "#e9b653" : color;
    context.strokeStyle = active ? "#e8f5fc" : stroke;
    context.setLineDash(glyph.quality === "uncertain" ? [2, 5] : []);
    context.lineCap = "round";
    context.lineWidth = active ? 3.5 : 1.4 + glyph.magnitude * 1.7;
    context.shadowColor = stroke;
    context.shadowBlur = active ? 20 : 6;
    context.beginPath();
    context.moveTo(glyph.anchorX, glyph.y);
    context.bezierCurveTo(
      glyph.anchorX + (glyph.endX - glyph.anchorX) * 0.3,
      glyph.y - glyph.bend,
      glyph.anchorX + (glyph.endX - glyph.anchorX) * 0.7,
      glyph.y + glyph.bend,
      glyph.endX,
      glyph.y,
    );
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = stroke;
    context.beginPath();
    context.arc(glyph.anchorX, glyph.y, active ? 4 : 1.7, 0, Math.PI * 2);
    context.fill();
    if (active) {
      context.setLineDash([]);
      context.strokeStyle = "#d9e2ed";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(glyph.endX, glyph.y, 5, 0, Math.PI * 2);
      context.stroke();
    }
  }
  context.globalAlpha = 1;
  context.setLineDash([]);
  context.shadowBlur = 0;
  context.fillStyle = "#9aaac0";
  context.font = "9px 'JetBrains Mono', monospace";
  context.fillText(
    `${stage.kind === "derived" ? "DERIVED INTERVAL · ANCHORED TO FINAL ACQUISITION" : "ACTUAL ACQUISITION"} · ${stage.label}`,
    15,
    height - 18,
  );
  return glyphs;
}
export function hitGlyph(
  glyphs: ScoreGlyph[],
  x: number,
  y: number,
): string | null {
  let closest: string | null = null,
    distance = 12;
  for (const glyph of glyphs) {
    const left = Math.min(glyph.anchorX, glyph.endX) - 6,
      right = Math.max(glyph.anchorX, glyph.endX) + 6;
    const separation = Math.abs(glyph.y - y);
    if (x >= left && x <= right && separation < distance) {
      closest = glyph.id;
      distance = separation;
    }
    if (glyph.link && x >= glyph.link.startX && x <= glyph.link.endX) {
      const link = glyph.link;
      const cubic = (
        fraction: number,
        start: number,
        first: number,
        second: number,
        end: number,
      ) =>
        (1 - fraction) ** 3 * start +
        3 * (1 - fraction) ** 2 * fraction * first +
        3 * (1 - fraction) * fraction ** 2 * second +
        fraction ** 3 * end;
      let lower = 0,
        upper = 1;
      for (let iteration = 0; iteration < 14; iteration++) {
        const middle = (lower + upper) / 2;
        if (
          cubic(
            middle,
            link.startX,
            link.control1X,
            link.control2X,
            link.endX,
          ) < x
        )
          lower = middle;
        else upper = middle;
      }
      const curveY = cubic(
        (lower + upper) / 2,
        glyph.y,
        glyph.y - link.bend,
        glyph.y + link.bend,
        glyph.y,
      );
      const curveDistance = Math.abs(y - curveY);
      if (curveDistance < distance) {
        closest = glyph.id;
        distance = curveDistance;
      }
    }
  }
  return closest;
}
