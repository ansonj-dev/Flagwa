import { expect, test } from "vitest";
import {
  aggregateScore,
  buildSignalDispatch,
  candidateCellArea,
  layoutScore,
  makeStages,
  qualityFor,
  timeFraction,
} from "./model";
import type { ScoreDataset } from "./model";
import type { AnalysisResult } from "../../types/domain";
import { hitGlyph } from "./renderer";
const variables = [
  {
    key: "before" as const,
    label: "Reference",
    units: "dB",
    kind: "observed" as const,
    source: "SYNTHETIC_SOFTWARE_ONLY",
  },
  {
    key: "after" as const,
    label: "Observation",
    units: "dB",
    kind: "observed" as const,
    source: "SYNTHETIC_SOFTWARE_ONLY",
  },
  {
    key: "change" as const,
    label: "Change",
    units: "dB",
    kind: "derived" as const,
    source: "SYNTHETIC_SOFTWARE_ONLY",
  },
];
const stages = makeStages(
  ["2020-01-01T00:00:00Z", "2020-01-13T00:00:00Z"],
  variables,
);
const fixture: ScoreDataset = {
  mode: "spatial",
  samples: [
    {
      id: "SYNTHETIC_SOFTWARE_ONLY",
      sector: 0,
      column: 0,
      longitude: 0,
      latitude: 0,
      geometry: null,
      values: { before: -10, after: -12, change: -2 },
      classCode: 4,
    },
  ],
  variables,
  stages,
  sectors: [{ id: 0, label: "Synthetic software test", geometry: null }],
  sampling: "Software-only fixture",
  warnings: [],
};
test("two acquisitions produce two dated observations and one derived stage, not a third acquisition", () => {
  expect(stages.map((stage) => stage.label)).toEqual([
    "REFERENCE",
    "OBSERVATION",
    "CHANGE",
  ]);
  expect(stages[2].date).toBe(stages[1].date);
  expect(stages[2].kind).toBe("derived");
});
test("render geometry is deterministic, signed and normalization does not alter measurements", () => {
  const first = layoutScore(fixture, stages[2], 1, 1000, 600);
  expect(first).toEqual(layoutScore(fixture, stages[2], 1, 1000, 600));
  expect(first[0].endX).toBeLessThan(first[0].anchorX);
  expect(first[0].magnitude).toBe(1);
  expect(first[0].value).toBe(-2);
  expect(() => layoutScore(fixture, stages[2], 0, 1000, 600)).toThrow();
});
test("missing data and explicit interpretation uncertainty are separate", () => {
  expect(qualityFor(fixture.samples[0], stages[2])).toBe("uncertain");
  expect(
    qualityFor(
      { ...fixture.samples[0], values: { change: null }, classCode: 0 },
      stages[2],
    ),
  ).toBe("missing");
  expect(
    qualityFor(
      { ...fixture.samples[0], values: { change: null } },
      stages[2],
    ),
  ).toBe("uncertain");
  expect(qualityFor(fixture.samples[0], stages[0])).toBe("unassessed");
});
test("categorical class labels become per-cell area without treating class codes as measurements", () => {
  const legend = {
    "0": "invalid",
    "1": "no_candidate",
    "3": "forest_disturbance_candidates",
    "4": "uncertain",
  };
  expect(candidateCellArea(3, legend, 0.04)).toBe(0.04);
  expect(candidateCellArea(1, legend, 0.04)).toBe(0);
  expect(candidateCellArea(0, legend, 0.04)).toBeNull();
  expect(candidateCellArea(4, legend, 0.04)).toBeNull();
});
test("multi-date spacing uses actual timestamps and unsupported stages remain empty", () => {
  const timeline = makeStages(
    ["2020-01-01Z", "2020-01-04Z", "2020-01-13Z"],
    variables,
  );
  expect(timeFraction(timeline[1].date, timeline)).toBe(0.25);
  expect(timeline[1].key).toBeUndefined();
});
test("aggregate fallback retains only actual reported statistics, never fabricated per-date values", () => {
  const result = {
    statistics: { mean_change_db: 1.23 },
    metadata: {
      acquisition_dates: stages.slice(0, 2).map((stage) => stage.date),
      synthetic: true,
    },
  } as AnalysisResult;
  const score = aggregateScore(result);
  expect(score.mode).toBe("aggregate");
  expect(score.samples[0].values).toEqual({ change: 1.23 });
  expect(score.samples[0].geometry).toBeNull();
  expect(score.stages[0].key).toBeUndefined();
});
test("unavailable units never cause an unrelated mean to be presented as candidate area", () => {
  const score = aggregateScore({
    statistics: { mean: 999, candidate_area_m2: 2000000 },
    metadata: { synthetic: true, acquisition_dates: [] },
  } as unknown as AnalysisResult);
  expect(score.samples[0].values).toEqual({ area: 2 });
  expect(score.stages).toEqual([]);
});
test("a connecting ribbon is selectable without inventing a trajectory measurement", () => {
  expect(
    hitGlyph(
      [
        {
          id: "SYNTHETIC_SOFTWARE_ONLY",
          anchorX: 760,
          endX: 800,
          y: 100,
          bend: 0,
          magnitude: 0.5,
          value: 1,
          quality: "unassessed",
          link: {
            startX: 220,
            endX: 760,
            control1X: 380,
            control2X: 600,
            bend: 12,
          },
        },
      ],
      490,
      100,
    ),
  ).toBe("SYNTHETIC_SOFTWARE_ONLY");
});

test("signal dispatch stays tied to dated passes, stored samples, and explicit limits", () => {
  const result = {
    result_type: "potential_inundation",
    statistics: {},
    metadata: { location: "kuttanad" },
    uncertainty_notes: [],
  } as unknown as AnalysisResult;
  const beats = buildSignalDispatch(
    result,
    fixture,
    fixture.samples[0],
    fixture.samples,
    "Kuttanad",
  );
  expect(beats[0].date).toBe("2020-01-01T00:00:00Z");
  expect(beats[0].value).toBe("-10 dB");
  expect(beats[1].body).toContain("12 days after the reference");
  expect(beats[2].value).toBe("-2 dB");
  expect(beats[3].body).toContain("1 sampled cells");
  expect(beats[4].label).toContain("HYPOTHESIS");
  expect(beats[5].body).toContain("not confirmed flooding");
});

test("signal dispatch reports missing sample values and aggregate limits without filling gaps", () => {
  const result = {
    result_type: "potential_inundation",
    statistics: {},
    metadata: { location: "kuttanad" },
    uncertainty_notes: [],
  } as unknown as AnalysisResult;
  const aggregate = aggregateScore(result),
    beats = buildSignalDispatch(
      result,
      aggregate,
      undefined,
      aggregate.samples,
      "Kuttanad",
    );
  expect(beats[0].body).toContain("no dated reference acquisition");
  expect(beats[2].body).toContain("Nothing has been interpolated");
  expect(beats[3].body).toContain("does not contain cell-level");
});
