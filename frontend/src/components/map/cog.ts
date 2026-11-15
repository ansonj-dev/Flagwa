import { addProtocol } from "maplibre-gl";
import CogWorker from "./cog.worker?worker";
interface Style {
  palette: string;
  minimum: number;
  maximum: number;
}
let serial = 0,
  cursor = 0,
  installed = false;
const workers: Worker[] = [];
const pending = new Map<
  number,
  {
    resolve: (value: { data: ArrayBuffer }) => void;
    reject: (reason: Error) => void;
  }
>();
export const rasterEvents = new EventTarget();
export function installCogProtocol() {
  if (installed) return;
  installed = true;
  for (let index = 0; index < 2; index++) {
    const worker = new CogWorker();
    worker.onmessage = (event) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      pending.delete(event.data.id);
      if (event.data.error) {
        task.reject(new Error(event.data.error));
        rasterEvents.dispatchEvent(
          new CustomEvent("raster-error", { detail: event.data.error }),
        );
      } else {
        task.resolve({ data: event.data.data });
        rasterEvents.dispatchEvent(new Event("raster-ready"));
      }
    };
    workers.push(worker);
  }
  addProtocol(
    "cog",
    (request, controller) =>
      new Promise((resolve, reject) => {
        const url = new URL(request.url);
        const coordinates = url.pathname.split("/").filter(Boolean).map(Number),
          id = ++serial;
        pending.set(id, { resolve, reject });
        const worker = workers[cursor++ % workers.length];
        controller.signal.addEventListener(
          "abort",
          () => {
            pending.delete(id);
            worker.postMessage({ id, cancel: true });
            reject(new DOMException("Cancelled", "AbortError"));
          },
          { once: true },
        );
        worker.postMessage({
          id,
          url: url.searchParams.get("source"),
          zoom: coordinates[0],
          column: coordinates[1],
          row: coordinates[2],
          palette: url.searchParams.get("palette"),
          minimum: Number(url.searchParams.get("min")),
          maximum: Number(url.searchParams.get("max")),
        });
      }),
  );
}
export function cogTemplate(source: string, style: Style) {
  const url = new URL(source, window.location.origin).href;
  return `cog://tiles/{z}/{x}/{y}?source=${encodeURIComponent(url)}&palette=${style.palette}&min=${style.minimum}&max=${style.maximum}`;
}
