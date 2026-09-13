import { useMemo } from "react";
import { toDomainTodayBoard } from "../../../functions/lib/fbisDomain.js";
import TopGameOpportunities from "./TopGameOpportunities.jsx";
import TopPlayerProps from "./TopPlayerProps.jsx";
import MarketMovers from "./MarketMovers.jsx";
import WatchlistPanel from "./WatchlistPanel.jsx";

/**
 * Decision-first Today surfaces from the FBIS domain board.
 * Rebuilds locally so sport filter changes never invent rankings.
 */
export default function TodayCommandCenter({ board, sportFilter = "all", date }) {
  const domain = useMemo(() => {
    const games = Array.isArray(board?.games)
      ? board.games
      : (board?.groups || []).flatMap((g) => g.games || []);
    return toDomainTodayBoard(
      {
        date: board?.date || date,
        games: games.map(normalizeBoardGame),
        counts: board?.counts,
      },
      {
        sportFilter,
        date: board?.date || date,
        generatedAt: board?.domain?.generatedAt,
      },
    );
  }, [board, sportFilter, date]);

  return (
    <div className="today-command-center">
      <TopGameOpportunities events={domain.topGameOpportunities || []} />
      <div className="today-command-grid">
        <TopPlayerProps rows={domain.topPlayerProps || []} />
        <WatchlistPanel events={domain.watchlist || []} />
      </div>
      <MarketMovers events={domain.marketMovers || []} />
    </div>
  );
}

/** Map propConvictions → playerMarkets when upstream only has convictions. */
function normalizeBoardGame(game = {}) {
  if (Array.isArray(game.playerMarkets) && game.playerMarkets.length) return game;
  const convictions = game.propConvictions || [];
  if (!convictions.length) return game;
  return {
    ...game,
    playerMarkets: convictions.map((c) => ({
      playerName: c.playerName,
      team: c.team,
      position: c.position,
      market: c.marketLabel || c.market,
      marketCanonical: c.market,
      line: c.line,
      overOdds: c.price,
      book: c.book,
      decisionEligible: false,
      reasonCodes: ["PROP_CONVICTION_RESEARCH_ONLY"],
    })),
  };
}
