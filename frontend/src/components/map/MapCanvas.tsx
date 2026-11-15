import { useEffect, useRef, useState } from "react";
import { Map, AttributionControl } from "./maplibre";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import type { Geometry, Position, FeatureCollection } from "geojson";
import {
  Crosshair,
  Minus,
  Plus,
  X,
  Satellite,
  Map as MapIcon,
  LoaderCircle,
  MoveHorizontal,
} from "lucide-react";
import { installCogProtocol, cogTemplate, rasterEvents } from "./cog";
import { api } from "../../services/data";
import { useExplorer } from "../../store/explorer";
import { measurementStyle } from "../../utils/science";
import type {
  AnalysisResult,
  LayerManifest,
  LocationRecord,
  Scene,
} from "../../types/domain";
import { IconButton } from "../ui";
import "maplibre-gl/dist/maplibre-gl.css";

function boundsOf(
  geometry?: Geometry | null,
): [[number, number], [number, number]] | null {
  if (!geometry || !("coordinates" in geometry)) return null;
  const positions: Position[] = [];
  function visit(coordinates: unknown) {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number")
      positions.push(coordinates as Position);
    else coordinates.forEach(visit);
  }
  visit(geometry.coordinates);
  if (!positions.length) return null;
  return [
    [
      Math.min(...positions.map((point) => point[0])),
      Math.min(...positions.map((point) => point[1])),
    ],
    [
      Math.max(...positions.map((point) => point[0])),
      Math.max(...positions.map((point) => point[1])),
    ],
  ];
}
function baseStyle(satellite: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: satellite
          ? [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ]
          : [
              "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            ],
        tileSize: 256,
        attribution: satellite
          ? "Contextual optical imagery © Esri, Maxar, Earthstar Geographics"
          : "Contextual cartography © Esri, HERE, Garmin, OpenStreetMap contributors",
        maxzoom: satellite ? 19 : 16,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#08121d" },
      },
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-opacity": satellite ? 0.8 : 0.9 },
      },
    ],
  };
}
const emptyGeoJSON: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
interface Props {
  location?: LocationRecord;
  result?: AnalysisResult;
  manifest?: LayerManifest;
  scenes: Scene[];
  candidates?: FeatureCollection;
  community?: FeatureCollection;
  labLayer?: "result" | "before" | "after" | "change";
}
export function MapCanvas({
  location,
  result,
  manifest,
  scenes,
  candidates,
  community,
  labLayer,
}: Props) {
  const root = useRef<HTMLDivElement>(null),
    comparison = useRef<HTMLDivElement>(null),
    mapRef = useRef<Map | null>(null),
    comparisonRef = useRef<Map | null>(null);
  const [ready, setReady] = useState(0),
    [satellite, setSatellite] = useState(false),
    [rasterReady, setRasterReady] = useState(false),
    [idle, setIdle] = useState(false),
    [mapError, setMapError] = useState(""),
    [coordinate, setCoordinate] = useState<[number, number] | null>(null);
  const explorer = useExplorer();
  const embedded = Boolean(labLayer);
  const layers: Record<string, boolean> = embedded
    ? {
        classification: labLayer === "result" || labLayer === "change",
        change: labLayer === "change",
        boundary: true,
      }
    : explorer.layers;
  const opacity = embedded ? 1 : explorer.opacity;
  const compare = embedded ? false : explorer.compare;
  const swipe = explorer.swipe;
  const selectedObservation = embedded
    ? labLayer === "before"
      ? 0
      : 1
    : explorer.selectedObservation;
  const { setViewport, setFeature } = explorer;
  const geometry = result?.metadata.study_aoi ?? location?.geometry;
  const fit = () => {
    const bounds = boundsOf(geometry);
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 850;
    if (bounds)
      mapRef.current?.fitBounds(bounds, {
        padding: embedded
          ? { top: 45, bottom: 65, left: 45, right: 45 }
          : {
              top: 120,
              bottom: 145,
              left: 100,
              right: innerWidth > 1000 ? 425 : 50,
            },
        duration,
        maxZoom: 15,
      });
    else mapRef.current?.easeTo({ center: [0, 20], zoom: 1.2, duration });
  };
  useEffect(() => {
    if (!root.current || !comparison.current) return;
    installCogProtocol();
    const settings = {
      style: baseStyle(satellite),
      center: [50, 18] as [number, number],
      zoom: 1.8,
      attributionControl: false as const,
      maxTileCacheSize: 48,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      fadeDuration: 0,
    };
    const map = new Map({ ...settings, container: root.current }),
      second = new Map({
        ...settings,
        container: comparison.current,
        interactive: false,
      });
    mapRef.current = map;
    comparisonRef.current = second;
    map.addControl(new AttributionControl({ compact: true }), "bottom-left");
    let count = 0;
    const loaded = () => {
      count++;
      if (count === 2) setReady((value) => value + 1);
    };
    map.on("load", loaded);
    second.on("load", loaded);
    map.on("move", () => {
      second.jumpTo({
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    });
    map.on("moveend", () => {
      if (!embedded)
        setViewport(
          map.getCenter().toArray() as [number, number],
          map.getZoom(),
        );
    });
    map.on("idle", () => setIdle(true));
    map.on("sourcedataloading", () => setIdle(false));
    map.on("click", (event) => {
      setCoordinate([event.lngLat.lng, event.lngLat.lat]);
      const available = ["candidate-polygons", "community-features"].filter(
        (id) => map.getLayer(id),
      );
      const feature = available.length
        ? map.queryRenderedFeatures(event.point, { layers: available })[0]
        : undefined;
      if (!embedded) setFeature(feature?.properties ?? null);
    });
    map.on("error", (event) => {
      if (event.error.message.includes("WebGL"))
        setMapError(
          "WebGL is unavailable. Use the downloadable evidence and result preview.",
        );
    });
    const onError = (event: Event) =>
        setMapError((event as CustomEvent<string>).detail),
      onReady = () => {
        setRasterReady(true);
        setMapError("");
      };
    rasterEvents.addEventListener("raster-error", onError);
    rasterEvents.addEventListener("raster-ready", onReady);
    return () => {
      map.remove();
      second.remove();
      rasterEvents.removeEventListener("raster-error", onError);
      rasterEvents.removeEventListener("raster-ready", onReady);
    };
  }, [satellite, setViewport, setFeature, embedded]);
  useEffect(() => {
    if (ready) fit();
  }, [ready, location?.slug, result?.id]);
  useEffect(() => {
    if (
      !ready ||
      !mapRef.current?.getLayer("basemap") ||
      !comparisonRef.current?.getLayer("basemap")
    )
      return;
    const map = mapRef.current!,
      second = comparisonRef.current!;
    const maps = [map, second];
    for (const target of maps) {
      for (const id of [
        "measurement",
        "observation",
        "study-boundary",
        "scene-footprints",
        "candidate-polygons",
        "community-features",
      ])
        if (target.getLayer(id)) target.removeLayer(id);
      for (const id of [
        "measurement",
        "observation",
        "boundary",
        "footprints",
        "candidates",
        "community",
      ])
        if (target.getSource(id)) target.removeSource(id);
    }
    setRasterReady(false);
    const measurement = result
      ? measurementStyle(result, Boolean(layers.change))
      : null;
    for (const [index, target] of maps.entries()) {
      const observation =
        embedded && (labLayer === "result" || labLayer === "change")
          ? undefined
          : compare
            ? index === 0
              ? manifest?.layers.after_power
              : manifest?.layers.before_power
            : selectedObservation === 0
              ? manifest?.layers.before_power
              : manifest?.layers.after_power;
      if (observation) {
        target.addSource("observation", {
          type: "raster",
          tiles: [
            cogTemplate(observation.href, {
              palette: "power",
              minimum: -30,
              maximum: 0,
            }),
          ],
          tileSize: 256,
          maxzoom: 16,
        });
        target.addLayer({
          id: "observation",
          type: "raster",
          source: "observation",
          paint: {
            "raster-opacity": 1,
            "raster-resampling": "nearest",
            "raster-fade-duration": 0,
          },
        });
      }
      if (
        result &&
        !compare &&
        measurement &&
        (!embedded || layers.classification)
      ) {
        target.addSource("measurement", {
          type: "raster",
          tiles: [
            cogTemplate(
              layers.change && manifest?.layers.change_geotiff
                ? manifest.layers.change_geotiff.href
                : api.url(`/api/v1/exports/${result.id}/geotiff`),
              measurement,
            ),
          ],
          tileSize: 256,
          maxzoom: 16,
        });
        target.addLayer({
          id: "measurement",
          type: "raster",
          source: "measurement",
          paint: {
            "raster-opacity": layers.classification ? opacity : 0,
            "raster-resampling": "nearest",
            "raster-fade-duration": 0,
          },
        });
      }
      target.addSource("boundary", {
        type: "geojson",
        data: geometry
          ? { type: "Feature", properties: {}, geometry }
          : emptyGeoJSON,
      });
      target.addLayer({
        id: "study-boundary",
        type: "line",
        source: "boundary",
        paint: {
          "line-color": "#8292a8",
          "line-width": 1.5,
          "line-dasharray": [2, 3],
        },
        layout: { visibility: layers.boundary ? "visible" : "none" },
      });
      target.addSource("footprints", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: scenes
            .filter((scene) => scene.geometry)
            .map((scene) => ({
              type: "Feature",
              geometry: scene.geometry!,
              properties: { scene_id: scene.scene_id },
            })),
        },
      });
      target.addLayer({
        id: "scene-footprints",
        type: "line",
        source: "footprints",
        paint: { "line-color": "#20c8d2", "line-width": 1 },
        layout: { visibility: layers.footprints ? "visible" : "none" },
      });
      target.addSource("candidates", {
        type: "geojson",
        data: candidates ?? emptyGeoJSON,
      });
      target.addLayer({
        id: "candidate-polygons",
        type: "fill",
        source: "candidates",
        paint: {
          "fill-color": "#e9b653",
          "fill-opacity": 0.23,
          "fill-outline-color": "#e9b653",
        },
        layout: { visibility: layers.candidates ? "visible" : "none" },
      });
      target.addSource("community", {
        type: "geojson",
        data: community ?? emptyGeoJSON,
      });
      target.addLayer({
        id: "community-features",
        type: "circle",
        source: "community",
        paint: {
          "circle-radius": 5,
          "circle-color": "#718cff",
          "circle-stroke-color": "#d9e2ed",
          "circle-stroke-width": 1,
        },
        layout: { visibility: layers.community ? "visible" : "none" },
      });
    }
  }, [
    ready,
    result?.id,
    manifest,
    compare,
    selectedObservation,
    satellite,
    layers.change,
    labLayer,
  ]);
  useEffect(() => {
    for (const target of [mapRef.current, comparisonRef.current]) {
      if (!target?.isStyleLoaded()) continue;
      if (target.getLayer("measurement"))
        target.setPaintProperty(
          "measurement",
          "raster-opacity",
          layers.classification ? opacity : 0,
        );
      for (const [layer, toggle] of [
        ["study-boundary", "boundary"],
        ["scene-footprints", "footprints"],
        ["candidate-polygons", "candidates"],
        ["community-features", "community"],
      ])
        if (target.getLayer(layer))
          target.setLayoutProperty(
            layer,
            "visibility",
            layers[toggle] ? "visible" : "none",
          );
      (target.getSource("candidates") as GeoJSONSource | undefined)?.setData(
        candidates ?? emptyGeoJSON,
      );
      (target.getSource("community") as GeoJSONSource | undefined)?.setData(
        community ?? emptyGeoJSON,
      );
    }
  }, [layers, opacity, candidates, community, ready]);
  return (
    <div
      className={`map-stage ${rasterReady ? "raster-ready" : ""}`}
      data-map-idle={idle}
      aria-label="Geospatial evidence map"
    >
      <div ref={root} className="map-canvas" />
      <div
        className="compare-map"
        style={{
          clipPath: compare
            ? `inset(0 ${100 - swipe}% 0 0)`
            : "inset(0 100% 0 0)",
        }}
        aria-hidden={!compare}
      >
        <div ref={comparison} className="map-canvas" />
      </div>
      {compare && (
        <>
          <div className="swipe-line" style={{ left: `${swipe}%` }} />
          <div className="swipe-control" style={{ left: `${swipe}%` }}>
            <MoveHorizontal size={16} />
          </div>
          <input
            className="swipe-input"
            aria-label="Before and after comparison divider"
            type="range"
            min="0"
            max="100"
            step="1"
            value={swipe}
            onChange={(event) =>
              useExplorer.getState().setSwipe(Number(event.target.value))
            }
            onKeyDown={(event) => {
              if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                useExplorer
                  .getState()
                  .setSwipe(
                    swipe +
                      (event.key === "ArrowRight" ? 1 : -1) *
                        (event.shiftKey ? 1 : 10),
                  );
              }
            }}
          />
          <span className="comparison-label before">
            Before · {result?.metadata.polarization || "Prepared power"}
          </span>
          <span className="comparison-label after">
            After · {result?.metadata.polarization || "Prepared power"}
          </span>
        </>
      )}
      <div className="map-tools">
        <IconButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <Plus size={18} />
        </IconButton>
        <IconButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <Minus size={18} />
        </IconButton>
        <IconButton label="Fit study area" onClick={fit}>
          <Crosshair size={18} />
        </IconButton>
        <IconButton
          label={
            satellite
              ? "Use cartographic basemap"
              : "Use contextual optical basemap"
          }
          onClick={() => setSatellite(!satellite)}
        >
          {satellite ? <MapIcon size={18} /> : <Satellite size={18} />}
        </IconButton>
      </div>
      <span className="basemap-caption">
        {satellite
          ? "Context only · optical basemap, not NISAR"
          : "Context only · cartographic basemap"}
      </span>
      {result && !rasterReady && (
        <div className="map-loading" role="status">
          <LoaderCircle size={16} className="spin" /> Reading bounded raster
          windows
        </div>
      )}
      {mapError && (
        <div className="map-notice" role="alert">
          {mapError}
          <button
            onClick={() => setMapError("")}
            aria-label="Dismiss map error"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {coordinate && (
        <div className="coordinate-popup">
          <span className="mono">
            {coordinate[1].toFixed(5)}°N · {coordinate[0].toFixed(5)}°E
          </span>
          <small>WGS84 · coordinates, not a new raster measurement</small>
          <IconButton
            label="Close coordinate popup"
            onClick={() => setCoordinate(null)}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
