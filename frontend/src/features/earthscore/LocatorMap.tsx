import { useEffect, useRef } from "react";
import { Map, AttributionControl } from "../../components/map/maplibre";
import type { GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import type { ScoreDataset, ScoreStage } from "./model";
import { stageValue } from "./model";
import "maplibre-gl/dist/maplibre-gl.css";
export function LocatorMap({
  dataset,
  study,
  selectedId,
  sector,
  stage,
  onSelect,
}: {
  dataset: ScoreDataset;
  study?: Geometry | null;
  selectedId: string | null;
  sector: number | null;
  stage: ScoreStage;
  onSelect: (id: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    mapRef = useRef<Map | null>(null),
    latest = useRef({ dataset, study, selectedId, sector, stage, onSelect });
  latest.current = { dataset, study, selectedId, sector, stage, onSelect };
  function update() {
    const map = mapRef.current;
    if (!map?.getSource("samples")) return;
    const current = latest.current;
    const samples: FeatureCollection = {
      type: "FeatureCollection",
      features: current.dataset.samples
        .filter((sample) => sample.geometry)
        .map((sample) => ({
          type: "Feature",
          geometry: sample.geometry!,
          properties: {
            id: sample.id,
            sector: sample.sector,
            selected: sample.id === current.selectedId,
            missing: stageValue(sample, current.stage) === null,
            uncertain:
              current.stage.kind === "derived" && sample.classCode === 4,
          },
        })),
    };
    (map.getSource("samples") as GeoJSONSource).setData(samples);
    (map.getSource("sector") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: current.dataset.sectors
        .filter((band) => band.id === current.sector && band.geometry)
        .map((band) => ({
          type: "Feature",
          properties: {},
          geometry: band.geometry!,
        })),
    });
    (map.getSource("study") as GeoJSONSource).setData(
      current.study
        ? { type: "Feature", properties: {}, geometry: current.study }
        : { type: "FeatureCollection", features: [] },
    );
  }
  useEffect(() => {
    if (!root.current) return;
    const map = new Map({
      container: root.current,
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster",
            tiles: [
              "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 16,
            attribution: "Context © Esri, HERE, OSM",
          },
        },
        layers: [{ id: "base", type: "raster", source: "base" }],
      },
      center: [0, 15],
      zoom: 1,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;
    map.addControl(new AttributionControl({ compact: true }));
    map.on("style.load", () => {
      for (const id of ["samples", "sector", "study"])
        map.addSource(id, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      map.addLayer({
        id: "study-outline",
        type: "line",
        source: "study",
        paint: {
          "line-color": "#9aaac0",
          "line-width": 1,
          "line-dasharray": [2, 3],
        },
      });
      map.addLayer({
        id: "sector-area",
        type: "fill",
        source: "sector",
        paint: {
          "fill-color": "#718cff",
          "fill-opacity": 0.13,
          "fill-outline-color": "#718cff",
        },
      });
      map.addLayer({
        id: "sample-area",
        type: "fill",
        source: "samples",
        paint: {
          "fill-color": [
            "case",
            ["get", "selected"],
            "#f1f9ff",
            ["get", "missing"],
            "#62707d",
            ["get", "uncertain"],
            "#e9b653",
            "#20c8d2",
          ],
          "fill-opacity": [
            "case",
            ["get", "selected"],
            0.95,
            ["get", "missing"],
            0.15,
            0.7,
          ],
        },
      });
      map.addLayer({
        id: "sample-outline",
        type: "line",
        source: "samples",
        paint: {
          "line-color": ["case", ["get", "selected"], "#ffffff", "#20c8d2"],
          "line-width": ["case", ["get", "selected"], 3, 0.7],
        },
      });
      update();
      const coordinates = latest.current.dataset.samples.flatMap(
        (sample) => sample.geometry?.coordinates[0] ?? [],
      );
      if (coordinates.length)
        map.fitBounds(
          [
            [
              Math.min(...coordinates.map((point) => point[0])),
              Math.min(...coordinates.map((point) => point[1])),
            ],
            [
              Math.max(...coordinates.map((point) => point[0])),
              Math.max(...coordinates.map((point) => point[1])),
            ],
          ],
          { padding: 28, duration: 0, maxZoom: 14 },
        );
      else if (latest.current.study?.type === "Polygon") {
        const points = latest.current.study.coordinates[0];
        map.fitBounds(
          [
            [
              Math.min(...points.map((point) => point[0])),
              Math.min(...points.map((point) => point[1])),
            ],
            [
              Math.max(...points.map((point) => point[0])),
              Math.max(...points.map((point) => point[1])),
            ],
          ],
          { padding: 28, duration: 0 },
        );
      }
    });
    map.on("render", () => {
      if (map.getLayer("sample-area"))
        root.current?.setAttribute(
          "data-rendered-samples",
          String(
            map.queryRenderedFeatures(undefined, { layers: ["sample-area"] })
              .length,
          ),
        );
    });
    map.on("click", (event) => {
      if (!map.getLayer("sample-area")) return;
      const exact = map.queryRenderedFeatures(event.point, {
        layers: ["sample-area"],
      });
      if (exact[0]?.properties.id) {
        latest.current.onSelect(String(exact[0].properties.id));
        return;
      }
      const nearby = map.queryRenderedFeatures(
        [
          [event.point.x - 14, event.point.y - 14],
          [event.point.x + 14, event.point.y + 14],
        ],
        { layers: ["sample-area"] },
      );
      const distance = (id: unknown) => {
        const sample = latest.current.dataset.samples.find(
          (sample) => sample.id === id,
        );
        if (sample?.longitude == null || sample.latitude == null)
          return Infinity;
        const point = map.project([sample.longitude, sample.latitude]);
        return Math.hypot(point.x - event.point.x, point.y - event.point.y);
      };
      nearby.sort(
        (first, second) =>
          distance(first.properties.id) - distance(second.properties.id),
      );
      if (nearby[0]?.properties.id)
        latest.current.onSelect(String(nearby[0].properties.id));
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(root.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [dataset]);
  useEffect(update, [selectedId, sector, stage, study]);
  return (
    <div
      ref={root}
      className="earthscore-locator"
      data-selected-sample={selectedId ?? ""}
      data-stage={stage.id}
      role="region"
      aria-label="Geographic locator with selectable actual sample footprints"
    />
  );
}
