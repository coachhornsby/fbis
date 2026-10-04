import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStars } from "../../lib/confidenceStars.js";

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(Math.abs(n % 1) > 0.001 ? 1 : 0);
}

function bestEdge(vm) {
  const cmp = vm.comparison || {};
  const spread = Number(cmp.sideDiff);
  const total = Number(cmp.totalDiff);
  const spreadAbs = Number.isFinite(spread) ? Math.abs(spread) : -1;
  const totalAbs = Number.isFinite(total) ? Math.abs(total) : -1;

  if (spreadAbs < 0 && totalAbs < 0) {
    return { value: "—", detail: "NO EDGE", type: "EDGE" };
  }
  if (spreadAbs >= totalAbs) {
    return {
      value: `+${fmt(spreadAbs)}`,
      detail: cmp.fbisSide?.label || "SPREAD",
      type: "SPREAD",
    };
  }
  return {
    value: `${total > 0 ? "+" : ""}${fmt(total)}`,
    detail: total > 0 ? "OVER" : total < 0 ? "UNDER" : "TOTAL",
    type: "TOTAL",
  };
}

export default function CompactGameCard({ game, onOpen }) {
  const vm = buildGameCardViewModel(game);
  const stars = confidenceStars(game);
  const away = vm.away || {};
  const home = vm.home || {};
  const proj = vm.projection || {};
  const edge = bestEdge(vm);

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
        <span className="cgc-rating" aria-label={`${stars} of 5 confidence stars`}>
          <span aria-hidden="true">★</span> {stars}
        </span>
      </header>

      <div className="cgc-main">
        <div className="cgc-matchup">
          <div className="cgc-team-block">
            <TeamLogo team={away} size={66} className="cgc-logo" />
            <strong className="cgc-abbr">{away.abbr || "—"}</strong>
            <strong className="cgc-proj">{proj.available ? (proj.away ?? "—") : "—"}</strong>
            <span>PROJ. SCORE</span>
          </div>

          <span className="cgc-vs">VS</span>

          <div className="cgc-team-block">
            <TeamLogo team={home} size={66} className="cgc-logo" />
            <strong className="cgc-abbr">{home.abbr || "—"}</strong>
            <strong className="cgc-proj">{proj.available ? (proj.home ?? "—") : "—"}</strong>
            <span>PROJ. SCORE</span>
          </div>
        </div>

        <aside className="cgc-best-edge">
          <span>BEST EDGE</span>
          <strong>{edge.value}</strong>
          <b>{edge.detail}</b>
          <small>{edge.type}</small>
        </aside>
      </div>

      <footer className="cgc-footer">
        <div className="cgc-footer-metric">
          <strong>{stars}/5</strong>
          <span>CONFIDENCE</span>
        </div>
        <div className="cgc-footer-metric">
          <strong>{proj.total ?? "—"}</strong>
          <span>PROJ. TOTAL</span>
        </div>
        <span className="cgc-view">VIEW <b>→</b></span>
      </footer>
    </article>
  );
}
