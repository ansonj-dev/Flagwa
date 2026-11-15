import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { hitGlyph, paintScore } from "./renderer";
import type { ScoreDataset, ScoreGlyph, ScoreStage } from "./model";
export function ScoreCanvas({
  dataset,
  stage,
  maximum,
  sector,
  selectedId,
  color,
  onSelect,
  onExportCanvas,
}: {
  dataset: ScoreDataset;
  stage: ScoreStage;
  maximum: number;
  sector: number | null;
  selectedId: string | null;
  color?: string;
  onSelect: (id: string) => void;
  onExportCanvas: (canvas: HTMLCanvasElement | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    glyphs = useRef<ScoreGlyph[]>([]),
    reduced = useReducedMotion();
  const [size, setSize] = useState({ width: 800, height: 620 }),
    [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    onExportCanvas(element);
    return () => {
      observer.disconnect();
      onExportCanvas(null);
    };
  }, [onExportCanvas]);
  useEffect(() => {
    const element = canvas.current!,
      ratio = Math.min(devicePixelRatio || 1, 2);
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    const context = element.getContext("2d")!;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    glyphs.current = paintScore(context, dataset, stage, {
      ...size,
      maximum,
      sector,
      selectedId: hover ?? selectedId,
      color,
    });
  }, [dataset, stage, maximum, sector, selectedId, size, hover, color]);
  useEffect(() => {
    if (reduced) return;
    const animation = canvas.current?.animate(
      [{ opacity: 0.2 }, { opacity: 1 }],
      { duration: 700, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [stage.id, reduced]);
  const find = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return hitGlyph(
      glyphs.current,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  };
  return (
    <div className="earthscore-art">
      <canvas
        ref={canvas}
        className="earthscore-canvas"
        role="img"
        aria-label={`Artistic encoding of ${dataset.samples.length} ${dataset.mode === "aggregate" ? "study aggregates" : "geographic COG overview samples"}; ${stage.label}. Equivalent values are available in the sample selector and scientific inspector.`}
        onPointerMove={(event) => setHover(find(event))}
        onPointerLeave={() => setHover(null)}
        onPointerDown={(event) => {
          const id = find(event);
          if (id) onSelect(id);
        }}
      />
      {hover && (
        <span className="earthscore-hover">
          {hover} ·{" "}
          {String(
            dataset.samples.find((sample) => sample.id === hover)?.values[
              stage.key!
            ] ?? "Missing",
          )}{" "}
          {
            dataset.variables.find((variable) => variable.key === stage.key)
              ?.units
          }
        </span>
      )}
    </div>
  );
}
