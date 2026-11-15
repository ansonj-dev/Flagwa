import { expect, test } from "vitest";
import { audioEncoding } from "./audio";
import { scoreProvenance } from "./export";
import type { ScoreSample, ScoreStage, ScoreDataset } from "./model";
import type { AnalysisResult } from "../../types/domain";
const sample: ScoreSample = {
  id: "SYNTHETIC_SOFTWARE_ONLY",
  sector: 0,
  column: 0,
  latitude: 1,
  longitude: 2,
  geometry: null,
  values: { change: -4 },
  classCode: 4,
};
const stage: ScoreStage = {
  id: "derived",
  label: "CHANGE",
  kind: "derived",
  key: "change",
  date: "2020-01-01T00:00:00Z",
};
test("sonification has documented pitch bounds, actual stereo position, explicit uncertainty and silent missing samples", () => {
  expect(audioEncoding(sample, stage, 4, [2, 3])).toEqual({
    frequency: 880,
    pan: -1,
    uncertain: true,
  });
  expect(
    audioEncoding(
      { ...sample, values: { change: 0 }, longitude: 3 },
      stage,
      4,
      [2, 3],
    ).frequency,
  ).toBe(110);
  expect(
    audioEncoding({ ...sample, values: {} }, stage, 4, [2, 3]).frequency,
  ).toBeNull();
});
test("share provenance never drops exact values, dates, interpretation, validation or normalization", () => {
  const dataset = {
    samples: [sample],
    variables: [],
    sampling: "Synthetic software-only fixture",
    warnings: [],
  } as unknown as ScoreDataset;
  const result = {
    id: "SYNTHETIC_SOFTWARE_ONLY",
    result_type: "test",
    statistics: {},
    validation_status: "pending_validation",
    metadata: {
      synthetic: true,
      acquisition_dates: [stage.date],
      source_scenes: ["SYNTHETIC_SCENE"],
    },
  } as AnalysisResult;
  const exported = scoreProvenance({
    result,
    location: "Synthetic test",
    dataset,
    stage,
    maximum: 4,
    sector: 0,
    selectedId: sample.id,
  });
  expect(exported.artistic_encoding).toBe(true);
  expect(exported.samples[0].values.change).toBe(-4);
  expect(exported.acquisition_dates).toEqual([stage.date]);
  expect(exported.interpretation).toContain(
    "not a separate scientific observation",
  );
  expect(exported.normalization.magnitude_maximum).toBe(4);
});
