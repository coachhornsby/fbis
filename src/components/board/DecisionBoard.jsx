import { useMemo, useState } from "react";
import { buildBoardGameViewModel } from "../../lib/boardViewModel.js";
import PremiumGameCard from "./PremiumGameCard.jsx";
import "./decisionBoard.css";

export function BoardSummaryStrip({ games = [] }) {
  const stats = useMemo(() => {
    let research = 0;
    let watch = 0;
    let qualified = 0;
    let blocked = 0;
    let live = 0;
    let final = 0;
    let withMarket = 0;
    for (const g of games || []) {
      const vm = buildBoardGameViewModel(g);
      if (vm.event?.final) final += 1;
      else if (vm.event?.live) live += 1;
      if (vm.authority?.research || vm.decision?.qualification === "RESEARCH_ONLY") {
        research += 1;
      } else if (vm.decision?.qualification === "WATCH") watch += 1;
      else if (vm.decision?.qualification === "QUALIFIED") qualified += 1;
      if (vm.decision?.dqState || vm.quality?.marketUnresolved) blocked += 1;
      if (vm.market?.available) withMarket += 1;
    }
    return { n: games.length, research, watch, qualified, blocked, live, final, withMarket };
  }, [games]);

  if (!stats.n) return null;

  return (
    <div className="db-summary" aria-label="Board summary">
      <div className="db-sum-tiles">
        <div className="db-sum-tile">
          <strong>{stats.n}</strong>
          <span>GAMES</span>
        </div>
        {stats.research > 0 ? (
          <div className="db-sum-tile db-sum-research">
            <strong>{stats.research}</strong>
            <span>RESEARCH</span>
          </div>
        ) : null}
        {stats.watch > 0 ? (
          <div className="db-sum-tile db-sum-watch">
            <strong>{stats.watch}</strong>
            <span>WATCH</span>
          </div>
        ) : null}
        {stats.qualified > 0 ? (
          <div className="db-sum-tile db-sum-qual">
            <strong>{stats.qualified}</strong>
            <span>QUAL</span>
          </div>
        ) : null}
        {stats.blocked > 0 ? (
          <div className="db-sum-tile db-sum-block">
            <strong>{stats.blocked}</strong>
            <span>BLOCK</span>
          </div>
        ) : null}
        {stats.live > 0 ? (
          <div className="db-sum-tile db-sum-live">
            <strong>{stats.live}</strong>
            <span>LIVE</span>
          </div>
        ) : null}
        {stats.final > 0 ? (
          <div className="db-sum-tile db-sum-final">
            <strong>{stats.final}</strong>
            <span>FINAL</span>
          </div>
        ) : null}
        <div className="db-sum-tile db-sum-mkt" title="Games with operational market">
          <strong>{stats.withMarket}</strong>
          <span>MKT</span>
        </div>
      </div>
      <div className="db-legend" title="Color legend">
        <span className="db-leg-fbis">● FBIS</span>
        <span className="db-leg-mkt">● Market</span>
      </div>
    </div>
  );
}

/**
 * Decision Board — premium game cards.
 * Presentation only: FBIS → Market → Difference → ACTION → Decision.
 */
export default function DecisionBoard({ games = [], renderDetail }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => {
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!games.length) {
    return <div className="empty">No games on this filter.</div>;
  }

  return (
    <div className="decision-board">
      <BoardSummaryStrip games={games} />
      <div className="db-grid" role="list" aria-label="Decision board cards">
        {games.map((g) => {
          const key = `${g.sport}:${g.id}`;
          const isOpen = open.has(key);
          return (
            <div
              key={key}
              role="listitem"
              className={`db-grid-item${isOpen ? " db-grid-item-open" : ""}`}
            >
              <PremiumGameCard
                game={g}
                open={isOpen}
                onToggle={toggle}
                renderDetail={renderDetail}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
