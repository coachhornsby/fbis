import { useMemo, useState } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import { fmtLine, fmtPrice } from "../today/formatters.js";
import {
  FBIS_PLAYER_MARKETS,
  MARKET_LABELS,
  buildPlayerPropsBoard,
  formatMarketLabel,
  groupPlayerPropRows,
} from "./buildPlayerPropsBoard.js";
import PlayerWorkspace from "./PlayerWorkspace.jsx";

export default function PlayerPropsBoard({
  board,
  sportFilter = "all",
  date,
  loading = false,
  error = "",
  onRetry,
}) {
  const [marketFilter, setMarketFilter] = useState("all");
  const [supportedOnly, setSupportedOnly] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);

  const propsBoard = useMemo(
    () =>
      buildPlayerPropsBoard(board, {
        sportFilter,
        date,
        supportedOnly: false,
      }),
    [board, sportFilter, date],
  );

  const filteredRows = useMemo(() => {
    let rows = propsBoard.allRows || propsBoard.rows || [];
    if (supportedOnly) rows = rows.filter((r) => r.supportedMarket);
    if (marketFilter !== "all") {
      rows = rows.filter((r) => r.marketCanonical === marketFilter);
    }
    return rows;
  }, [propsBoard.allRows, propsBoard.rows, supportedOnly, marketFilter]);

  const players = useMemo(() => groupPlayerPropRows(filteredRows), [filteredRows]);
  const selected = players.find((p) => p.key === selectedKey) || null;

  return (
    <div className="main-content props-board">
      <header className="props-hero">
        <div className="props-hero-copy">
          <p className="props-kicker">Player props</p>
          <h1>Today&apos;s board</h1>
          <p className="props-lede">
            Browse lines like a pick board. This is research only — FBIS does not place
            wagers from here.
          </p>
        </div>
        <div className="props-hero-meta">
          <span>
            {loading
              ? "Loading…"
              : `${filteredRows.length} prop${filteredRows.length === 1 ? "" : "s"}`}
          </span>
          {onRetry ? (
            <button type="button" className="header-btn" onClick={onRetry} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <div className="props-filters" role="toolbar" aria-label="Filter props">
        <button
          type="button"
          className={marketFilter === "all" ? "props-pill active" : "props-pill"}
          onClick={() => setMarketFilter("all")}
        >
          All
        </button>
        {FBIS_PLAYER_MARKETS.map((id) => (
          <button
            key={id}
            type="button"
            className={marketFilter === id ? "props-pill active" : "props-pill"}
            onClick={() => setMarketFilter(id)}
          >
            {MARKET_LABELS[id] || formatMarketLabel(id)}
            {propsBoard.counts.byMarket[id] ? (
              <span className="props-pill-count">{propsBoard.counts.byMarket[id]}</span>
            ) : null}
          </button>
        ))}
        <label className="props-toggle">
          <input
            type="checkbox"
            checked={supportedOnly}
            onChange={(e) => setSupportedOnly(e.target.checked)}
          />
          Core markets only
        </label>
      </div>

      {selected ? (
        <PlayerWorkspace player={selected} onClose={() => setSelectedKey(null)} />
      ) : null}

      {!filteredRows.length ? (
        <div className="props-empty">
          <h2>Nothing on the board yet</h2>
          <p>
            {loading
              ? "Pulling the latest player markets…"
              : "No player props match these filters. Try another market or refresh."}
          </p>
        </div>
      ) : (
        <div className="props-card-grid" role="list">
          {filteredRows.map((row, i) => {
            const playerKey =
              row.fbisPlayerId ||
              row.providerPlayerId ||
              `${row.playerName}|${row.team}|${row.eventId}`;
            const marketLabel = formatMarketLabel(row.marketCanonical || row.market);
            const initial = (row.playerName || "?").slice(0, 1).toUpperCase();
            const over = row.overOdds ?? (row.side === "over" ? row.price : null);
            const under = row.underOdds ?? (row.side === "under" ? row.price : null);
            return (
              <article
                key={`${row.eventId}-${row.playerName}-${row.marketCanonical}-${i}`}
                className="props-card"
                role="listitem"
              >
                <button
                  type="button"
                  className="props-card-player"
                  onClick={() => setSelectedKey(playerKey)}
                >
                  <span className="props-avatar" aria-hidden="true">
                    {row.imageUrl ? <img src={row.imageUrl} alt="" /> : initial}
                  </span>
                  <TeamLogo
                    team={row.teamIdentity || { abbr: row.team, name: row.team }}
                    size={22}
                  />
                  <span className="props-card-player-text">
                    <strong>{row.playerName || "Unknown"}</strong>
                    <span className="muted">
                      {[row.team, row.position].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                </button>

                <p className="props-card-matchup muted">
                  {row.matchup?.away || "—"} @ {row.matchup?.home || "—"}
                </p>

                <p className="props-card-market">{marketLabel}</p>
                <p className="props-card-line">{fmtLine(row.line)}</p>

                <div className="props-more-less" aria-label={`${marketLabel} line sides`}>
                  <div className="props-side">
                    <span className="props-side-label">More</span>
                    <span className="props-side-price">{fmtPrice(over)}</span>
                  </div>
                  <div className="props-side">
                    <span className="props-side-label">Less</span>
                    <span className="props-side-price">{fmtPrice(under)}</span>
                  </div>
                </div>

                <div className="props-card-footer muted">
                  <span>{row.book ? String(row.book) : "Best available"}</span>
                  {!row.supportedMarket ? <span>Other market</span> : <span>Research</span>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
