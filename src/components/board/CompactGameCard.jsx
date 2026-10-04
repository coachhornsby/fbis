import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStars } from "../../lib/confidenceStars.js";

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(Math.abs(n % 1) > 0.001 ? 1 : 0);
}

function Stars({ value = 1 }) {
  const safe = Math.max(1, Math.min(5, Number(value) || 1));
  return (
    <span className="cgc-star-row" aria-label={`${safe} of 5 confidence stars`}>
      <span aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < safe ? "filled" : "empty"}>★</span>
        ))}
      </span>
      <b>{safe}/5</b>
    </span>
  );
}

function bestEdge(vm) {
  const cmp = vm.comparison || {};
  const spread = Number(cmp.sideDiff);
  const total = Number(cmp.totalDiff);
  const spreadAbs = Number.isFinite(spread) ? Math.abs(spread) : -1;
  const totalAbs = Number.isFinite(total) ? Math.abs(total) : -1;

  if (spreadAbs < 0 && totalAbs < 0) {
    return { value: "—", detail: "NO EDGE", type: "EDGE", team: null, total: false };
  }
  if (spreadAbs >= totalAbs) {
    return {
      value: `+${fmt(spreadAbs)}`,
      detail: cmp.fbisSide?.label || "SPREAD",
      type: "SPREAD",
      team: cmp.fbisSide?.team || null,
      total: false,
    };
  }
  return {
    value: `${total > 0 ? "+" : ""}${fmt(total)}`,
    detail: total > 0 ? "OVER" : total < 0 ? "UNDER" : "TOTAL",
    type: "TOTAL",
    team: null,
    total: true,
  };
}

export default function CompactGameCard({ game, onOpen }) {
  const vm = buildGameCardViewModel(game);
  const stars = confidenceStars(game);
  const away = vm.away || {};
  const home = vm.home || {};
  const proj = vm.projection || {};
  const market = vm.market || {};
  const edge = bestEdge(vm);
  const soccerPick = String(vm.sport || game?.sport || "").toLowerCase() === "soccer"
    ? (game?.soccerConfidence || game?.confidencePick || game?.soccerFbis?.confidencePick || null)
    : null;
  const soccerPickTeam = soccerPick?.side === "HOME" ? home : soccerPick?.side === "AWAY" ? away : null;

  return (
    <article
      className="cgc pgc"
      data-game-id={vm.id || game?.id || ""}
      data-sport={vm.sport || ""}
      tabIndex={0}
      role="button"
      onClick={() => onOpen?.(game)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen?.(game);
        }
      }}
      aria-label={`Open ${away.abbr || "away"} at ${home.abbr || "home"} analysis`}
    >
      <header className="cgc-head">
        <div className="cgc-head-left">
          <span className="cgc-sport-pill">{String(vm.sport || "").toUpperCase()}</span>
          <span className="cgc-time">{vm.timing?.timeLine || "—"}</span>
        </div>
        <div className="cgc-head-right">
          <Stars value={stars} />
          <span className={`cgc-status cgc-status-${String(vm.status?.tone || "neutral").toLowerCase()}`}>
            {vm.status?.label || "FBIS"}
          </span>
        </div>
      </header>

      <div className="cgc-main">
        <div className="cgc-matchup">
          <div className="cgc-team-block">
            <TeamLogo team={away} size={66} className="cgc-logo" />
            <strong className="cgc-abbr">{away.abbr || "—"}</strong>
            <span className="cgc-team-name">{away.fullName || away.name || away.abbr || "—"}</span>
            <strong className="cgc-proj">{proj.available ? (proj.away ?? "—") : "—"}</strong>
            <span>FBIS SCORE</span>
          </div>

          <span className="cgc-vs">VS</span>

          <div className="cgc-team-block">
            <TeamLogo team={home} size={66} className="cgc-logo" />
            <strong className="cgc-abbr">{home.abbr || "—"}</strong>
            <span className="cgc-team-name">{home.fullName || home.name || home.abbr || "—"}</span>
            <strong className="cgc-proj">{proj.available ? (proj.home ?? "—") : "—"}</strong>
            <span>FBIS SCORE</span>
          </div>
        </div>

        <aside className={`cgc-best-edge${soccerPick ? " is-side" : edge.total ? " is-total" : " is-side"}`}>
          <span>{soccerPick ? "CONFIDENCE PICK" : "BEST EDGE"}</span>
          <div className="cgc-edge-identity">
            {soccerPick ? (
              soccerPickTeam ? <TeamLogo team={soccerPickTeam} size={42} className="cgc-edge-logo" /> : <div className="cgc-total-mark">DRAW</div>
            ) : edge.team ? (
              <TeamLogo team={edge.team} size={42} className="cgc-edge-logo" />
            ) : edge.total ? (
              <div className="cgc-total-mark">TOTAL</div>
            ) : null}
          </div>
          <strong>{soccerPick ? `${soccerPick.stars || stars}★` : edge.value}</strong>
          <b>{soccerPick ? soccerPick.pick || "—" : edge.detail}</b>
          <small>{soccerPick ? "1X2 · MODEL CONFIDENCE" : edge.type}</small>
        </aside>
      </div>

      <div className="cgc-market-strip" aria-label="FBIS and market comparison">
        <div className="cgc-market-item">
          <span>MARKET SPREAD</span>
          <strong>{market.spreadLabel || "—"}</strong>
        </div>
        <div className="cgc-market-divider" aria-hidden="true" />
        <div className="cgc-market-item cgc-market-item-fbis">
          <span>FBIS TOTAL</span>
          <strong>{proj.total ?? "—"}</strong>
        </div>
        <div className="cgc-market-divider" aria-hidden="true" />
        <div className="cgc-market-item">
          <span>MARKET TOTAL</span>
          <strong>{market.total ?? "—"}</strong>
        </div>
      </div>

      <footer className="cgc-footer">
        <div className="cgc-footer-metric">
          <strong>{game?.modelVersion || vm?.projection?.modelId || "FBIS"}</strong>
          <span>MODEL</span>
        </div>
        <div className="cgc-footer-metric">
          <strong>{vm.comparison?.sideDiffLabel || vm.comparison?.totalDiffLabel || "—"}</strong>
          <span>MODEL / MARKET GAP</span>
        </div>
        <span className="cgc-view">VIEW <b>→</b></span>
      </footer>
    </article>
  );
}
