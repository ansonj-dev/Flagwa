import { qualityFor, stageValue } from "./model";
import type { ScoreSample, ScoreStage } from "./model";
export function audioEncoding(
  sample: ScoreSample,
  stage: ScoreStage,
  maximum: number,
  longitudeRange: [number, number],
) {
  if (!Number.isFinite(maximum) || maximum <= 0)
    throw new Error(
      "A positive, finite audio normalization maximum is required.",
    );
  const value = stageValue(sample, stage);
  const normalized =
    value === null ? null : Math.max(0, Math.min(1, Math.abs(value) / maximum));
  const [west, east] = longitudeRange;
  return {
    frequency: normalized === null ? null : 110 * 2 ** (3 * normalized),
    pan:
      sample.longitude === null || east <= west
        ? 0
        : Math.max(
            -1,
            Math.min(1, (2 * (sample.longitude - west)) / (east - west) - 1),
          ),
    uncertain: qualityFor(sample, stage) === "uncertain",
  };
}
export class EarthscoreAudio {
  context: AudioContext | null = null;
  master: GainNode | null = null;
  timer: ReturnType<typeof setInterval> | null = null;
  pump: (() => void) | null = null;
  nodes = new Set<OscillatorNode>();
  volume = 0.25;
  muted = false;
  async play(
    samples: ScoreSample[],
    stage: ScoreStage,
    maximum: number,
    speed: number,
    onSample: (id: string) => void,
    onEnd: () => void,
  ) {
    this.stop();
    if (typeof AudioContext === "undefined")
      throw new Error(
        "Web Audio is unavailable in this browser. All measurements remain available visually and as text.",
      );
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
    }
    await this.context.resume();
    this.setVolume(this.volume, this.muted);
    const context = this.context,
      longitudes = samples.flatMap((sample) =>
        sample.longitude === null ? [] : [sample.longitude],
      );
    const range: [number, number] = longitudes.length
      ? [Math.min(...longitudes), Math.max(...longitudes)]
      : [0, 0];
    let index = 0,
      nextTime = context.currentTime + 0.06;
    const interval = 0.18 / speed;
    const pump = () => {
      while (index < samples.length && nextTime <= context.currentTime + 0.15) {
        const sample = samples[index++],
          encoding = audioEncoding(sample, stage, maximum, range);
        onSample(sample.id);
        if (encoding.frequency !== null) {
          const fragments = encoding.uncertain ? [0, 0.065 / speed] : [0];
          for (const offset of fragments) {
            const oscillator = context.createOscillator(),
              gain = context.createGain(),
              pan = context.createStereoPanner();
            oscillator.type = "sine";
            oscillator.frequency.value = encoding.frequency;
            pan.pan.value = encoding.pan;
            const start = nextTime + offset,
              duration = (encoding.uncertain ? 0.045 : 0.13) / speed;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.07, start + 0.008);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            oscillator.connect(gain);
            gain.connect(pan);
            pan.connect(this.master!);
            this.nodes.add(oscillator);
            oscillator.onended = () => {
              this.nodes.delete(oscillator);
              oscillator.disconnect();
              gain.disconnect();
              pan.disconnect();
            };
            oscillator.start(start);
            oscillator.stop(start + duration + 0.01);
          }
        }
        nextTime += interval;
      }
      if (index >= samples.length && context.currentTime > nextTime + 0.2) {
        this.stop();
        onEnd();
      }
    };
    this.pump = pump;
    pump();
    this.timer = setInterval(pump, 40);
  }
  async pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.context?.state === "running") await this.context.suspend();
  }
  async resume() {
    if (this.context?.state === "suspended") await this.context.resume();
    if (this.pump && !this.timer) this.timer = setInterval(this.pump, 40);
  }
  setVolume(value: number, muted = this.muted) {
    this.volume = Math.max(0, Math.min(1, value));
    this.muted = muted;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        muted ? 0 : this.volume,
        this.context.currentTime,
        0.02,
      );
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pump = null;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {}
    }
    this.nodes.clear();
    if (this.context?.state === "running") void this.context.suspend();
  }
  dispose() {
    this.stop();
    if (this.context && this.context.state !== "closed")
      void this.context.close();
    this.context = null;
    this.master = null;
  }
}
