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
  const cardKey = `${vm.sport || ""}:${vm.id || game?.id}`;

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
          <span className="pgc-rating">★ {stars}</span>
        </div>
      </header>

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
          <small>Model Edge</small>
          <strong>{edge.value}</strong>
          <span className="pgc-edge-delta">{edge.delta} {edge.type}</span>
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

      <section className="pgc-market-grid">
        <MarketCell
          title="SPREAD"
          value={cmp.fbisSide?.label || proj.spreadLabel || "—"}
          model={cmp.fbisSide?.label || proj.spreadLabel || "—"}
          market={cmp.marketSide?.label || market.spreadLabel || "—"}
          edge={Number.isFinite(Number(cmp.sideDiff)) ? `EDGE +${num(Math.abs(Number(cmp.sideDiff)))}` : null}
        />
        <MarketCell
          title="TOTAL"
          value={proj.total ?? "—"}
          model={proj.total ?? "—"}
          market={market.total ?? "—"}
          edge={Number.isFinite(Number(cmp.totalDiff)) ? `EDGE ${signed(cmp.totalDiff)}` : null}
        />
        <MarketCell
          title="MONEYLINE"
          value={market.awayMl != null ? `${away.abbr} ${signed(market.awayMl)}` : market.homeMl != null ? `${home.abbr} ${signed(market.homeMl)}` : "—"}
          model="—"
          market={market.awayMl != null ? `${away.abbr} ${signed(market.awayMl)} · ${home.abbr} ${signed(market.homeMl)}` : "—"}
        />
      </section>

      <section className="pgc-info-grid">
        <div className="pgc-info-card">
          <h3>▥ Model vs Market</h3>
          <div className="pgc-info-row"><span>Side Diff</span><strong>{cmp.sideDiffLabel || "—"}</strong></div>
          <div className="pgc-info-row"><span>Total Diff</span><strong>{cmp.totalDiffLabel || "—"}</strong></div>
          <div className="pgc-info-row"><span>Relationship</span><strong>{cmp.sideRelationshipLabel || "—"}</strong></div>
        </div>

        <div className="pgc-info-card">
          <h3>◎ Action Intel</h3>
          <div className="pgc-info-row"><span>Tickets</span><strong>{action.tickets?.label || "—"}</strong></div>
          <div className="pgc-info-row"><span>Money</span><strong>{action.money?.label || "—"}</strong></div>
          <div className="pgc-info-row"><span>Line Move</span><strong>{action.lineMove?.label || "—"}</strong></div>
        </div>

        <div className="pgc-info-card">
          <h3>☁ Game Environment</h3>
          <div className="pgc-info-row"><span>Venue</span><strong>{ctx.venueName || ctx.venueLabel || "—"}</strong></div>
          <div className="pgc-info-row"><span>Weather</span><strong>{ctx.weatherLine || "—"}</strong></div>
          <div className="pgc-info-row"><span>Status</span><strong>{vm.status?.label || "—"}</strong></div>
        </div>
      </section>

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
