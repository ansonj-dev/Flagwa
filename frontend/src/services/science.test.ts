import { expect, test } from "vitest";
import {
  numeric,
  formatNumber,
  measurementStyle,
  overviewMetrics,
} from "../utils/science";
import { shouldPollJob } from "./data";
import type { AnalysisResult, Job } from "../types/domain";
test("missing measurements are never fabricated zero values", () => {
  expect(numeric(null)).toBeNull();
  expect(formatNumber(undefined)).toBe("—");
  expect(formatNumber(0)).toBe("0");
});
test("job polling stops in every terminal state", () => {
  for (const status of ["COMPLETED", "FAILED", "CANCELLED"])
    expect(shouldPollJob({ status } as Job)).toBe(false);
  expect(shouldPollJob({ status: "RUNNING" } as Job)).toBe(2500);
});
test("synthetic software-only continuous fixtures use actual units and zero-centered scales, never flood metrics", () => {
  const fixture = {
    result_type: "apparent_relative_los_displacement",
    metadata: { synthetic: true, units: "m" },
    statistics: {
      mean: 0.02,
      minimum: -0.03,
      maximum: 0.08,
      units: "m",
      valid_pixels: 50,
    },
  } as AnalysisResult;
  expect(measurementStyle(fixture)).toEqual({
    palette: "diverging",
    minimum: -0.08,
    maximum: 0.08,
  });
  expect(overviewMetrics(fixture).map((metric) => metric.label)).not.toContain(
    "Candidate area",
  );
  expect(overviewMetrics(fixture)[0].units).toBe("m");
  expect(measurementStyle({ ...fixture, statistics: {} })).toBeNull();
});
