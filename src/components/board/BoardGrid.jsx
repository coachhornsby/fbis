import { isFbsVsFbsGame } from "../../../functions/lib/cfbGameVisibility.js";
import { useEffect, useMemo, useState } from "react";
import { cfbBoardSeasonEvidence } from "../../lib/cfbBoardSeasonJoin.js";
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
  const [cfbSource, setCfbSource] = useState(null);
  const hasCfbGames = games.some(g => (g.sport || sport) === "cfb");

  // Read-only independent FBS statistics. One request per board mount, never
  // a per-card provider fanout and never fed into model/recommendation logic.
  useEffect(() => {
    if (!hasCfbGames) { setCfbSource(null); return; }
    const ac = new AbortController();
    setCfbSource(null);
    fetch("/api/cfb-intelligence", {signal:ac.signal})
      .then(async response => {
        if (!response.ok) throw Error("SDV source unavailable");
        return response.json();
      })
      .then(data => {if (!ac.signal.aborted) setCfbSource(data);})
      .catch(() => {if (!ac.signal.aborted) setCfbSource({ok:false});});
    return () => ac.abort();
  }, [hasCfbGames]);

  const sorted = useMemo(() => sortBoardGames(games.filter(isFbsVsFbsGame)
    .map(g => (g.sport || sport) === "cfb"
      ? {...g,cfbSeasonEvidence:cfbBoardSeasonEvidence({...g,sport:"cfb"},cfbSource)}
      : g)), [games,sport,cfbSource]);
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
    return <div className="empty">{sport === "tennis" ? "No verified Tennis cards available. Unverified event identities or projection provenance are withheld." : "No games on the board for this date."}</div>;
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
              <div
                key={key}
                role="listitem"
                className={open.has(key) ? "board-card-grid-item-open" : undefined}
              >
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
