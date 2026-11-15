import { fromUrl } from "geotiff";
import type { GeoTIFF, GeoTIFFImage } from "geotiff";
import proj4 from "proj4";
import { toProj4 } from "geotiff-geokeys-to-proj4";

interface TileRequest {
  id: number;
  url: string;
  zoom: number;
  column: number;
  row: number;
  palette: string;
  minimum: number;
  maximum: number;
}
interface Source {
  tiff: GeoTIFF;
  image: GeoTIFFImage;
  bbox: number[];
  crs: string;
  images: GeoTIFFImage[];
}
const sources = new Map<string, Promise<Source>>();
function longitude(column: number, zoom: number) {
  return (column / 2 ** zoom) * 360 - 180;
}
function latitude(row: number, zoom: number) {
  return (
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / 2 ** zoom))) * 180) /
    Math.PI
  );
}
async function source(url: string) {
  if (sources.size > 5 && !sources.has(url))
    sources.delete(sources.keys().next().value!);
  if (!sources.has(url))
    sources.set(
      url,
      (async () => {
        const tiff = await fromUrl(url, { allowFullFile: false, maxRanges: 0 });
        const image = await tiff.getImage(),
          conversion = toProj4(image.getGeoKeys() ?? {});
        if (!conversion.proj4)
          throw new Error(
            "The raster CRS is unsupported; no unprojected fallback is used.",
          );
        const images = await Promise.all(
          Array.from({ length: await tiff.getImageCount() }, (_, index) =>
            tiff.getImage(index),
          ),
        );
        return {
          tiff,
          image,
          bbox: image.getBoundingBox(),
          crs: conversion.proj4,
          images,
        };
      })(),
    );
  return sources.get(url)!;
}
function color(
  value: number,
  palette: string,
  minimum: number,
  maximum: number,
  column: number,
  row: number,
): number[] {
  if (!Number.isFinite(value)) return [0, 0, 0, 0];
  if (palette === "class") {
    if (value === 0 || value === 1) return [0, 0, 0, 0];
    if (value === 2) return [61, 112, 147, 185];
    if (value === 3) return [233, 182, 83, 215];
    if (value === 4) return [233, 182, 83, (column + row) % 9 < 3 ? 145 : 10];
    return [0, 0, 0, 0];
  }
  if (palette === "power") {
    if (value <= 0) return [0, 0, 0, 0];
    const intensity = Math.round(
      Math.max(0, Math.min(1, (10 * Math.log10(value) + 30) / 30)) * 235 + 15,
    );
    return [intensity, intensity, intensity, 255];
  }
  if (maximum <= minimum) return [32, 200, 210, 210];
  const scale = Math.max(
    0,
    Math.min(1, (value - minimum) / (maximum - minimum)),
  );
  if (palette === "sequential")
    return [20 + 190 * scale, 60 + 175 * scale, 75 + 165 * scale, 235];
  const distance = Math.abs(scale - 0.5) * 2;
  return scale < 0.5
    ? [20 + 40 * distance, 35 + 110 * distance, 45 + 185 * distance, 230]
    : [20 + 213 * distance, 35 + 147 * distance, 45 + 38 * distance, 230];
}
const cancelled = new Set<number>();
async function renderTile(event: MessageEvent<TileRequest>) {
  const request = event.data;
  if (cancelled.delete(request.id)) return;
  try {
    const raster = await source(request.url),
      projection = proj4("WGS84", raster.crs);
    const positions = new Float64Array(256 * 256 * 2);
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
    for (let row = 0; row < 256; row++)
      for (let column = 0; column < 256; column++) {
        const point = projection.forward([
          longitude(request.column + (column + 0.5) / 256, request.zoom),
          latitude(request.row + (row + 0.5) / 256, request.zoom),
        ]);
        const index = (row * 256 + column) * 2;
        positions[index] = point[0];
        positions[index + 1] = point[1];
        west = Math.min(west, point[0]);
        east = Math.max(east, point[0]);
        south = Math.min(south, point[1]);
        north = Math.max(north, point[1]);
      }
    const bbox = raster.bbox,
      canvas = new OffscreenCanvas(256, 256),
      context = canvas.getContext("2d")!;
    if (
      east > bbox[0] &&
      west < bbox[2] &&
      north > bbox[1] &&
      south < bbox[3]
    ) {
      const fraction = Math.min(
        (east - west) / (bbox[2] - bbox[0]),
        (north - south) / (bbox[3] - bbox[1]),
      );
      const target = 512 / Math.max(fraction, 0.000001);
      const image =
        [...raster.images]
          .reverse()
          .find((item) => item.getWidth() >= target) ?? raster.images[0];
      const width = image.getWidth(),
        height = image.getHeight(),
        pixelX = (bbox[2] - bbox[0]) / width,
        pixelY = (bbox[3] - bbox[1]) / height;
      const left = Math.max(0, Math.floor((west - bbox[0]) / pixelX)),
        right = Math.min(width, Math.ceil((east - bbox[0]) / pixelX));
      const top = Math.max(0, Math.floor((bbox[3] - north) / pixelY)),
        bottom = Math.min(height, Math.ceil((bbox[3] - south) / pixelY));
      if (right > left && bottom > top) {
        const sampleWidth = Math.min(512, right - left),
          sampleHeight = Math.min(512, bottom - top);
        const data = await image.readRasters({
          samples: [0],
          window: [left, top, right, bottom],
          width: sampleWidth,
          height: sampleHeight,
          interleave: true,
          resampleMethod: "nearest",
        });
        const imageData = context.createImageData(256, 256),
          nodata = image.getGDALNoData();
        for (let row = 0; row < 256; row++)
          for (let column = 0; column < 256; column++) {
            const index = row * 256 + column,
              sourceX = (positions[index * 2] - bbox[0]) / pixelX,
              sourceY = (bbox[3] - positions[index * 2 + 1]) / pixelY;
            if (
              sourceX < left ||
              sourceX >= right ||
              sourceY < top ||
              sourceY >= bottom
            )
              continue;
            const sampleX = Math.min(
                sampleWidth - 1,
                Math.floor(((sourceX - left) / (right - left)) * sampleWidth),
              ),
              sampleY = Math.min(
                sampleHeight - 1,
                Math.floor(((sourceY - top) / (bottom - top)) * sampleHeight),
              );
            const value = Number(data[sampleY * sampleWidth + sampleX]);
            if (value === nodata) continue;
            imageData.data.set(
              color(
                value,
                request.palette,
                request.minimum,
                request.maximum,
                column + request.column * 256,
                row + request.row * 256,
              ),
              index * 4,
            );
          }
        context.putImageData(imageData, 0, 0);
      }
    }
    const buffer = await (
      await canvas.convertToBlob({ type: "image/png" })
    ).arrayBuffer();
    self.postMessage({ id: request.id, data: buffer }, { transfer: [buffer] });
  } catch (error) {
    self.postMessage({
      id: request.id,
      error:
        error instanceof Error
          ? error.message
          : "Raster tile could not be read.",
    });
  }
}
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<TileRequest & { cancel?: boolean }>) => {
  if (event.data.cancel) {
    cancelled.add(event.data.id);
    return;
  }
  queue = queue.then(() => renderTile(event));
};
