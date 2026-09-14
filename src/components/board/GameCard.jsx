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
  marketImpliedScores,
  marketLines,
  mlbModelAgreement,
  modelQualityView,
  safeDisplayString,
  teamCardTitle,
} from "../../lib/boardDecision.js";
import { fmtAmerican, fmtNum } from "../../lib/format.js";
import { venueAtmosphereClass } from "../../lib/venueAtmosphere.js";
import { GameDetails } from "../../TodayView.jsx";

function fairSpreadTeamLine(proj, away, home) {
  if (!proj?.available) return null;
  const line = proj.fairHomeSpread;
  if (line == null) return null;
  if (Math.abs(line) < 0.05) return "PICK'EM";
  if (line < 0) return `${home?.abbr || "HOME"} ${formatSpreadLabel(line)}`;
  return `${away?.abbr || "AWAY"} ${formatSpreadLabel(-line)}`;
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
  const marketScores = marketImpliedScores(game);
  const pal = game.sport === "mlb" ? mlbModelAgreement(game) : { available: false };
  const detailsId = useId();
  const glow = glowClassForTier(decision.tier);
  const live = Boolean(game.status?.live);
  const done = Boolean(game.status?.completed);
  const awayStarter = starterLine(game, "away");
  const homeStarter = starterLine(game, "home");
  const isMlb = game?.sport === "mlb";
  const logoSize = isMlb ? "card" : "hero";
  const matchupClass = isMlb ? "gc-matchup-row" : "gc-matchup-row logo-stack";
  const venueLabel = safeDisplayString(game.venue, "");
  const statusDetail = safeDisplayString(game.status?.detail || game.status, "");
  const venueClass = venueAtmosphereClass(game?.sport);

  const toggleDetails = () => onToggle?.(game.id);

  return (
    <article
      className={`game-card ${glow} decision-tier-${decision.tier}${venueClass ? ` ${venueClass}` : ""}`}
      data-decision={decision.tier}
      data-misprice-state={decision.mispriceState || ""}
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
            {live || done ? statusDetail || when.timeLine : when.timeLine}
          </div>
        </div>
        <div className="gc-meta">
          <span className="gc-sport">{String(game.sport || "").toUpperCase()}</span>
          {venueLabel ? <span className="gc-venue" title={venueLabel}>{venueLabel}</span> : null}
        </div>
      </header>

      <div className={matchupClass} aria-label="Matchup">
        <div className="gc-side away">
          <TeamLogo team={game.away} size={logoSize} />
          <div className="gc-side-text">
            <span className="gc-team-name">{teamCardTitle(game.away)}</span>
            {game.away?.record ? <span className="gc-record muted">{safeDisplayString(game.away.record)}</span> : null}
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
            <span className="gc-team-name">{teamCardTitle(game.home)}</span>
            {game.home?.record ? <span className="gc-record muted">{safeDisplayString(game.home.record)}</span> : null}
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
            <div className="proj-blocked">NO PURE MODEL</div>
            <div className="muted">
              {decision.reason || game.cfb?.blockReason || "Independent FBIS projection unavailable"}
            </div>
            {marketScores?.available ? (
              <div className="proj-implied market-benchmark">
                <span className="muted">MARKET-IMPLIED SCORE / MARKET BENCHMARK</span>
                <strong>
                  {fmtNum(marketScores.away, 1)} – {fmtNum(marketScores.home, 1)}
                </strong>
              </div>
            ) : (game.marketProjAway ?? game.model?.marketProjAway) != null ? (
              <div className="proj-implied market-benchmark">
                <span className="muted">MARKET-IMPLIED SCORE / MARKET BENCHMARK</span>
                <strong>
                  {fmtNum(game.marketProjAway ?? game.model?.marketProjAway, 1)} –{" "}
                  {fmtNum(game.marketProjHome ?? game.model?.marketProjHome, 1)}
                </strong>
              </div>
            ) : null}
          </div>
        )}
        {(game.sport === "cfb" || game.sport === "cbb") && proj.available ? (
          <div className="gc-challenger">
            <ChallengerSelect game={game} championHome={proj.home} championAway={proj.away} />
          </div>
        ) : null}
      </section>

      <section className="gc-market" aria-label="Market benchmark">
        <div className="gc-section-label">MARKET · {mkt.book === "Pinnacle" || mkt.book === "Reference" ? (mkt.marketAvailable ? mkt.book : "REFERENCE ONLY") : mkt.book}{mkt.referenceOnly ? " (non-executable)" : ""}</div>
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

      {game.market?.reference?.available && (mkt.referenceOnly || mkt.book === "Reference" || !game.market?.marketAvailable) ? (
        <section className="gc-reference muted" aria-label="Reference market">
          <div className="gc-section-label">REFERENCE BENCHMARK · {game.market.reference.provider || "Pinnacle"}</div>
          <div className="gc-market-grid">
            <div>
              <span className="muted">Spread</span>
              <strong>{game.market.reference.spread == null ? "—" : `${game.home?.abbr || "HOME"} ${formatSpreadLabel(game.market.reference.spread)}`}</strong>
            </div>
            <div>
              <span className="muted">Total</span>
              <strong>{game.market.reference.total == null ? "—" : fmtNum(game.market.reference.total, 1)}</strong>
            </div>
            <div>
              <span className="muted">ML</span>
              <strong>
                {game.market.reference.moneyline?.away == null && game.market.reference.moneyline?.home == null
                  ? "—"
                  : `${fmtAmerican(game.market.reference.moneyline?.away)} / ${fmtAmerican(game.market.reference.moneyline?.home)}`}
              </strong>
            </div>
          </div>
          <div className="gc-action-footnote muted">Optional research benchmark · not required for board usability</div>
        </section>
      ) : null}

      {game.actionIntel ? (
        <section className="gc-action-intel" aria-label="ACTION market intelligence">
          <div className="gc-section-label">
            ACTION · RESEARCH
            <span className="gc-action-badge">SHADOW</span>
          </div>
          <div className="gc-action-grid">
            <div>
              <span className="muted">Cons. spread</span>
              <strong>
                {game.actionIntel.consensus?.spreadHome == null
                  ? "—"
                  : `${game.home?.abbr || "HOME"} ${formatSpreadLabel(game.actionIntel.consensus.spreadHome)}`}
              </strong>
            </div>
            <div>
              <span className="muted">Cons. total</span>
              <strong>
                {game.actionIntel.consensus?.total == null
                  ? "—"
                  : fmtNum(game.actionIntel.consensus.total, 1)}
              </strong>
            </div>
            <div>
              <span className="muted">Tickets</span>
              <strong>
                {game.actionIntel.publicSplits?.ticketPct == null
                  ? "—"
                  : `${fmtNum(game.actionIntel.publicSplits.ticketPct, 0)}%`}
              </strong>
            </div>
            <div>
              <span className="muted">Money</span>
              <strong>
                {game.actionIntel.publicSplits?.moneyPct == null
                  ? "—"
                  : `${fmtNum(game.actionIntel.publicSplits.moneyPct, 0)}%`}
              </strong>
            </div>
            <div>
              <span className="muted">$/ticket gap</span>
              <strong>
                {game.actionIntel.publicSplits?.moneyTicketGap == null
                  ? "—"
                  : `${game.actionIntel.publicSplits.moneyTicketGap > 0 ? "+" : ""}${fmtNum(
                      game.actionIntel.publicSplits.moneyTicketGap,
                      1
                    )}`}
              </strong>
            </div>
            <div>
              <span className="muted">Best book</span>
              <strong>{game.actionIntel.movement?.bestBook || "—"}</strong>
            </div>
          </div>
          <div className="gc-action-footnote muted">
            Display-only market intelligence · not odds authority · not qualify
          </div>
        </section>
      ) : null}

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
        <DecisionBadge tier={decision.tier} label={decision.label} pick={decision.pick} />
        {decision.mispriceState ? (
          <span className="gc-misprice-state muted">{String(decision.mispriceState).replace(/_/g, " ")}</span>
        ) : null}
        {decision.market ? <span className="gc-decision-market muted">{decision.market}</span> : null}
        {(game.rec?.softBenchmark || game.lean?.softBenchmark) ? (
          <span className="gc-soft-flag muted">{game.rec?.book || game.lean?.book || "DK/FD"}</span>
        ) : null}
        {decision.evPct != null && quality.hasPureModel ? (
          <span className={decision.evPct >= 0 ? "text-green" : "text-red"}>
            ROI {decision.evPct >= 0 ? "+" : ""}
            {fmtNum(decision.evPct, 1)}%
          </span>
        ) : null}
      </div>

      <section className="gc-quality" aria-label="Quality and data readiness">
        <div>
          <span className="muted">{quality.hasPureModel ? "MODEL QUALITY" : "MARKET / DATA QUALITY"}</span>
          <strong>
            {quality.hasPureModel
              ? (quality.modelQuality ?? quality.score) == null
                ? "—"
                : (quality.modelQuality ?? quality.score)
              : (quality.marketDataQuality ?? quality.score) == null
                ? "—"
                : (quality.marketDataQuality ?? quality.score)}
          </strong>
        </div>
        <div>
          <span className="muted">{quality.hasPureModel ? "UNCERTAINTY" : "MODEL STATUS"}</span>
          <strong className={quality.uncertainty === "HIGH" ? "text-yellow" : ""}>
            {quality.hasPureModel ? quality.uncertainty : "NO PURE MODEL"}
          </strong>
        </div>
        <div>
          <span className="muted">DATA STATE</span>
          <strong>{quality.dataState ?? "—"}</strong>
        </div>
      </section>
      <section className="gc-data-readiness muted" aria-label="Data readiness breakdown">
        <span>SPORT {quality.sportDataState || "—"}</span>
        <span>MARKET {quality.marketDataState || "—"}</span>
        <span>MODEL INPUTS {quality.modelInputsState || "—"}</span>
        <span>PROJECTION {quality.projectionState || "—"}</span>
      </section>
      <section className="gc-data-readiness muted" aria-label="Data readiness breakdown">
        <span>SPORT {quality.sportDataState}</span>
        <span>MARKET {quality.marketDataState}</span>
        <span>MODEL INPUTS {quality.modelInputsState}</span>
        <span>PROJECTION {quality.projectionState}</span>
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
            <span>MARKET BENCHMARK</span>
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
          disabled={!game.rec || decision.tier === "BLOCKED" || decision.tier === "NO_MODEL" || logged || done}
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
