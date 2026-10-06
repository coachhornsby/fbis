import { useMemo, useState } from "react";
import { buildBoardGameViewModel } from "../../lib/boardViewModel.js";
import { sortByConfidence } from "../../lib/confidenceStars.js";
import CompactGameCard from "./CompactGameCard.jsx";
import PremiumGameCard from "./PremiumGameCard.jsx";
import MatchupFactors from "./MatchupFactors.jsx";
import "./decisionBoard.css";

export function BoardSummaryStrip({ games = [] }) {
  const stats = useMemo(() => {
    let research = 0, watch = 0, qualified = 0, blocked = 0, live = 0, final = 0, withMarket = 0;
    for (const g of games || []) {
      const vm = buildBoardGameViewModel(g);
      if (vm.event?.final) final += 1;
      else if (vm.event?.live) live += 1;
      if (vm.authority?.research || vm.decision?.qualification === "RESEARCH_ONLY") research += 1;
      else if (vm.decision?.qualification === "WATCH") watch += 1;
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
        <div className="db-sum-tile"><strong>{stats.n}</strong><span>GAMES</span></div>
        {stats.research > 0 ? <div className="db-sum-tile db-sum-research"><strong>{stats.research}</strong><span>RESEARCH</span></div> : null}
        {stats.watch > 0 ? <div className="db-sum-tile db-sum-watch"><strong>{stats.watch}</strong><span>WATCH</span></div> : null}
        {stats.qualified > 0 ? <div className="db-sum-tile db-sum-qual"><strong>{stats.qualified}</strong><span>QUAL</span></div> : null}
        {stats.blocked > 0 ? <div className="db-sum-tile db-sum-block"><strong>{stats.blocked}</strong><span>BLOCK</span></div> : null}
        {stats.live > 0 ? <div className="db-sum-tile db-sum-live"><strong>{stats.live}</strong><span>LIVE</span></div> : null}
        {stats.final > 0 ? <div className="db-sum-tile db-sum-final"><strong>{stats.final}</strong><span>FINAL</span></div> : null}
        <div className="db-sum-tile db-sum-mkt"><strong>{stats.withMarket}</strong><span>MKT</span></div>
      </div>
      <div className="db-legend"><span className="db-leg-fbis">● FBIS</span><span className="db-leg-mkt">● Market</span></div>
    </div>
  );
}

export default function DecisionBoard({ games = [], renderDetail }) {
  const [selected, setSelected] = useState(null);
  const ranked = useMemo(() => sortByConfidence(games), [games]);

  if (!games.length) return <div className="empty">No games on this filter.</div>;

  if (selected) {
    return (
      <div className="decision-board db-game-page">
        <button type="button" className="db-back-btn" onClick={() => setSelected(null)}>← Back to Board</button>
        <PremiumGameCard game={selected} />
        <MatchupFactors game={selected} />
        {typeof renderDetail === "function" ? (
          String(selected?.sport || "").toLowerCase() === "nfl" ? (
            <details className="db-full-analysis db-full-analysis-collapsed">
              <summary>Advanced data & legacy diagnostics</summary>
              <div className="db-full-analysis-body">{renderDetail(selected)}</div>
            </details>
          ) : <div className="db-full-analysis">{renderDetail(selected)}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="decision-board">
      <BoardSummaryStrip games={ranked} />
      <div className="db-grid" role="list" aria-label="Decision board cards">
        {ranked.map((g) => {
          const isTennis = String(g?.sport || "").toLowerCase() === "tennis";
          return (
            <div key={`${g.sport}:${g.id}`} role="listitem" className={isTennis ? "db-grid-item db-grid-item-tennis" : "db-grid-item"}>
              {isTennis
                ? <PremiumGameCard game={g} />
                : <CompactGameCard game={g} onOpen={setSelected} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
