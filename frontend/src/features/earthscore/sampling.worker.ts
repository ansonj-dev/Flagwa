import { sampleScore } from "./sampling";
import type { ScoreRequest } from "./sampling";
self.onmessage = async (event: MessageEvent<ScoreRequest>) => {
  try {
    self.postMessage({ data: await sampleScore(event.data) });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "The scientific raster could not be sampled.",
    });
  }
};
