import { useMemo } from "react";
import { toDomainTodayBoard } from "../../../functions/lib/fbisDomain.js";
import { normalizeBoardGame } from "../playerProps/buildPlayerPropsBoard.js";
import TopGameOpportunities from "./TopGameOpportunities.jsx";
import TopPlayerProps from "./TopPlayerProps.jsx";
import MarketMovers from "./MarketMovers.jsx";
import WatchlistPanel from "./WatchlistPanel.jsx";

/**
 * Decision-first Today surfaces from the FBIS domain board.
 * Rebuilds locally so sport filter changes never invent rankings.
 */
export default function TodayCommandCenter({
  board,
  sportFilter = "all",
  onSportFilter,
  date,
}) {
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

  const totalGames =
    domain.counts?.events ??
    domain.counts?.games ??
    (Array.isArray(board?.games) ? board.games.length : null);

  return (
    <div className="today-command-center">
      <TopGameOpportunities
        events={domain.topGameOpportunities || []}
        sportFilter={sportFilter}
        onSportFilter={onSportFilter}
        totalGames={totalGames}
      />
      <div className="today-command-grid">
        <TopPlayerProps rows={domain.topPlayerProps || []} />
        <WatchlistPanel events={domain.watchlist || []} />
      </div>
      <MarketMovers events={domain.marketMovers || []} />
    </div>
  );
}
