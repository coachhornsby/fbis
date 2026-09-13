import { useId } from "react";
import TeamLogo from "../TeamLogo.jsx";
import { ChallengerSelect } from "../ChallengerSelect.jsx";
import DecisionBadge from "./DecisionBadge.jsx";
import DeltaRail from "./DeltaRail.jsx";
import {
  boardDecision,
  favoriteFairLabel,
  fbisProjection,
  formatBoardDate,
  formatSpreadLabel,
  glowClassForTier,
  marketDeltas,
  marketLines,
  mlbModelAgreement,
  modelQualityView,
} from "../../lib/boardDecision.js";
import { fmtAmerican, fmtNum } from "../../lib/format.js";
import { GameDetails } from "../../TodayView.jsx";

function fairSpreadTeamLine(proj, away, home) {
  if (!proj?.available) return null;
  const line = proj.fairHomeSpread;
  if (line == null) return null;
  if (Math.abs(line) < 0.05) return "PICK'EM";
  if (line < 0) return `${home?.abbr || "HOME"} ${formatSpreadLabel(line)}`;
  return `${away?.abbr || "AWAY"} ${formatSpreadLabel(-line)}`;
}

function teamTitle(team) {
  return team?.fullName || team?.name || team?.school || team?.abbr || "Team";
}

function starterLine(game, side) {
  if (game?.sport !== "mlb") return null;
  const sp = side === "away" ? game.awaySp : game.homeSp;
  const era = side === "away" ? game.savant?.awaySpEra : game.savant?.homeSpEra;
  if (!sp?.name && era == null) return null;
  const name = sp?.last || sp?.name || "TBD";
  const eraTxt = era == null || Number.isNaN(Number(era)) ? null : `${Number(era).toFixed(2)} ERA`;
  const record = sp?.record || sp?.wL || null;
  return [name, record, eraTxt].filter(Boolean).join(" · ");
}

