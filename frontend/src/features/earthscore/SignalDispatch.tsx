import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowLeftRight,
  Lightbulb,
  Radio,
  ShieldCheck,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AnalysisResult } from "../../types/domain";
import { formatDate } from "../../utils/science";
import {
  buildSignalDispatch,
  type ScoreDataset,
  type ScoreSample,
} from "./model";

const beatIcons: Record<string, LucideIcon> = {
  reference: Radio,
  comparison: ArrowLeftRight,
  change: Activity,
  footprint: Waves,
  hypothesis: Lightbulb,
  limit: ShieldCheck,
};

export function SignalDispatch({
  result,
  dataset,
  selected,
  regionSamples,
  placeName,
}: {
  result: AnalysisResult;
  dataset: ScoreDataset;
  selected: ScoreSample | undefined;
  regionSamples: ScoreSample[];
  placeName: string;
}) {
  const reduced = useReducedMotion(),
    beats = buildSignalDispatch(
      result,
      dataset,
      selected,
      regionSamples,
      placeName,
    ),
    observed = dataset.stages.filter((stage) => stage.kind === "observed"),
    derived = dataset.stages.find((stage) => stage.kind === "derived");

  return (
    <section
      className="earthscore-dispatch"
      aria-labelledby="earthscore-dispatch-title"
    >
      <header className="earthscore-dispatch-heading">
        <div>
          <span className="eyebrow">ANALYSIS CHANNEL / SOURCE-CHECKED</span>
          <h2 id="earthscore-dispatch-title">A signal, told in field notes.</h2>
          <p>
            {placeName} ·{" "}
            {result.metadata.frequency ?? "Frequency not reported"}
            {" / "}
            {result.metadata.polarization ?? "Polarization not reported"}
          </p>
        </div>
        <span className="earthscore-dispatch-status">
          <Radio size={13} /> ARCHIVE / SOURCE-LINKED
        </span>
      </header>
      <div className="earthscore-dispatch-layout">
        <aside
          className="earthscore-dispatch-track"
          aria-label="Observation timeline"
        >
          <span className="eyebrow">OBSERVATION TRACK</span>
          <ol>
            {observed.map((stage, index) => (
              <li key={stage.id}>
                <time dateTime={stage.date}>{formatDate(stage.date)}</time>
                <small>
                  {index === 0 ? "REFERENCE PASS" : "ACTUAL ACQUISITION"}
                </small>
              </li>
            ))}
            {derived && (
              <li key={derived.id} data-derived="true">
                <time dateTime={derived.date}>{formatDate(derived.date)}</time>
                <small>DERIVED INTERVAL · NOT A PASS</small>
              </li>
            )}
            {!observed.length && (
              <li>
                <small>NO DATED ACQUISITIONS REPORTED</small>
              </li>
            )}
          </ol>
          <p>
            Each date is from the result metadata. The derived interval is not
            another satellite acquisition.
          </p>
        </aside>
        <ol className="earthscore-dispatch-messages" aria-label="Field notes">
          {beats.map((beat, index) => {
            const Icon = beatIcons[beat.id] ?? Radio;
            return (
              <motion.li
                className="earthscore-dispatch-message"
                data-kind={beat.id}
                key={beat.id}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: reduced ? 0 : 0.28,
                  delay: reduced ? 0 : Math.min(index * 0.065, 0.3),
                }}
              >
                <span className="earthscore-dispatch-stamp">
                  {beat.date ? formatDate(beat.date) : beat.label}
                </span>
                <article className="earthscore-dispatch-bubble">
                  <span className="earthscore-dispatch-speaker">
                    <Icon size={12} />
                    {beat.id === "hypothesis"
                      ? "RESEARCH LEAD"
                      : beat.id === "limit"
                        ? "EVIDENCE CHECK"
                        : "FLAGWA FIELD DESK"}
                  </span>
                  <h3>{beat.title}</h3>
                  <p>{beat.body}</p>
                  {beat.value && (
                    <span className="earthscore-dispatch-value">
                      {beat.value}
                    </span>
                  )}
                </article>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
