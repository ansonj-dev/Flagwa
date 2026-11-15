import { create } from "zustand";
export type Panel =
  | "overview"
  | "layers"
  | "catalog"
  | "community"
  | "evidence"
  | "jobs"
  | "analysis";
interface ExplorerState {
  selectedLocation: string;
  panel: Panel;
  viewport: { center: [number, number]; zoom: number };
  layers: Record<string, boolean>;
  opacity: number;
  selectedObservation: number;
  swipe: number;
  compare: boolean;
  sheet: "peek" | "half" | "full";
  selectedFeature: Record<string, unknown> | null;
  selectLocation: (slug: string) => void;
  setPanel: (panel: Panel) => void;
  setViewport: (center: [number, number], zoom: number) => void;
  toggleLayer: (id: string) => void;
  setOpacity: (value: number) => void;
  setObservation: (index: number) => void;
  setSwipe: (value: number) => void;
  setCompare: (value: boolean) => void;
  setSheet: (value: "peek" | "half" | "full") => void;
  setFeature: (value: Record<string, unknown> | null) => void;
}
export const useExplorer = create<ExplorerState>((set) => ({
  selectedLocation: "kuttanad",
  panel: "overview",
  viewport: { center: [50, 18], zoom: 1.8 },
  layers: {
    classification: true,
    candidates: false,
    boundary: true,
    footprints: false,
    community: true,
  },
  opacity: 0.8,
  selectedObservation: 1,
  swipe: 50,
  compare: false,
  sheet: "peek",
  selectedFeature: null,
  selectLocation: (selectedLocation) =>
    set({ selectedLocation, selectedObservation: 1, selectedFeature: null }),
  setPanel: (panel) => set({ panel, sheet: "half" }),
  setViewport: (center, zoom) => set({ viewport: { center, zoom } }),
  toggleLayer: (id) =>
    set((state) => ({ layers: { ...state.layers, [id]: !state.layers[id] } })),
  setOpacity: (opacity) => set({ opacity }),
  setObservation: (selectedObservation) => set({ selectedObservation }),
  setSwipe: (swipe) => set({ swipe: Math.max(0, Math.min(100, swipe)) }),
  setCompare: (compare) => set({ compare }),
  setSheet: (sheet) => set({ sheet }),
  setFeature: (selectedFeature) => set({ selectedFeature }),
}));
