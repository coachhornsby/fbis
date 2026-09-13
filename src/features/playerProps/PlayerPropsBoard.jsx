import { useMemo, useState } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import DecisionChip from "../today/DecisionChip.jsx";
import { fmtLine, fmtPrice } from "../today/formatters.js";
import {
  FBIS_PLAYER_MARKETS,
  buildPlayerPropsBoard,
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
      <section className="panel">
        <div className="panel-header">
          <h2>PLAYER PROPS</h2>
          <span className="last-updated">
            {loading
              ? "Loading…"
              : `${filteredRows.length} markets · ${propsBoard.counts.eventsWithProps} events`}
          </span>
        </div>
        <div className="panel-body">
          <p className="props-banner">
            RESEARCH · MODEL NOT AUTHORIZED — Action props stay shadow. FBIS will not imply a
            wager.
          </p>
          {error ? <div className="error">{error}</div> : null}
          <div className="props-controls">
            <label className="props-toggle">
              <input
                type="checkbox"
                checked={supportedOnly}
                onChange={(e) => setSupportedOnly(e.target.checked)}
              />
              FBIS-supported markets only
            </label>
            <div className="filter-row" role="toolbar" aria-label="Market filter">
              <button
                type="button"
                className={marketFilter === "all" ? "chip active" : "chip"}
                onClick={() => setMarketFilter("all")}
              >
                All markets
              </button>
              {FBIS_PLAYER_MARKETS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={marketFilter === id ? "chip active" : "chip"}
                  onClick={() => setMarketFilter(id)}
                >
                  {id.replace(/_/g, " ")}
                  {propsBoard.counts.byMarket[id]
                    ? ` (${propsBoard.counts.byMarket[id]})`
                    : ""}
                </button>
              ))}
            </div>
            {onRetry ? (
              <button type="button" className="header-btn" onClick={onRetry} disabled={loading}>
                {loading ? "Retrying…" : "Retry"}
              </button>
            ) : null}
          </div>
          <p className="muted">
            Readiness: {propsBoard.readiness.classification}. Supported rows:{" "}
            {propsBoard.counts.supportedRows}. Unsupported novelty:{" "}
            {propsBoard.counts.unsupportedRows}. Decision-eligible:{" "}
            {propsBoard.counts.decisionEligible}.
          </p>
        </div>
      </section>

      {selected ? (
        <PlayerWorkspace player={selected} onClose={() => setSelectedKey(null)} />
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>PROP BOARD</h2>
          <span className="last-updated">{filteredRows.length} shown</span>
        </div>
        <div className="panel-body">
          {!filteredRows.length ? (
            <p className="today-empty">
              {loading
                ? "Loading player markets…"
                : "No player props meet the current criteria. FBIS is not forcing volume."}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="fbis-table props-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Market</th>
                    <th>Line</th>
                    <th>Best</th>
                    <th>Book</th>
                    <th>Matchup</th>
                    <th>Identity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, i) => {
                    const playerKey =
                      row.fbisPlayerId ||
                      row.providerPlayerId ||
                      `${row.playerName}|${row.team}|${row.eventId}`;
                    return (
                      <tr key={`${row.eventId}-${row.playerName}-${row.marketCanonical}-${i}`}>
                        <td>
                          <button
                            type="button"
                            className="props-player-btn"
                            onClick={() => setSelectedKey(playerKey)}
                          >
                            <TeamLogo
                              team={row.teamIdentity || { abbr: row.team, name: row.team }}
                              size={24}
                            />
                            <span>
                              <strong>{row.playerName || "—"}</strong>
                              <span className="muted props-sub">
                                {[row.team, row.position].filter(Boolean).join(" · ") || "—"}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td>
                          {row.marketCanonical || row.market || "—"}
                          {!row.supportedMarket ? (
                            <div className="muted">Unsupported novelty</div>
                          ) : null}
                        </td>
                        <td>{fmtLine(row.line)}</td>
                        <td>{fmtPrice(row.overOdds ?? row.price)}</td>
                        <td className="muted">{row.book || "—"}</td>
                        <td className="muted">
                          {row.matchup?.away || "—"} @ {row.matchup?.home || "—"}
                        </td>
                        <td className="muted">{row.playerIdentityConfidence || "—"}</td>
                        <td>
                          <DecisionChip
                            state={row.surfaceStatus || "RESEARCH"}
                            reasonCodes={row.reasonCodes}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
