// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ObservationLab } from "./ObservationLab";
import { api } from "../../services/data";
import { ApiError } from "../../services/api-client";
import type {
  AnalysisResult,
  Inspection,
  LocationRecord,
  Scene,
} from "../../types/domain";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  BarChart: () => <div>Synthetic software-test chart boundary</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));
vi.mock("../../components/map/MapCanvas", () => ({
  MapCanvas: () => <div>Existing map renderer test boundary</div>,
}));

const syntheticLocations: LocationRecord[] = [
  "synthetic-water",
  "synthetic-empty",
].map((slug) => ({
  id: slug,
  name: slug,
  slug,
  country: "Software test only",
  continent: "Software test only",
  hazard_type: "flood",
  geometry: null,
  description: "Synthetic software fixture",
  is_active: true,
}));
const syntheticResult: AnalysisResult = {
  id: "synthetic-result-one",
  analysis_job_id: "synthetic-job-one",
  result_type: "potential_inundation",
  validation_status: "pending_validation",
  uncertainty_notes: ["Synthetic test fixture; not observational evidence."],
  statistics: {
    change_units: "dB",
    min_change_db: -2,
    mean_change_db: 0,
    max_change_db: 3,
  },
  metadata: {
    synthetic: true,
    location: "synthetic-water",
    processing_level: "GCOV",
    frequency: "L",
    frequency_group: "A",
    polarization: "HHHH",
    algorithm_version: "synthetic-test-v1",
    source_scenes: ["synthetic-scene-one", "synthetic-scene-two"],
    acquisition_dates: ["2026-01-01T00:00:00Z", "2026-01-13T00:00:00Z"],
    class_legend: { "3": "potential_new_inundation" },
  },
};
const syntheticScene: Scene = {
  scene_id: "synthetic-scene-one",
  dataset: "NISAR synthetic software fixture",
  product_type: "GCOV",
  data_maturity: "SYNTHETIC_TEST_ONLY",
  acquisition_datetime: "2026-01-01T00:00:00Z",
  flight_direction: "DESCENDING",
  geometry: null,
  polarizations: ["HH", "HV"],
  frequency: "L",
  source: "SYNTHETIC_PROVIDER",
  orbit_information: {},
  download_available: false,
  download_status: "COMPLETED",
  metadata: {},
};
const syntheticInspection: Inspection = {
  scene_id: syntheticScene.scene_id,
  identification: { missionId: "SYNTHETIC_TEST_NISAR" },
  frequency_groups: ["/science/LSAR/GCOV/grids/frequencyA"],
  datasets: [
    {
      dataset_path: "/science/LSAR/GCOV/grids/frequencyA/HHHH",
      shape: [2, 2],
      dtype: "float32",
      fill_value: -9999,
      attributes: { units: "1", test_only: true },
    },
  ],
};
let results: AnalysisResult[];
let scene: Scene;
let inspectionError: ApiError | undefined;
let backendError = false;
let assetsAvailable = true;
let exposureError = false;

