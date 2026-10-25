import "./gameScoreDisplay.css";

/**
 * Same score hierarchy on compact and featured cards.
 * A current/final score is only rendered when supplied by the game feed;
 * the independent FBIS projection never substitutes for an actual score.
 */
export default function GameScoreDisplay({
  actualScore = null,
  projectedScore = null,
  hasProjection = false,
  live = false,
  final = false,
  variant = "compact",
}) {
  const phase = final ? "final" : live ? "live" : "pregame";
  const actualAvailable =
    (live || final) && actualScore !== null && actualScore !== undefined &&
    actualScore !== "" && Number.isFinite(Number(actualScore));
  const projectionAvailable =
    hasProjection && projectedScore !== null && projectedScore !== undefined &&
    projectedScore !== "";
  const primary = actualAvailable ? actualScore
    : projectionAvailable ? projectedScore : "—";
  const label = actualAvailable
    ? final ? "FINAL SCORE" : "LIVE SCORE"
    : "FBIS PROJECTED";
  return (
    <div className={`fbis-game-score fbis-game-score--${variant} fbis-game-score--${phase}${actualAvailable ? " is-actual" : ""}`}>
      <span className="fbis-game-score__label">
        {actualAvailable && live && !final ? <span className="fbis-game-score__live-dot" aria-hidden="true" /> : null}
        {label}
      </span>
      <strong className="fbis-game-score__primary">{primary}</strong>
      {actualAvailable && projectionAvailable ? (
        <div className="fbis-game-score__projection">
          <span>FBIS PROJ.</span>
          <strong>{projectedScore}</strong>
        </div>
      ) : null}
      {!actualAvailable && (live || final) ? (
        <small className="fbis-game-score__pending">
          {final ? "FINAL — SCORE NOT IN FEED" : "LIVE — SCORE PENDING"}
        </small>
      ) : null}
    </div>
  );
}
