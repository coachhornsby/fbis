import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStars } from "../../lib/confidenceStars.js";
import AdvancedGameDetail from "./AdvancedGameDetail.jsx";
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

function modelEdge(vm) {
  const cmp = vm.comparison || {};
  const spread = Number(cmp.sideDiff);
  const total = Number(cmp.totalDiff);
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
  const marketSideLabel = ["mlb","npb","kbo"].includes(sportId) ? "MARKET RUN LINE" : sportId === "nhl" ? "MARKET PUCK LINE" : sportId === "soccer" ? "MARKET SIDE" : "MARKET SPREAD";
  const isFinal = String(vm.status?.key || "").toUpperCase() === "FINAL" || Boolean(game?.status?.completed);
  const finalAway = game?.away?.score ?? away?.score ?? null;
  const finalHome = game?.home?.score ?? home?.score ?? null;
  const hasFinalScore = isFinal && finalAway != null && finalHome != null;

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

      {hasFinalScore ? (
        <section className="pgc-final-score" aria-label="Final score">
          <span>FINAL SCORE</span>
          <strong><b>{away.abbr}</b> {finalAway} <i>–</i> {finalHome} <b>{home.abbr}</b></strong>
          <small>Pregame FBIS projection preserved below</small>
        </section>
      ) : null}

      <section className="pgc-featured-matchup">
        <div className="pgc-featured-team">
          <TeamLogo team={away} size={82} className="pgc-featured-logo" />
          <div>
            <strong className="pgc-featured-name">{away.fullName || away.name || away.abbr || "—"}</strong>
            {away.record ? <span className="pgc-featured-record">{away.record}</span> : null}
            <b className="pgc-featured-score">{proj.available ? (proj.away ?? "—") : "—"}</b>
            <small>PROJ. SCORE</small>
          </div>
        </div>

        <div className="pgc-featured-center">
          <span className="pgc-vs">VS</span>
          <small>{soccerPick ? "Confidence Pick" : "Model Edge"}</small>
          <strong>{soccerPick ? soccerPick.pick || "—" : edge.value}</strong>
          <span className="pgc-edge-delta">{soccerPick ? `${soccerPick.stars || stars}★ · 1X2` : `${edge.delta} ${edge.type}`}</span>
        </div>

        <div className="pgc-featured-team pgc-featured-team-home">
          <TeamLogo team={home} size={82} className="pgc-featured-logo" />
          <div>
            <strong className="pgc-featured-name">{home.fullName || home.name || home.abbr || "—"}</strong>
            {home.record ? <span className="pgc-featured-record">{home.record}</span> : null}
            <b className="pgc-featured-score">{proj.available ? (proj.home ?? "—") : "—"}</b>
            <small>PROJ. SCORE</small>
          </div>
        </div>
      </section>

      <section className="pgc-nfl-market" aria-label="FBIS and market summary">
        <div><span>{marketSideLabel}</span><strong>{market.spreadLabel || cmp.marketSide?.label || "—"}</strong></div>
        <div><span>FBIS TOTAL</span><strong>{proj.total ?? "—"}</strong></div>
        <div><span>MARKET TOTAL</span><strong>{market.total ?? "—"}</strong></div>
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
