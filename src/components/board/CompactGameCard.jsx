import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { confidenceStars } from "../../lib/confidenceStars.js";

function line(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) < 0.05) return "PK";
  const x = Math.round(n * 10) / 10;
  return x > 0 ? `+${x}` : String(x);
}

function edgeLabel(kind, vm) {
  const cmp = vm.comparison || {};
  if (kind === "total") {
    const d = Number(cmp.totalDiff);
    if (!Number.isFinite(d)) return "—";
    if (Math.abs(d) < 0.05) return "EVEN";
    return `${d > 0 ? "OVER" : "UNDER"} ${Math.abs(d).toFixed(1)}`;
  }
  const d = Number(cmp.sideDiff);
  if (!Number.isFinite(d)) return "—";
  const fbis = cmp.fbisSide?.abbr || "EDGE";
  return `${fbis} ${Math.abs(d).toFixed(1)}`;
}

export default function CompactGameCard({ game, onOpen }) {
  const vm = buildGameCardViewModel(game);
  const stars = confidenceStars(game);
  const away = vm.away || {};
  const home = vm.home || {};
  const cmp = vm.comparison || {};
  const proj = vm.projection || {};
  const market = vm.market || {};

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
        <span className="cgc-meta">{String(vm.sport || "").toUpperCase()} · {vm.timing?.timeLine || "—"}</span>
        <span className="cgc-stars" aria-label={`${stars} of 5 confidence stars`}>
          {"★".repeat(stars)}<span>{"☆".repeat(5 - stars)}</span>
        </span>
      </header>

      <div className="cgc-matchup">
        <div className="cgc-team">
          <TeamLogo team={away} size={46} />
          <strong>{away.abbr || "—"}</strong>
        </div>
        <span className="cgc-at">@</span>
        <div className="cgc-team">
          <TeamLogo team={home} size={46} />
          <strong>{home.abbr || "—"}</strong>
        </div>
      </div>

      <div className="cgc-score">
        <span>FBIS PROJECTED</span>
        <strong>{proj.available ? `${away.abbr} ${proj.away ?? "—"} · ${home.abbr} ${proj.home ?? "—"}` : "NO FBIS PROJECTION"}</strong>
      </div>

      <div className="cgc-market-table" role="table" aria-label="FBIS versus market">
        <div className="cgc-market-row cgc-market-head" role="row">
          <span />
          <span>FBIS</span>
          <span>MARKET</span>
          <span>EDGE</span>
        </div>
        <div className="cgc-market-row" role="row">
          <strong>SPREAD</strong>
          <span>{cmp.fbisSide?.label || "—"}</span>
          <span>{cmp.marketSide?.label || market.spreadLabel || "—"}</span>
          <b>{edgeLabel("spread", vm)}</b>
        </div>
        <div className="cgc-market-row" role="row">
          <strong>TOTAL</strong>
          <span>{proj.total ?? cmp.fbisTotal ?? "—"}</span>
          <span>{market.total ?? cmp.marketTotal ?? "—"}</span>
          <b>{edgeLabel("total", vm)}</b>
        </div>
      </div>

      <footer className="cgc-foot">
        <span className={vm.freshness?.stale ? "is-stale" : ""}>{vm.status?.label || "—"}{vm.footer?.asOfLabel ? ` · ${vm.footer.asOfLabel}` : ""}</span>
        <span className="cgc-open">Open Analysis →</span>
      </footer>
    </article>
  );
}
