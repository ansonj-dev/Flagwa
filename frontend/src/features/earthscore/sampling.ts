import { fromUrl } from "geotiff";
import proj4 from "proj4";
import { toProj4 } from "geotiff-geokeys-to-proj4";
import type { Polygon } from "geojson";
import type { AnalysisResult } from "../../types/domain";
import { aggregateScore, candidateCellArea, makeStages } from "./model.ts";
import type {
  MeasurementKey,
  ScoreDataset,
  ScoreSample,
  ScoreVariable,
} from "./model.ts";

export interface ScoreRequest {
  result: AnalysisResult;
  sources: Partial<Record<MeasurementKey | "classification", string>>;
}
async function openRaster(url: string) {
  const tiff = await fromUrl(url, { allowFullFile: false, maxRanges: 0 });
  const base = await tiff.getImage();
  const projection = toProj4(base.getGeoKeys() ?? {}).proj4;
  if (!projection) throw new Error("The source CRS cannot be safely resolved.");
  const images = await Promise.all(
    Array.from({ length: await tiff.getImageCount() }, (_, index) =>
      tiff.getImage(index),
    ),
  );
  const index = images.findIndex(
    (image) => image.getWidth() <= 384 && image.getHeight() <= 384,
  );
  if (index < 0)
    throw new Error(
      "No bounded native image or COG overview is available. Whole-file loading is not used.",
    );
  const image = images[index],
    resolution = base.getResolution();
  if (!(resolution[0] > 0 && resolution[1] < 0))
    throw new Error("Only the documented north-up source grid is supported.");
  const data = await image.readRasters({ samples: [0], interleave: true });
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    baseWidth: base.getWidth(),
    baseHeight: base.getHeight(),
    bbox: base.getBoundingBox(),
    crs: projection,
    index,
    nodata: image.getGDALNoData(),
    data: data as unknown as ArrayLike<number>,
  };
}
export async function sampleScore(
  request: ScoreRequest,
): Promise<ScoreDataset> {
  const roles = Object.entries(request.sources) as [
    MeasurementKey | "classification",
    string,
  ][];
  const hasMeasurements = roles.some(([role]) => role !== "classification"),
    legend = request.result.metadata.class_legend ?? {},
    candidateLabels = Object.entries(legend)
      .filter(([code]) => candidateCellArea(Number(code), legend, 1) === 1)
      .map(([, label]) => label),
    classificationOnly =
      !hasMeasurements &&
      roles.some(([role]) => role === "classification") &&
      candidateLabels.length > 0;
  if (!hasMeasurements && !classificationOnly)
    return aggregateScore(request.result);
  const rasters = await Promise.all(
    roles.map(async ([role, url]) => [role, await openRaster(url)] as const),
  );
  const reference = rasters[0][1];
  for (const [, raster] of rasters)
    if (
      raster.crs !== reference.crs ||
      raster.width !== reference.width ||
      raster.height !== reference.height ||
      raster.baseWidth !== reference.baseWidth ||
      raster.baseHeight !== reference.baseHeight ||
      raster.bbox.some(
        (coordinate, index) =>
          Math.abs(coordinate - reference.bbox[index]) > 0.001,
      )
    )
      throw new Error(
        "The selected source grids are not aligned. No spatial correspondence is invented.",
      );
  const rows = Math.min(8, reference.height),
    columns = Math.min(24, reference.width),
    projection = proj4(reference.crs, "WGS84");
  const [west, south, east, north] = reference.bbox,
    pixelWidth = (east - west) / reference.width,
    pixelHeight = (north - south) / reference.height,
    cellAreaKm2 = Math.abs(pixelWidth * pixelHeight) / 1e6;
  const polygon = (
    left: number,
    bottom: number,
    right: number,
    top: number,
  ): Polygon => ({
    type: "Polygon",
    coordinates: [
      [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left, top],
      ].map((point) => projection.forward(point)),
    ],
  });
  const sectors = Array.from({ length: rows }, (_, sector) => ({
    id: sector,
    label: `Band ${String(sector + 1).padStart(2, "0")} · northing ${(north - (sector / rows) * (north - south)).toFixed(0)}–${(north - ((sector + 1) / rows) * (north - south)).toFixed(0)}`,
    geometry: polygon(
      west,
      north - ((sector + 1) / rows) * (north - south),
      east,
      north - (sector / rows) * (north - south),
    ),
  }));
  const samples: ScoreSample[] = [];
  for (let sector = 0; sector < rows; sector++)
    for (let column = 0; column < columns; column++) {
      const pixelColumn = Math.floor(
          ((column + 0.5) / columns) * reference.width,
        ),
        pixelRow = Math.floor(((sector + 0.5) / rows) * reference.height),
        pixelIndex = pixelRow * reference.width + pixelColumn;
      const values: ScoreSample["values"] = {};
      const storedValues: ScoreSample["values"] = {};
      let classCode: number | null = null;
      for (const [role, raster] of rasters) {
        const stored = Number(raster.data[pixelIndex]);
        const value =
          !Number.isFinite(stored) || stored === raster.nodata ? null : stored;
        if (role !== "classification") storedValues[role] = value;
        if (role === "classification") classCode = value;
        else
          values[role] =
            value === null ||
            ((role === "before" || role === "after") && value <= 0)
              ? null
              : role === "before" || role === "after"
                ? 10 * Math.log10(value)
                : value;
      }
              if (classificationOnly)
                values.area = candidateCellArea(classCode, legend, cellAreaKm2);
      if (classCode === 0 && "change" in values) values.change = null;
      const left = west + pixelColumn * pixelWidth,
        top = north - pixelRow * pixelHeight;
      const center = projection.forward([
        left + pixelWidth / 2,
        top - pixelHeight / 2,
      ]);
      samples.push({
        id: `overview-${reference.index}-${pixelRow}-${pixelColumn}`,
        sector,
        column,
        longitude: center[0],
        latitude: center[1],
        geometry: polygon(left, top - pixelHeight, left + pixelWidth, top),
        values,
        storedValues,
        classCode,
        pixel: {
          column: pixelColumn,
          row: pixelRow,
          overview: reference.index,
        },
      });
    }
  const variables: ScoreVariable[] = rasters
    .filter(([role]) => role !== "classification")
    .map(([role]) => ({
      key: role as MeasurementKey,
      label:
        role === "before"
          ? "Reference power (dB)"
          : role === "after"
            ? "Observation power (dB)"
            : role === "change"
              ? "Derived backscatter change"
              : "Derived product measurement",
      units:
        role === "measurement"
          ? String(
              request.result.statistics.units ??
                request.result.metadata.units ??
                "Units not reported",
            )
          : "dB",
      kind: role === "before" || role === "after" ? "observed" : "derived",
      source:
        role === "before" || role === "after"
          ? `${role}_power COG; 10 log10(stored averaged power)`
          : `${role === "change" ? "change_geotiff" : "primary"} COG; stored ${reference.index ? "overview aggregate" : "native pixel"}`,
    }));
  if (classificationOnly)
    variables.push({
      key: "area",
      label:
        request.result.result_type === "forest_disturbance_candidates"
          ? "Forest disturbance candidate area"
          : request.result.result_type ===
              "fire_associated_radar_optical_candidates"
            ? "Fire-associated candidate area"
            : "Potential inundation candidate area",
      units: "km²",
      kind: "derived",
      source: `classification COG class legend and sampled ${reference.index ? "overview cell" : "native cell"} footprint`,
    });
  return {
    mode: "spatial",
    samples,
    variables,
    stages: makeStages(
      request.result.metadata.acquisition_dates ?? [],
      variables,
    ),
    sectors,
    crs: String(request.result.statistics.grid_crs ?? reference.crs),
    overview: {
      width: reference.width,
      height: reference.height,
      baseWidth: reference.baseWidth,
      baseHeight: reference.baseHeight,
      index: reference.index,
    },
    sampling: `${samples.length} deterministic samples from the stored ${reference.width} × ${reference.height} COG ${reference.index ? `overview ${reference.index}` : "native grid"}. These are sampled cell footprints, not complete sector means or full-resolution pixel readings.${classificationOnly ? " Candidate area is the class area of each sampled cell, not the total candidate area." : ""}`,
    warnings: [
      "Connecting ribbons associate two documented observations. Their cubic shape and crossfade are artistic links, not measured paths, motion trajectories or intermediate observations. Native stored values are retained alongside converted dB values.",
      "Continuous overviews are backend-generated averages; classification overviews use nearest-neighbour codes. Sampling does not add observations.",
      "10 log10(average power) is not average dB. The stored average change may differ from subtracting the two displayed power values.",
      "Class 0 masks derived change; class 4 stipples uncertain interpretation at the matched classification sample. Other classes do not establish scientific validation.",
    ],
  };
}
