import { expect, test } from "vitest";
import type { AnalysisResult } from "../../types/domain";
import { makeGroundwireBrief, signalProfile } from "./model";

const flood = {
  id: "result-1",
  analysis_job_id: "job-1",
  result_type: "potential_inundation",
  statistics: {
    candidate_area_m2: 3600000,
    mean_change_db: -2.34,
    min_change_db: -9.4,
    max_change_db: 3.2,
    class_pixel_counts: { potential_inundation: 120, unchanged: 880 },
  },
  validation_status: "pending_validation",
  uncertainty_notes: [],
  metadata: {
    location: "kuttanad",
    acquisition_dates: ["2026-09-13T00:00:00Z", "2026-09-25T00:00:00Z"],
    class_legend: {
      potential_inundation: "Potential inundation",
      unchanged: "Unchanged",
    },
  },
} as AnalysisResult;

test("Groundwire summarizes actual dates and statistics without upgrading candidates to confirmed events", () => {
  const brief = makeGroundwireBrief(flood),
    profile = signalProfile(flood);
  expect(brief.acquisition?.count).toBe(2);
  expect(brief.acquisition?.elapsedDays).toBe(12);
  expect(brief.message).toContain("candidate area 3.60 km²");
  expect(brief.message).toContain("mean backscatter change -2.34 dB");
  expect(brief.caveat).toContain("Not confirmed flooding");
  expect(profile?.kind).toBe("classes");
  expect(profile?.kind === "classes" && profile.total).toBe(1000);
});

test("Groundwire leaves unavailable dates and statistics explicit", () => {
  const result = {
    ...flood,
    statistics: {},
    metadata: { location: "kuttanad" },
  } as AnalysisResult;
  const brief = makeGroundwireBrief(result);
  expect(brief.acquisition).toBeNull();
  expect(brief.message).toContain("Acquisition dates are not reported");
  expect(brief.message).toContain("No numeric summary is available");
  expect(signalProfile(result)).toBeNull();
});
