import { Fragment, useMemo, useState } from "react";
import { buildBoardGameViewModel } from "../../lib/boardViewModel.js";
import { sortByConfidence } from "../../lib/confidenceStars.js";
import CompactGameCard from "./CompactGameCard.jsx";
import PremiumGameCard from "./PremiumGameCard.jsx";
import MatchupFactors from "./MatchupFactors.jsx";
import TopGameProps from "../../features/playerProps/TopGameProps.jsx";
import "./decisionBoard.css";

export function BoardSummaryStrip({ games = [] }) {
  const stats = useMemo(() => {
    let research = 0, watch = 0, qualified = 0, blocked = 0, live = 0, final = 0, withMarket = 0, pinnodds = 0;
    let cfbGames = 0, cfbdGames = 0, sdvGames = 0, sourceConflicts = 0, cfbWeek = null;
    for (const g of games || []) {
      const vm = buildBoardGameViewModel(g);
      if (vm.event?.final) final += 1;
      else if (vm.event?.live) live += 1;
      if (vm.authority?.research || vm.decision?.qualification === "RESEARCH_ONLY") research += 1;
      else if (vm.decision?.qualification === "WATCH") watch += 1;
      else if (vm.decision?.qualification === "QUALIFIED") qualified += 1;
      if (vm.decision?.dqState || vm.quality?.marketUnresolved) blocked += 1;
      if (vm.market?.available) withMarket += 1;
      if (Array.isArray(g?.pinnoddsResearch?.offers) && g.pinnoddsResearch.offers.length > 0) pinnodds += 1;
      if (String(g?.sport).toLowerCase() === "cfb") {
        cfbGames += 1;
        const source = g?.cfbDirectionalResearch;
        if (source?.cfbd?.available > 0) {
          cfbdGames += 1;
          cfbWeek = source.week ?? cfbWeek;
        }
        if (source?.sdv?.available > 0) sdvGames += 1;
        sourceConflicts += Number(source?.disagreements || 0);
      }
    }
    return { n: games.length, research, watch, qualified, blocked, live, final, withMarket, pinnodds,
      cfbGames, cfbdGames, sdvGames, sourceConflicts, cfbWeek };
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
        <div className="db-sum-tile db-sum-mkt"><strong>{stats.pinnodds}</strong><span>PIN CAPTURES</span></div>
        <div className="db-sum-tile db-sum-mkt"><strong>{stats.withMarket}</strong><span>EXEC MKT</span></div>
      </div>
      {stats.cfbGames ? <div className="db-cfb-source-strip" aria-label="College football data coverage">
        <span className={stats.cfbdGames === stats.cfbGames ? "is-covered" : "is-partial"}>
          CFBD{stats.cfbWeek != null ? ` WK${stats.cfbWeek}` : " WEEKLY"} <b>{stats.cfbdGames}/{stats.cfbGames}</b>
        </span>
        <span className={stats.sdvGames === stats.cfbGames ? "is-covered" : "is-partial"}>
          SDV 2026 <b>{stats.sdvGames}/{stats.cfbGames}</b>
        </span>
        <span className={stats.sourceConflicts ? "is-conflict" : ""}>
          SOURCE DISAGREEMENTS <b>{stats.sourceConflicts}</b>
        </span>
      </div> : null}
      <div className="db-legend"><span className="db-leg-fbis">● FBIS</span><span className="db-leg-mkt">● Market</span></div>
    </div>
  );
}

export default function DecisionBoard({ games = [], renderDetail }) {
  const [selected, setSelected] = useState(null);
  const ranked = useMemo(() => sortByConfidence(games).sort((a,b)=>Number(Boolean(a.tennisProjection?.researchFixture))-Number(Boolean(b.tennisProjection?.researchFixture))), [games]);

  if (!games.length) return <div className="empty">No games on this filter.</div>;

  if (selected) {
    return (
      <div className="decision-board db-game-page">
        <button type="button" className="db-back-btn" onClick={() => setSelected(null)}>← Back to Board</button>
        <PremiumGameCard game={selected} />
        {["nfl","mlb","nba","nhl","cfb","cbb","wnba","soccer","npb","kbo"].includes(String(selected?.sport || "").toLowerCase())
          ? <TopGameProps game={selected} />
          : null}
        <MatchupFactors game={selected} />
        {typeof renderDetail === "function" ? (
          <details className="db-full-analysis db-full-analysis-collapsed">
              <summary>Sources & model details</summary>
              <div className="db-full-analysis-body">{renderDetail(selected)}</div>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div className="decision-board">
      <BoardSummaryStrip games={ranked} />
      <div className="db-grid" role="list" aria-label="Decision board cards">
        {ranked.map((g,index) => {
          const isTennis = String(g?.sport || "").toLowerCase() === "tennis";
          return (
            <Fragment key={`${g.sport}:${g.id}`}>
            {isTennis&&index===0&&!g.tennisProjection?.researchFixture?<div className="tmc-official-separator" role="note">Verified official Tennis schedule · FBIS model research · No wager authority</div>:null}
            {g.tennisProjection?.researchFixture&&!ranked[index-1]?.tennisProjection?.researchFixture?<div className="tmc-research-separator" role="note">Independent Tennis research fixtures · Separate from verified scheduled events · No projection or wager authority</div>:null}
            <div role="listitem" className={isTennis ? "db-grid-item db-grid-item-tennis" : "db-grid-item"}>
              {isTennis
                ? <PremiumGameCard game={g} />
                : <CompactGameCard game={g} onOpen={setSelected} />}
            </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
