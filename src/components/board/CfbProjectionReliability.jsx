import { useState } from "react";
import "./cfbProjectionReliability.css";

/**
 * Expandable Projection Reliability section for CFB cards.
 * Preserves existing card styling; research display only.
 */
export default function CfbProjectionReliability({ reliability, game }) {
  const [open, setOpen] = useState(false);
  const block =
    reliability ||
    game?.cfbProjectionReliability ||
    game?.cfb?.projectionReliability ||
    null;
  if (!block?.available) return null;

  const games = block.currentSeasonGamesIncluded || {};
  const prior = block.priorSeasonContribution || {};
  const homeW =
    prior.homeCurrentWeight != null
      ? Math.round(prior.homeCurrentWeight * 100)
      : null;
  const awayW =
    prior.awayCurrentWeight != null
      ? Math.round(prior.awayCurrentWeight * 100)
      : null;

  return (
    <section className="cfb-proj-reliability" aria-label="Projection reliability">
      <button
        type="button"
        className="cfb-proj-reliability-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <strong>Projection Reliability</strong>
        <span className={block.provisional ? "is-provisional" : "is-supported"}>
          {block.provisional ? "PROVISIONAL" : "SUPPORTED"}
        </span>
        <span className="cfb-proj-reliability-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="cfb-proj-reliability-body">
          <p className="cfb-proj-reliability-status">{block.validationStatus}</p>
          <ul>
            <li>
              Current-season games: home {games.home ?? "—"} · away {games.away ?? "—"}
              {block.gamesPlayedUncertainty ? " (through-week fallback — not verified schedule count)" : ""}
            </li>
            <li>
              Offense PPA→pts: home {block.currentSeasonOffenseUsed?.homePpaPoints ?? "—"} · away{" "}
              {block.currentSeasonOffenseUsed?.awayPpaPoints ?? "—"}
            </li>
            <li>Through-week: {block.throughWeek ?? "—"}</li>
            <li>
              Current-season weight: home {homeW != null ? `${homeW}%` : "—"} · away{" "}
              {awayW != null ? `${awayW}%` : "—"}
            </li>
            <li>
              Source age: home {block.sourceDataAge?.home || "—"} · away {block.sourceDataAge?.away || "—"}
            </li>
            <li>
              Missing inputs:{" "}
              {(block.missingCriticalInputs || []).length
                ? block.missingCriticalInputs.join(", ")
                : "none flagged"}
            </li>
            <li>
              CORE:{" "}
              {block.coreAvailability?.home && block.coreAvailability?.away
                ? "present (research-only — not in fitted champion)"
                : "incomplete / unused by champion"}
            </li>
            <li>
              Model: {block.projectionModelVersion} · {block.modelConfidence}
            </li>
          </ul>
          {block.exceedsCurrentOffenseProfile ? (
            <p className="cfb-proj-reliability-warn" role="status">
              Projected home score ({block.exceedsCurrentOffenseEvidence?.projectedHome}) exceeds
              current-season PPA-implied offense ({block.exceedsCurrentOffenseEvidence?.currentOffensePpaPoints}
              ). Prior influence and fitted intercept may be elevating the projection.
            </p>
          ) : null}
          {block.provisional ? (
            <p className="cfb-proj-reliability-warn" role="status">
              Required current-season evidence is incomplete or uncertain — do not treat this as a fully
              supported forecast.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
