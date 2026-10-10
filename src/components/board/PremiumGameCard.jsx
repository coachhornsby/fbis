import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStars } from "../../lib/confidenceStars.js";
import AdvancedGameDetail from "./AdvancedGameDetail.jsx";
import TennisMatchCard from "./TennisMatchCard.jsx";
import "./premiumGameCard.css";

function num(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const x = Math.round(n * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function signed(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const x = Math.round(n * 10) / 10;
  return `${x > 0 ? "+" : ""}${Number.isInteger(x) ? x : x.toFixed(1)}`;
}

function fmtOdds(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n > 1 && n < 10) {
    const american = n >= 2 ? Math.round((n - 1) * 100) : Math.round(-100 / (n - 1));
    return american > 0 ? `+${american}` : String(american);
  }
  const rounded = Math.round(n);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function fairAmerican(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return "—";
  const american = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
  const rounded = Math.round(american);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function tennisPlayerMeta(team, tour) {
  const rank = Number(team?.rank);
  const pts = Number(team?.rankingPoints);
  const rankLabel = Number.isFinite(rank) ? `${tour || "ATP/WTA"} #${Math.round(rank)}` : `${tour || "ATP/WTA"} UNRANKED`;
  const pointsLabel = Number.isFinite(pts) ? ` · ${Math.round(pts).toLocaleString()} pts` : "";
  return rankLabel + pointsLabel;
}

function modelEdge(vm) {
  const cmp = vm.comparison || {};
  const spread = cmp.sideDiff == null ? NaN : Number(cmp.sideDiff);
  const total = cmp.totalDiff == null ? NaN : Number(cmp.totalDiff);
  if (Number.isFinite(spread) && (!Number.isFinite(total) || Math.abs(spread) >= Math.abs(total))) {
    return {
      value: cmp.fbisSide?.label || signed(spread),
      delta: `+${num(Math.abs(spread))}`,
      type: "SPREAD",
    };
  }
  if (Number.isFinite(total)) {
    return {
      value: `${total > 0 ? "OVER" : total < 0 ? "UNDER" : "TOTAL"} ${vm.market?.total ?? "—"}`,
      delta: signed(total),
      type: "TOTAL",
    };
  }
  return { value: "—", delta: "—", type: "EDGE" };
}

function SharpStars({ value = 1 }) {
  const safe = Math.max(1, Math.min(5, Number(value) || 1));
  return <span className="pgc-sharp-stars" aria-label={`${safe} of 5 confidence stars`}>
    {Array.from({ length: 5 }, (_, i) => <svg key={i} className={i < safe ? "filled" : "empty"} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2l2.95 5.98 6.6.96-4.78 4.66 1.13 6.58L12 17.28l-5.9 3.1 1.13-6.58-4.78-4.66 6.6-.96L12 2.2z" /></svg>)}
  </span>;
}
function splitLabel(split, away, home) {
  if (!split) return "—";
  const a=Number(split.awayPct), h=Number(split.homePct);
  if(!Number.isFinite(a)||!Number.isFinite(h)) return "—";
  return `${away.abbr} ${Math.round(a)}% · ${home.abbr} ${Math.round(h)}%`;
}
function mlbStarterInfo(game, side) {
  const persistent = game?.mlbPersistentState?.[side === "home" ? "homeStarter" : "awayStarter"] || null;
  const raw = game?.[side === "home" ? "homeSp" : "awaySp"] || {};
  const era = persistent?.era ?? game?.savant?.[side === "home" ? "homeSpEra" : "awaySpEra"] ?? null;
  const id = raw?.id ?? persistent?.id ?? null;
  return {
    id,
    name: raw?.name || persistent?.name || null,
    wins: persistent?.wins ?? null,
    losses: persistent?.losses ?? null,
    era,
  };
}
function MlbStarterMini({ game, side }) {
  const sp = mlbStarterInfo(game, side);
  if (!sp.name && sp.era == null) return null;
  const record = sp.wins != null && sp.losses != null ? `${sp.wins}-${sp.losses}` : null;
  const era = Number.isFinite(Number(sp.era)) ? `${Number(sp.era).toFixed(2)} ERA` : null;
  const image = sp.id ? `https://img.mlbstatic.com/mlb-photos/image/upload/w_96,q_auto:best/v1/people/${sp.id}/headshot/67/current` : null;
  return <div className="pgc-mlb-starter">
    {image ? <img src={image} alt="" width="38" height="38" loading="lazy" referrerPolicy="no-referrer" /> : null}
    <div>
      <strong>{sp.name || "TBD"}</strong>
      <span>{[record, era].filter(Boolean).join(" · ") || "Starter"}</span>
    </div>
  </div>;
}

function MarketCell({ title, value, model, market, edge }) {
  return (
    <div className="pgc-market-cell">
      <span className="pgc-market-label">{title}</span>
      <strong>{value}</strong>
      <div className="pgc-market-lines">
        <span>Model: {model}</span>
        <span>Market: {market}</span>
      </div>
      {edge ? <em>{edge}</em> : null}
    </div>
  );
}

export default function PremiumGameCard({ game, open = false, onToggle, renderDetail = null }) {
  const vm = buildGameCardViewModel(game);
  if (!vm?.id && !game?.id) return null;

  const away = vm.away || {};
  const home = vm.home || {};
  const proj = vm.projection || {};
  const cmp = vm.comparison || {};
  const action = vm.action || {};
  const ctx = vm.context || {};
  const market = vm.market || {};
  const edge = modelEdge(vm);
  const stars = confidenceStars(game);
  const soccerPick = String(vm.sport || game?.sport || "").toLowerCase() === "soccer"
    ? (game?.soccerConfidence || game?.confidencePick || game?.soccerFbis?.confidencePick || null)
    : null;
  const cardKey = `${vm.sport || ""}:${vm.id || game?.id}`;
  const sportId = String(vm.sport || game?.sport || "").toLowerCase();
  const isNfl = sportId === "nfl";
  const isTennis = sportId === "tennis";
  if (isTennis) {
    return <TennisMatchCard game={game} open={open} onToggle={onToggle} renderDetail={renderDetail} />;
  }
  const marketSideLabel = ["mlb","npb","kbo"].includes(sportId) ? "MARKET RUN LINE" : sportId === "nhl" ? "MARKET PUCK LINE" : sportId === "soccer" ? "MARKET SIDE" : "MARKET SPREAD";
  const isFinal = String(vm.status?.key || "").toUpperCase() === "FINAL" || Boolean(game?.status?.completed);
  const finalAway = game?.away?.score ?? away?.score ?? null;
  const finalHome = game?.home?.score ?? home?.score ?? null;
  const hasFinalScore = isFinal && finalAway != null && finalHome != null;
  const tennis = game?.tennisProjection || {};
  const tennisTour = String(game?.tour || tennis.tour || "TENNIS").toUpperCase();
  const tennisRef = game?.market?.reference || {};
  const tennisAwayMl = market.awayMl ?? tennisRef?.moneyline?.away ?? null;
  const tennisHomeMl = market.homeMl ?? tennisRef?.moneyline?.home ?? null;
  const tennisSpread = tennisRef?.spread || null;
  const tennisTotal = tennisRef?.total || null;
  const tennisSpreadLabel = tennisSpread?.home == null && tennisSpread?.away == null
    ? "—"
    : `${away.abbr} ${signed(tennisSpread?.away)} (${fmtOdds(tennisSpread?.awayPrice)}) · ${home.abbr} ${signed(tennisSpread?.home)} (${fmtOdds(tennisSpread?.homePrice)})`;
  const tennisTotalLabel = tennisTotal?.line == null
    ? "—"
    : `O ${num(tennisTotal.line)} ${fmtOdds(tennisTotal.overPrice)} · U ${num(tennisTotal.line)} ${fmtOdds(tennisTotal.underPrice)}`;
  const tennisMarketP1 = Number(tennis.marketPriorP1 ?? tennisRef?.noVig?.home);
  const tennisPureP1 = Number(tennis.player1WinProb);
  const tennisProbEdge = Number.isFinite(tennisMarketP1) && Number.isFinite(tennisPureP1)
    ? (tennisPureP1 - tennisMarketP1) * 100
    : null;
  const tennisEdgeTeam = tennisProbEdge == null ? null : tennisProbEdge >= 0 ? home : away;
  const tennisEdgeValue = tennisProbEdge == null
    ? "RESEARCH"
    : `${tennisEdgeTeam?.abbr || "EDGE"} +${num(Math.abs(tennisProbEdge))}%`;
  const tennisEdgeDelta = tennisProbEdge == null ? "NO MARKET EDGE" : "MODEL vs NO-VIG";

  return (
    <article className={`pgc pgc-featured status-${String(vm.status?.tone || "neutral").toLowerCase()}`}>
      <header className="pgc-featured-head">
        <div className="pgc-featured-title">
          <span aria-hidden="true">🏆</span>
          <strong>Featured Matchup</strong>
        </div>
        <div className="pgc-featured-meta">
          <span>{[vm.timing?.dateLine, vm.timing?.timeLine].filter(Boolean).join(" · ") || "—"}</span>
          <span className="pgc-sport-pill">{String(vm.sport || "").toUpperCase()}</span>
          <SharpStars value={stars} />
        </div>
      </header>
      {sportId === "cfb" && proj.available ? (
        <div className="muted">{game.modelVersion || "CFB-FBIS-v2"} · {game.projectionState || game.cfb?.projectionState || "UNKNOWN"} · NO BETTING AUTHORITY</div>
      ) : null}

      {hasFinalScore ? (
        <section className="pgc-final-score" aria-label="Final score">
          <span>FINAL SCORE</span>
          <strong><b>{away.abbr}</b> {finalAway} <i>–</i> {finalHome} <b>{home.abbr}</b></strong>
          <small>Pregame FBIS projection preserved below</small>
        </section>
      ) : null}

      <section className="pgc-featured-matchup">
        <div className="pgc-featured-team">
          <div className="pgc-team-visual">
            <TeamLogo team={away} size={82} className="pgc-featured-logo" />
            {sportId === "mlb" ? <MlbStarterMini game={game} side="away" /> : null}
          </div>
          <div>
            <strong className="pgc-featured-name">{away.fullName || away.name || away.abbr || "—"}</strong>
            {isTennis ? <span className="pgc-tennis-meta">{tennisPlayerMeta(away, tennisTour)}</span> : null}
            {away.record ? <span className="pgc-featured-record">{away.record}</span> : null}
            <b className="pgc-featured-score">{proj.available ? (isTennis ? `${num(proj.away)}%` : (proj.away ?? "—")) : "—"}</b>
            <small>{isTennis ? "WIN PROB." : "PROJ. SCORE"}</small>
          </div>
        </div>

        <div className="pgc-featured-center">
          <span className="pgc-vs">VS</span>
          <small>{soccerPick ? "Confidence Pick" : "Model Edge"}</small>
          <strong>{soccerPick ? soccerPick.pick || "—" : isTennis ? tennisEdgeValue : edge.value}</strong>
          <span className="pgc-edge-delta">{soccerPick ? `${stars}★ · 1X2` : isTennis ? tennisEdgeDelta : `${edge.delta} ${edge.type}`}</span>
        </div>

        <div className="pgc-featured-team pgc-featured-team-home">
          <div className="pgc-team-visual">
            <TeamLogo team={home} size={82} className="pgc-featured-logo" />
            {sportId === "mlb" ? <MlbStarterMini game={game} side="home" /> : null}
          </div>
          <div>
            <strong className="pgc-featured-name">{home.fullName || home.name || home.abbr || "—"}</strong>
            {isTennis ? <span className="pgc-tennis-meta">{tennisPlayerMeta(home, tennisTour)}</span> : null}
            {home.record ? <span className="pgc-featured-record">{home.record}</span> : null}
            <b className="pgc-featured-score">{proj.available ? (isTennis ? `${num(proj.home)}%` : (proj.home ?? "—")) : "—"}</b>
            <small>{isTennis ? "WIN PROB." : "PROJ. SCORE"}</small>
          </div>
        </div>
      </section>

      <section className={`pgc-nfl-market${isTennis ? " pgc-tennis-market" : ""}`} aria-label="FBIS and market summary">
        {isTennis ? (
          <>
            <div><span>MARKET ML</span><strong>{tennisAwayMl == null && tennisHomeMl == null ? "—" : `${away.abbr} ${fmtOdds(tennisAwayMl)} · ${home.abbr} ${fmtOdds(tennisHomeMl)}`}</strong></div>
            <div><span>FBIS FAIR ML</span><strong>{proj.available ? `${away.abbr} ${fairAmerican((Number(proj.away) || 0) / 100)} · ${home.abbr} ${fairAmerican((Number(proj.home) || 0) / 100)}` : "—"}</strong></div>
            <div><span>GAME SPREAD</span><strong>{tennisSpreadLabel}</strong></div>
            <div><span>TOTAL GAMES</span><strong>{tennisTotalLabel}</strong></div>
            <div><span>SURFACE</span><strong>{[tennis.surface ? String(tennis.surface).toUpperCase() : null, tennis.indoor === true ? "INDOOR" : tennis.indoor === false ? "OUTDOOR" : null].filter(Boolean).join(" · ") || "—"}</strong></div>
            <div><span>EVENT</span><strong>{[tennisTour, tennis.tournament].filter(Boolean).join(" · ") || tennisTour}</strong></div>
          </>
        ) : (
          <>
            <div><span>{marketSideLabel}</span><strong>{market.spreadLabel || cmp.marketSide?.label || "—"}</strong></div>
            <div><span>FBIS TOTAL</span><strong>{proj.total ?? "—"}</strong></div>
            <div><span>MARKET TOTAL</span><strong>{market.total ?? "—"}</strong></div>
          </>
        )}
      </section>
      {true ? (
        <section className={`pgc-nfl-action${action.available ? "" : " is-unavailable"}`} aria-label="ACTION market intelligence">
          <div className="pgc-nfl-action-head"><strong>ACTION</strong><span>{action.headline?.label || (action.available ? "MARKET INTEL" : action.emptyLabel || "NO SNAPSHOT")}</span></div>
          <div><span>TICKETS</span><strong>{splitLabel(action.tickets, away, home)}</strong></div>
          <div><span>MONEY</span><strong>{splitLabel(action.money, away, home)}</strong></div>
          <div><span>LINE MOVE</span><strong>{action.lineMove?.label || action.movement?.label || "NO MOVE"}</strong></div>
        </section>
      ) : null}
      <footer className="pgc-footer pgc-featured-footer">
        <span>{vm.footer?.marketSourceLabel || "Market Source: —"}</span>
        {typeof onToggle === "function" ? (
          <button type="button" className="pgc-details-btn" onClick={() => onToggle(cardKey)}>
            {open ? "Hide Details" : "View Details"} →
          </button>
        ) : (
          <span className="pgc-status-note">{vm.status?.label || "—"}</span>
        )}
      </footer>

      {open ? (
        <div className="pgc-advanced">
          <AdvancedGameDetail game={game} onClose={() => onToggle?.(cardKey)} />
          {typeof renderDetail === "function" ? <div className="pgc-detail">{renderDetail(game)}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
