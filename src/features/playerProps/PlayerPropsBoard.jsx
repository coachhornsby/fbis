import { useMemo, useState } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import { mergeTodayQaFixtures } from "../../lib/boardFixtures.js";
import { fmtLine, fmtNum, fmtPrice } from "../today/formatters.js";
import {
  FBIS_PLAYER_MARKETS,
  MARKET_LABELS,
  buildPlayerPropsBoard,
  formatMarketLabel,
  groupPlayerPropRows,
} from "./buildPlayerPropsBoard.js";
import PlayerWorkspace from "./PlayerWorkspace.jsx";

function fmtProb(v) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const pct = n <= 1 ? n * 100 : n;
  return `${Math.round(pct)}%`;
}

function fmtPropLine(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return String(Number(v));
}

function fmtDelta(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  const body = Math.abs(n).toFixed(1);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return "0.0";
}

function matchupText(row) {
  const away = row.matchup?.away || "—";
  const home = row.matchup?.home || "—";
  const team = String(row.team || "").toUpperCase();
  if (team && team === String(home).toUpperCase()) return `vs ${away}`;
  if (team && team === String(away).toUpperCase()) return `@ ${home}`;
  return `${away} @ ${home}`;
}

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

  const boardWithQa = useMemo(
    () => mergeTodayQaFixtures(board || { date, games: [] }),
    [board, date],
  );

  const propsBoard = useMemo(
    () =>
      buildPlayerPropsBoard(boardWithQa, {
        sportFilter: "all",
        date,
        supportedOnly: false,
      }),
    [boardWithQa, date],
  );

  const filteredRows = useMemo(() => {
    let rows = propsBoard.allRows || propsBoard.rows || [];
    if (sportFilter && sportFilter !== "all") {
      rows = rows.filter(
        (r) => String(r.sport || "").toLowerCase() === String(sportFilter).toLowerCase(),
      );
    }
    if (!rows.length && (propsBoard.allRows || []).length) {
      rows = propsBoard.allRows || [];
    }
    if (supportedOnly) rows = rows.filter((r) => r.supportedMarket);
    if (marketFilter !== "all") {
      rows = rows.filter((r) => r.marketCanonical === marketFilter);
    }
    return rows;
  }, [propsBoard.allRows, propsBoard.rows, supportedOnly, marketFilter, sportFilter]);

  const players = useMemo(() => groupPlayerPropRows(filteredRows), [filteredRows]);
  const selected = players.find((p) => p.key === selectedKey) || null;

  return (
    <div className="main-content props-board">
      <header className="props-hero">
        <div className="props-hero-copy">
          <p className="props-kicker">Player props</p>
          <h1>Board</h1>
          <p className="props-lede">
            Market line vs FBIS projection. Research only — nothing is placed from here.
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
          Popular
        </button>
        {FBIS_PLAYER_MARKETS.map((id) => (
          <button
            key={id}
            type="button"
            className={marketFilter === id ? "props-pill active" : "props-pill"}
            onClick={() => setMarketFilter(id)}
          >
            {MARKET_LABELS[id] || formatMarketLabel(id)}
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
            const teamAbbr = row.teamIdentity?.abbr || row.team || "—";
            const over = row.overOdds ?? (row.side === "over" ? row.price : null);
            const under = row.underOdds ?? (row.side === "under" ? row.price : null);
            const leanMore =
              row.probabilityOver != null &&
              row.probabilityUnder != null &&
              row.probabilityOver > row.probabilityUnder;
            const leanLess =
              row.probabilityOver != null &&
              row.probabilityUnder != null &&
              row.probabilityUnder > row.probabilityOver;

            return (
              <article
                key={`${row.eventId}-${row.playerName}-${row.marketCanonical}-${i}`}
                className="props-card"
                role="listitem"
              >
                <button
                  type="button"
                  className="props-card-top"
                  onClick={() => setSelectedKey(playerKey)}
                >
                  <div className="props-card-identity">
                    <TeamLogo
                      team={row.teamIdentity || { abbr: row.team, name: row.team }}
                      size={28}
                    />
                    <span className="props-card-teampos">
                      {teamAbbr}
                      {row.position ? ` · ${row.position}` : ""}
                    </span>
                  </div>
                  <h3 className="props-card-name">{row.playerName || "Unknown"}</h3>
                  <p className="props-card-matchup">{matchupText(row)}</p>
                </button>

                <div className="props-card-line-row">
                  <span className="props-card-line">{fmtPropLine(row.line)}</span>
                  <span className="props-card-market">{marketLabel}</span>
                </div>

                <div className="props-fbis-panel" aria-label="FBIS projection">
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">FBIS proj</span>
                    <span className="props-fbis-value">
                      {row.fbisProjection == null ? "—" : fmtNum(row.fbisProjection, 1)}
                    </span>
                  </div>
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">vs line</span>
                    <span
                      className={`props-fbis-value${
                        row.projectionDelta > 0 ? " up" : row.projectionDelta < 0 ? " down" : ""
                      }`}
                    >
                      {fmtDelta(row.projectionDelta)}
                    </span>
                  </div>
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">P(More)</span>
                    <span className={`props-fbis-value${leanMore ? " up" : ""}`}>
                      {fmtProb(row.probabilityOver)}
                    </span>
                  </div>
                  <div className="props-fbis-metric">
                    <span className="props-fbis-label">P(Less)</span>
                    <span className={`props-fbis-value${leanLess ? " up" : ""}`}>
                      {fmtProb(row.probabilityUnder)}
                    </span>
                  </div>
                  {row.edge != null ? (
                    <div className="props-fbis-metric">
                      <span className="props-fbis-label">Edge</span>
                      <span className="props-fbis-value">
                        {fmtProb(Math.abs(Number(row.edge)) <= 1 ? row.edge : Number(row.edge) / 100)}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="props-more-less" aria-label={`${marketLabel} market prices`}>
                  <div className={`props-side${leanMore ? " lean" : ""}`}>
                    <span className="props-side-label">↑ More</span>
                    <span className="props-side-price">{fmtPrice(over)}</span>
                  </div>
                  <div className={`props-side${leanLess ? " lean" : ""}`}>
                    <span className="props-side-label">↓ Less</span>
                    <span className="props-side-price">{fmtPrice(under)}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