beforeEach(() => {
  results = [structuredClone(syntheticResult)];
  scene = structuredClone(syntheticScene);
  inspectionError = undefined;
  backendError = false;
  assetsAvailable = true;
  exposureError = false;
  vi.spyOn(api, "get").mockImplementation(async (path: string) => {
    if (backendError) throw new ApiError("Backend unavailable", 503);
    if (path.startsWith("/api/v1/locations")) return syntheticLocations;
    if (path.startsWith("/api/v1/case-studies")) return [];
    if (path.startsWith("/api/v1/results?")) return results;
    if (path.includes("/inspection")) {
      if (inspectionError) throw inspectionError;
      return syntheticInspection;
    }
    if (path.startsWith("/api/v1/scenes/"))
      return { ...scene, scene_id: path.split("/").at(-1) };
    if (path.startsWith("/api/v1/jobs"))
      return [
        {
          id: "synthetic-failed-job",
          location_id: "synthetic-empty",
          status: "FAILED",
        },
      ];
    if (path.includes("/exposure")) {
      if (exposureError)
        throw new ApiError("Context unavailable", 424, "CONTEXT_NOT_AVAILABLE");
      return {
        estimates: [],
        unavailable_layer_types: ["population"],
        limitations: [],
      };
    }
    const record = results.find((item) => path.includes(item.id));
    if (path.endsWith("/metadata")) return record?.metadata;
    if (path.endsWith("/statistics")) return record?.statistics;
    if (record) return record;
    throw new Error(`Unexpected synthetic test route: ${path}`);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/gateway/"))
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              enabled: false,
              layers: {},
              reason: "Synthetic test deployment has no prepared layers",
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      return new Response(new Uint8Array([0]), {
        status: assetsAvailable ? 206 : 404,
        headers: {
          "content-type": url.endsWith("preview")
            ? "image/png"
            : url.endsWith("geotiff")
              ? "image/tiff"
              : "application/json",
        },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ObservationLab initialSlug="synthetic-water" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("actual API-shaped result, metadata, preview, inspection, dynamic terms, validation and navigation are connected", async () => {
  setup();
  expect(
    await screen.findByRole("heading", { name: "Potential inundation" }),
  ).toBeTruthy();
  expect(await screen.findByText("SYNTHETIC_PROVIDER")).toBeTruthy();
  expect(screen.getByText("DESCENDING")).toBeTruthy();
  expect(screen.getByText("SYNTHETIC_TEST_NISAR")).toBeTruthy();
  expect(screen.getAllByText("pending validation").length).toBeGreaterThan(0);
  expect(
    screen.getByText(/independent validation before being interpreted/),
  ).toBeTruthy();
  const image = await screen.findByRole("img", {
    name: /Actual processed potential inundation preview/,
  });
  expect(image.getAttribute("src")).toBe(
    "/backend/api/v1/results/synthetic-result-one/preview",
  );
  const terms = screen.getByLabelText("Available inspected GCOV power term");
  expect(
    within(terms)
      .getAllByRole("option")
      .map((item) => item.textContent),
  ).toEqual(["HHHH"]);
  expect(
    within(screen.getByLabelText("Catalogue polarization channel"))
      .getAllByRole("option")
      .map((item) => item.textContent),
  ).toEqual(["HH", "HV"]);
  fireEvent.change(screen.getByLabelText("Catalogue polarization channel"), {
    target: { value: "HV" },
  });
  expect(
    screen.getByText(
      /Cross-polarization: transmit horizontal, receive vertical/,
    ),
  ).toBeTruthy();
  expect(within(terms).queryByRole("option", { name: "HVHV" })).toBeNull();
  fireEvent.click(
    screen.getByText("/science/LSAR/GCOV/grids/frequencyA/HHHH", {
      selector: "summary code",
    }),
  );
  expect(screen.getByText("-9999")).toBeTruthy();
  expect(screen.getByText(/"test_only": true/)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Open in FLAGWA Explorer" })
      .getAttribute("href"),
  ).toBe("/explore/synthetic-water/results/synthetic-result-one");
  expect(
    screen
      .getByRole("link", { name: "GeoTIFF", exact: true })
      .getAttribute("href"),
  ).toBe("/backend/api/v1/exports/synthetic-result-one/geotiff");
  expect(api.get).toHaveBeenCalledWith(
    "/api/v1/results/synthetic-result-one/metadata",
    expect.any(AbortSignal),
  );
  expect(api.get).toHaveBeenCalledWith(
    "/api/v1/results/synthetic-result-one/statistics",
    expect.any(AbortSignal),
  );
  fireEvent.change(screen.getByLabelText("Relevant source scene"), {
    target: { value: "synthetic-scene-two" },
  });
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/scenes/synthetic-scene-two",
      expect.any(AbortSignal),
    ),
  );
});

test("location selection shows a truthful empty state and failed jobs, never sample metrics", async () => {
  setup();
  await screen.findByLabelText("Study location");
  fireEvent.change(screen.getByLabelText("Study location"), {
    target: { value: "synthetic-empty" },
  });
  expect(
    await screen.findByText(
      "No processed NISAR observation is currently available for this study area.",
    ),
  ).toBeTruthy();
  expect(await screen.findByText(/failed analysis job/)).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: /Open Catalogue and Compatibility/ })
      .getAttribute("href"),
  ).toBe("/explore/synthetic-empty");
  expect(screen.queryByRole("img", { name: /Spatial backscatter/ })).toBeNull();
});

test("missing inspection, scene download, statistics and assets remain unavailable rather than invented", async () => {
  results[0].statistics = {};
  results[0].metadata.source_scenes = ["synthetic-scene-one"];
  scene.download_status = "NOT_DOWNLOADED";
  inspectionError = new ApiError(
    "Acquire and inspect product first",
    409,
    "PRODUCT_NOT_INSPECTED",
  );
  assetsAvailable = false;
  setup();
  expect(await screen.findByText("HDF5 inspection unavailable")).toBeTruthy();
  expect(await screen.findByText("Measured chart unavailable")).toBeTruthy();
  expect(await screen.findByText("Result preview unavailable")).toBeTruthy();
  expect(screen.getByText(/Scene not downloaded/)).toBeTruthy();
  expect(
    screen.queryByLabelText("Available inspected GCOV power term"),
  ).toBeNull();
  expect(
    screen.queryByRole("link", { name: "GeoTIFF", exact: true }),
  ).toBeNull();
});

test("GUNW and GOFF maintain distinct measured summaries and scientific limits", async () => {
  results = ["GUNW", "GOFF"].map((product, index) => ({
    ...structuredClone(syntheticResult),
    id: `synthetic-result-${index}`,
    result_type:
      product === "GUNW"
        ? "apparent_relative_los_displacement"
        : "glacier_radar_coordinate_offset_rate",
    metadata: {
      ...syntheticResult.metadata,
      processing_level: product,
      source_scenes: [],
    },
    statistics: {
      units: product === "GUNW" ? "m" : "m/day",
      minimum: -0.2,
      mean: 0,
      maximum: 0.4,
    },
  }));
  setup();
  expect(
    await screen.findByRole("heading", {
      name: "Apparent relative LOS displacement",
    }),
  ).toBeTruthy();
  expect(screen.getByText(/Spatial apparent LOS summary \(m\)/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Backscatter change" }),
  ).toBeNull();
  expect(
    screen.getByText("No NISAR source scenes reported for this result"),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Product type"), {
    target: { value: "GOFF" },
  });
  expect(
    await screen.findByRole("heading", {
      name: "Glacier radar-coordinate rate",
    }),
  ).toBeTruthy();
  expect(
    screen.getByText(/Spatial radar-coordinate rate summary \(m\/day\)/),
  ).toBeTruthy();
  expect(
    screen.getAllByText(/not automatically horizontal or three-dimensional/)
      .length,
  ).toBeGreaterThan(0);
});

test("backend failures and HTTP 424 context do not become zero measurements", async () => {
  backendError = true;
  setup();
  expect(await screen.findByText("Backend unavailable")).toBeTruthy();
  expect(screen.queryByLabelText("Study location")).toBeNull();
  cleanup();
  backendError = false;
  exposureError = true;
  setup();
  await screen.findByRole("heading", { name: "Potential inundation" });
  fireEvent.click(screen.getByText("Community context availability"));
  fireEvent.click(
    screen.getByRole("button", { name: /Check registered context/ }),
  );
  expect(await screen.findByText("Context unavailable")).toBeTruthy();
  expect(screen.getByText(/never zero population or exposure/)).toBeTruthy();
});