export default function GameCard({
  game,
  expanded = false,
  onToggle,
  onLog,
  logged = false,
  detailGame,
}) {
  const decision = boardDecision(game);
  const when = formatBoardDate(game.start);
  const proj = fbisProjection(game);
  const mkt = marketLines(game);
  const deltas = marketDeltas(game);
  const quality = modelQualityView(game);
  const pal = game.sport === "mlb" ? mlbModelAgreement(game) : { available: false };
  const detailsId = useId();
  const glow = glowClassForTier(decision.tier);
  const live = Boolean(game.status?.live);
  const done = Boolean(game.status?.completed);
  const awayStarter = starterLine(game, "away");
  const homeStarter = starterLine(game, "home");
  const isMlb = game?.sport === "mlb";
  const logoSize = isMlb ? 48 : 86;
  const matchupClass = isMlb ? "gc-matchup-row" : "gc-matchup-row logo-stack";

  const toggleDetails = () => onToggle?.(game.id);

  return (
    <article
      className={`game-card ${glow} decision-tier-${decision.tier}`}
      data-decision={decision.tier}
      data-game-id={game.id}
      data-sport={game.sport || ""}
    >
      <header className="gc-header">
        <div className="gc-when">
          <div className="gc-date">
            {when.isToday ? <span className="gc-today">TODAY</span> : null}
            <span>{when.dateLine}</span>
          </div>
          <div className="gc-time">
            {live ? <span className="live-dot" aria-hidden="true">●</span> : null}
            {live || done ? game.status?.detail || when.timeLine : when.timeLine}
          </div>
        </div>
        <div className="gc-meta">
          <span className="gc-sport">{String(game.sport || "").toUpperCase()}</span>
          {game.venue ? <span className="gc-venue" title={game.venue}>{game.venue}</span> : null}
        </div>
      </header>

      <div className={matchupClass} aria-label="Matchup">
        <div className="gc-side away">
          <TeamLogo team={game.away} size={logoSize} />
          <div className="gc-side-text">
            <span className="gc-team-name">{teamTitle(game.away)}</span>
            {game.away?.record ? <span className="gc-record muted">{game.away.record}</span> : null}
            {awayStarter ? <span className="gc-starter muted">{awayStarter}</span> : null}
          </div>
          {live || done ? (
            game.away?.score != null ? <span className="gc-live-score">{game.away.score}</span> : null
          ) : null}
        </div>
        <div className="gc-at" aria-hidden="true">@</div>
        <div className="gc-side home">
          <TeamLogo team={game.home} size={logoSize} />
          <div className="gc-side-text">
            <span className="gc-team-name">{teamTitle(game.home)}</span>
            {game.home?.record ? <span className="gc-record muted">{game.home.record}</span> : null}
            {homeStarter ? <span className="gc-starter muted">{homeStarter}</span> : null}
          </div>
          {live || done ? (
            game.home?.score != null ? <span className="gc-live-score">{game.home.score}</span> : null
          ) : null}
        </div>
      </div>

      <section className="gc-projection" aria-label="FBIS projection">
        <div className="gc-section-label">FBIS PROJECTION</div>
        {proj.available ? (
          <>
            <div className="gc-score-grid">
              <div>
                <span className="gc-score-team">{game.away?.abbr || "AWAY"}</span>
                <strong className="gc-score-num">{fmtNum(proj.away, 1)}</strong>
              </div>
              <div>
                <span className="gc-score-team">{game.home?.abbr || "HOME"}</span>
                <strong className="gc-score-num">{fmtNum(proj.home, 1)}</strong>
              </div>
            </div>
            <div className="gc-fair">
              <div>
                <span className="muted">FBIS FAIR</span>
                <strong>{fairSpreadTeamLine(proj, game.away, game.home)}</strong>
              </div>
              <div>
                <span className="muted">TOTAL</span>
                <strong>{fmtNum(proj.fairTotal, 1)}</strong>
              </div>
            </div>
          </>
        ) : (
          <div className="gc-proj-unavailable">
            {game.sport === "nfl" || game.projectionKind === "PINNACLE_IMPLIED" ? (
              <>
                <div className="muted">FBIS projection unavailable</div>
                {(game.marketProjAway ?? game.model?.marketProjAway) != null ? (
                  <div className="proj-implied">
                    PINNACLE IMPLIED {fmtNum(game.marketProjAway ?? game.model?.marketProjAway)} –{" "}
                    {fmtNum(game.marketProjHome ?? game.model?.marketProjHome)}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className="proj-blocked">PROJECTION BLOCKED</div>
                <div className="muted">{game.cfb?.blockReason || "Team-specific inputs missing"}</div>
              </>
            )}
          </div>
        )}
        {(game.sport === "cfb" || game.sport === "cbb") && proj.available ? (
          <div className="gc-challenger">
            <ChallengerSelect game={game} championHome={proj.home} championAway={proj.away} />
          </div>
        ) : null}
      </section>

      <section className="gc-market" aria-label="Market benchmark">
        <div className="gc-section-label">MARKET · {mkt.book}</div>
        <div className="gc-market-grid">
          <div>
            <span className="muted">Spread</span>
            <strong>
              {mkt.spread == null
                ? "—"
                : `${game.home?.abbr || "HOME"} ${formatSpreadLabel(mkt.spread)}`}
            </strong>
          </div>
          <div>
            <span className="muted">Total</span>
            <strong>{mkt.total == null ? "—" : fmtNum(mkt.total, 1)}</strong>
          </div>
          <div>
            <span className="muted">ML</span>
            <strong>
              {mkt.awayMl == null && mkt.homeMl == null
                ? "—"
                : `${fmtAmerican(mkt.awayMl)} / ${fmtAmerican(mkt.homeMl)}`}
            </strong>
          </div>
        </div>
      </section>

      {(deltas.spreadDelta != null || deltas.totalDelta != null) && (
        <section className="gc-deltas" aria-label="Model market delta">
          <DeltaRail
            label="SPREAD DELTA"
            market={deltas.marketSpread}
            fbis={deltas.fairHomeSpread}
            delta={deltas.spreadDelta}
            kind="spread"
          />
          <DeltaRail
            label="TOTAL DELTA"
            market={deltas.marketTotal}
            fbis={deltas.fairTotal}
            delta={deltas.totalDelta}
            kind="total"
          />
        </section>
      )}

      <div className="gc-decision-row">
        <DecisionBadge tier={decision.tier} pick={decision.pick} />
        {decision.market ? <span className="gc-decision-market muted">{decision.market}</span> : null}
        {(game.rec?.softBenchmark || game.lean?.softBenchmark) ? (
          <span className="gc-soft-flag muted">{game.rec?.book || game.lean?.book || "DK/FD"}</span>
        ) : null}
        {decision.evPct != null ? (
          <span className={decision.evPct >= 0 ? "text-green" : "text-red"}>
            ROI {decision.evPct >= 0 ? "+" : ""}
            {fmtNum(decision.evPct, 1)}%
          </span>
        ) : null}
      </div>

      <section className="gc-quality" aria-label="Model quality">
        <div>
          <span className="muted">MODEL QUALITY</span>
          <strong>{quality.score == null ? "—" : quality.score}</strong>
        </div>
        <div>
          <span className="muted">UNCERTAINTY</span>
          <strong className={quality.uncertainty === "HIGH" ? "text-yellow" : ""}>{quality.uncertainty}</strong>
        </div>
        <div>
          <span className="muted">DATA STATE</span>
          <strong>{quality.dataState}</strong>
        </div>
      </section>

      {game.sport === "mlb" && pal.available ? (
        <section className="gc-mlb-stack" aria-label="MLB model separation">
          <div className="gc-mlb-row primary">
            <span>FBIS MODEL</span>
            <strong>
              {game.away?.abbr} {fmtNum(pal.fbisAway)} – {game.home?.abbr} {fmtNum(pal.fbisHome)}
            </strong>
          </div>
          <div className="gc-mlb-row crosscheck">
            <span>BALLPARK PAL</span>
            <strong>
              {game.away?.abbr} {fmtNum(pal.palAway)} – {game.home?.abbr} {fmtNum(pal.palHome)}
            </strong>
          </div>
          <div className="gc-mlb-row benchmark">
            <span>PINNACLE</span>
            <strong>
              {fmtAmerican(mkt.awayMl)} / {fmtAmerican(mkt.homeMl)}
              {mkt.total != null ? ` · Tot ${fmtNum(mkt.total, 1)}` : ""}
            </strong>
          </div>
          <div className="gc-mlb-agree">
            MODEL AGREEMENT <strong>{pal.agreement}</strong>
          </div>
        </section>
      ) : null}

      <div className="gc-actions">
        <button
          type="button"
          className="gc-details-btn"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDetails();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              toggleDetails();
            }
          }}
        >
          MODEL DETAILS {expanded ? "↑" : "↓"}
        </button>
        <button
          type="button"
          className="log-btn"
          disabled={!game.rec || decision.tier === "BLOCKED" || logged || done}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onLog?.(game);
          }}
        >
          {logged ? "LOGGED" : "LOG"}
        </button>
      </div>

      {expanded ? (
        <div className="gc-details" id={detailsId}>
          <GameDetails g={detailGame || game} />
          {quality.rawState ? (
            <div className="gc-raw-meta muted">
              Raw state: {quality.rawState}
              {game.model?.recipe?.engine ? ` · ${game.model.recipe.engine}` : ""}
              {game.modelVersion ? ` · ${game.modelVersion}` : ""}
              {favoriteFairLabel(proj, game.away?.abbr, game.home?.abbr)
                ? ` · fair ${favoriteFairLabel(proj, game.away?.abbr, game.home?.abbr)}`
                : ""}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
