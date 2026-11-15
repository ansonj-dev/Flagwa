import { expect, test } from "vitest";
import {
  frequencyGroups,
  measuredSummary,
  polarizationDescription,
  powerDatasets,
  reported,
} from "./observation";
import type { Inspection } from "../../types/domain";

const syntheticInspection: Inspection = {
  scene_id: "synthetic-software-fixture",
  identification: {},
  frequency_groups: [
    "/science/LSAR/GCOV/grids/frequencyA",
    "/science/LSAR/GCOV/grids/frequencyB",
  ],
  datasets: ["frequencyA/HHHH", "frequencyA/mask", "frequencyB/HVHV"].map(
    (name) => ({
      dataset_path: `/science/LSAR/GCOV/grids/${name}`,
      shape: [2, 2],
      dtype: "float32",
      fill_value: null,
      attributes: {},
    }),
  ),
};

test("only actual inspected power terms from the selected frequency group are offered", () => {
  expect(frequencyGroups(syntheticInspection)).toEqual(["A", "B"]);
  expect(
    powerDatasets(syntheticInspection, "A").map((item) =>
      item.dataset_path.split("/").at(-1),
    ),
  ).toEqual(["HHHH"]);
  expect(powerDatasets(undefined, "A")).toEqual([]);
  expect(powerDatasets(syntheticInspection, "C")).toEqual([]);
});

test("channels explain transmit and receive separately from GCOV power terms", () => {
  expect(polarizationDescription("HV")).toContain(
    "transmit horizontal, receive vertical",
  );
  expect(polarizationDescription("VV")).toContain("Co-polarization");
  expect(polarizationDescription("HHHH")).toContain("not reported");
});

test("charts require real finite statistics and reported units; zeros remain valid", () => {
  expect(measuredSummary("GCOV", {})).toBeNull();
  expect(measuredSummary("GCOV", { mean_change_db: 1 })).toBeNull();
  expect(
    measuredSummary("GCOV", {
      change_units: "dB",
      mean_change_db: 0,
      max_change_db: NaN,
    })?.values,
  ).toEqual([{ name: "Mean", value: 0 }]);
  expect(
    measuredSummary("GUNW", {
      units: "m",
      minimum: -0.2,
      mean: 0,
      maximum: 0.1,
    })?.name,
  ).toContain("LOS");
  expect(
    measuredSummary("GOFF", { units: "m/day", mean: 0.2 })?.name,
  ).toContain("radar-coordinate");
  expect(
    measuredSummary("GUNW", { change_units: "dB", mean_change_db: 5 }),
  ).toBeNull();
  expect(measuredSummary("UNKNOWN", { units: "m", mean: 2 })).toBeNull();
  expect(reported(null)).toBe("Not reported");
  expect(reported(0)).toBe("0");
});
