import { useMemo, useState } from "react";
import PremiumGameCard from "./PremiumGameCard.jsx";
import SlateToolbar from "./SlateToolbar.jsx";
import { filterBoardGames, sortBoardGames } from "../../lib/boardDecision.js";
import { GameDetails } from "../../TodayView.jsx";

export default function BoardGrid({
  sport,
  games = [],
  onLog,
  logged,
  detailMapper,
  weekControls = null,
  slateMeta = null,
  notice = null,
}) {
  const [filter, setFilter] = useState("ALL");
  const [hideBlocked, setHideBlocked] = useState(false);
  const [open, setOpen] = useState(() => new Set());

  const sorted = useMemo(() => sortBoardGames(games), [games]);
  const visible = useMemo(() => {
    let rows = filterBoardGames(sorted, filter);
    if (hideBlocked) rows = filterBoardGames(rows, "HIDE_BLOCKED");
    return rows;
  }, [sorted, filter, hideBlocked]);

  const toggle = (key) => {
    setOpen((before) => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!games.length) {
    return <div className="empty">No games on the board for this date.</div>;
  }

  return (
    <div className="board-intel">
      <SlateToolbar
        sport={sport}
        games={sorted}
        filter={filter}
        onFilterChange={setFilter}
        hideBlocked={hideBlocked}
        onHideBlockedChange={setHideBlocked}
        weekControls={weekControls}
        slateMeta={slateMeta}
      />
      {notice}
      {!visible.length ? (
        <div className="empty">No games match this decision filter.</div>
      ) : (
        <div className="board-card-grid" role="list">
          {visible.map((g) => {
            const key = `${g.sport || sport}:${g.id}`;
            return (
              <div key={key} role="listitem">
                <PremiumGameCard
                  game={g}
                  open={open.has(key)}
                  onToggle={toggle}
                  renderDetail={(game) => (
                    <GameDetails g={detailMapper ? detailMapper(game) : game} />
                  )}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
