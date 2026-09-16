import { useEffect, useMemo, useState } from "react";
import TeamLogo from "../../components/TeamLogo.jsx";
import { fmtNum, fmtPrice } from "../today/formatters.js";
import {
  FBIS_PLAYER_MARKETS,
  MARKET_LABELS,
  buildPlayerPropsBoard,
  formatMarketLabel,
  groupPlayerPropRows,
  sortPropsByConviction,
} from "./buildPlayerPropsBoard.js";
import PlayerWorkspace from "./PlayerWorkspace.jsx";

const TIER_LABELS = Object.freeze({
  CONVICTION: "Conviction",
  STRONG: "Strong",
  LEAN: "Lean",
  WATCH: "Watch",
  NONE: "No FBIS read",
});

const PRO_SPORTS = new Set(["mlb", "nfl", "nba", "nhl"]);

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

function PlayerAvatar({ row, size = 54 }) {
  const [failed, setFailed] = useState(false);
  if (row?.imageUrl && !failed) {
    return (
      <img
        src={row.imageUrl}
        alt={row.playerName || "Player headshot"}
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          objectFit: "cover",
          objectPosition: "center top",
          borderRadius: "50%",
          flex: "0 0 auto",
          background: "rgba(255,255,255,.06)",
        }}
      />
    );
  }
  return (
    <TeamLogo
      team={row?.teamIdentity || { abbr: row?.team, name: row?.team }}
      size={Math.min(size, 34)}
    />
  );
}

function rawBoardGames(board = {}) {
  if (Array.isArray(board?.games)) return board.games;
  return (board?.groups || []).flatMap((group) => group.games || []);
}

function mergeDurableProps(board = {}, rows = []) {
  if (!rows.length) return board || {};
  const games = rawBoardGames(board);
  const byEvent = new Map();
  for (const row of rows) {
    const id = String(row?.fbisEventId || row?.eventId || "");
    if (!id) continue;
    if (!byEvent.has(id)) byEvent.set(id, []);
    byEvent.get(id).push(row);
  }
  const mergedGames = games.map((game) => {
    const id = String(game?.id || game?.eventId || game?.gameId || "");
    const durable = byEvent.get(id) || [];
    if (!durable.length) return game;
    return {
      ...game,
      // Durable ACTION observations are the board read source. Legacy
      // propConvictions remain a fallback only when no durable rows exist.
      playerMarkets: durable,
    };
  });
  return { ...board, games: mergedGames };
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
  const [durableRows, setDurableRows] = useState([]);
  const [durableLoading, setDurableLoading] = useState(false);
  const [durableError, setDurableError] = useState("");
  const [diagnostics, setDiagnostics] = useState(null);

  const eventIds = useMemo(
    () =>
      [...new Set(
        rawBoardGames(board)
          .filter((game) => PRO_SPORTS.has(String(game?.sport || "").toLowerCase()))
          .map((game) => String(game?.id || game?.eventId || game?.gameId || "").trim())
          .filter(Boolean),
      )],
    [board],
  );

  useEffect(() => {
    let cancelled = false;
    const filter = String(sportFilter || "all").toLowerCase();
    if ((filter !== "all" && !PRO_SPORTS.has(filter)) || !eventIds.length) {
      setDurableRows([]);
      setDiagnostics(null);
      setDurableError("");
      setDurableLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const params = new URLSearchParams({ eventIds: eventIds.join(",") });
    if (filter !== "all") params.set("sport", filter);
    setDurableLoading(true);
    setDurableError("");
    fetch(`/api/player-props?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.ok === false) {
          throw new Error(payload?.error || `Player props request failed (${response.status})`);
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setDurableRows(Array.isArray(payload?.rows) ? payload.rows : []);
        setDiagnostics(payload?.diagnostics || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setDurableRows([]);
        setDiagnostics(null);
        setDurableError(String(err?.message || err));
      })
      .finally(() => {
        if (!cancelled) setDurableLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventIds, sportFilter]);

  const boardWithProps = useMemo(
    () => mergeDurableProps(board || { date, games: [] }, durableRows),
    [board, date, durableRows],
  );

  const propsBoard = useMemo(
    () =>
      buildPlayerPropsBoard(boardWithProps, {
        sportFilter: "all",
        date,
        supportedOnly: false,
      }),
    [boardWithProps, date],
  );

  const filteredRows = useMemo(() => {
    let rows = propsBoard.allRows || propsBoard.rows || [];
    if (sportFilter && sportFilter !== "all") {
      rows = rows.filter(
        (r) => String(r.sport || "").toLowerCase() === String(sportFilter).toLowerCase(),
      );
    }
    if (supportedOnly) rows = rows.filter((r) => r.supportedMarket);
    if (marketFilter !== "all") {
      rows = rows.filter((r) => r.marketCanonical === marketFilter);
    }
    return sortPropsByConviction(rows);
  }, [propsBoard.allRows, propsBoard.rows, supportedOnly, marketFilter, sportFilter]);

  const availableMarkets = useMemo(() => {
    const set = new Set((propsBoard.allRows || []).map((row) => row.marketCanonical).filter(Boolean));
    return FBIS_PLAYER_MARKETS.filter((id) => set.has(id));
  }, [propsBoard.allRows]);

  const players = useMemo(() => groupPlayerPropRows(filteredRows), [filteredRows]);
  const selected = players.find((p) => p.key === selectedKey) || null;
  const busy = loading || durableLoading;

  return (
    <div className="main-content props-board">
      <header className="props-hero">
        <div className="props-hero-copy">
          <p className="props-kicker">Player props · Pro sports only</p>
          <h1>Board</h1>
          <p className="props-lede">
            MLB, NFL, NBA and NHL markets from durable ACTION observations. FBIS model reads are
            shown when available; market rows do not disappear when a projection is unavailable.
          </p>
        </div>
        <div className="props-hero-meta">
          <span>
            {busy
              ? "Loading…"
              : `${filteredRows.length} prop${filteredRows.length === 1 ? "" : "s"}`}
          </span>
          {onRetry ? (
            <button type="button" className="header-btn" onClick={onRetry} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}
      {durableError ? <div className="error">ACTION props: {durableError}</div> : null}

      <div className="props-filters" role="toolbar" aria-label="Filter props">
        <button
          type="button"
          className={marketFilter === "all" ? "props-pill active" : "props-pill"}
          onClick={() => setMarketFilter("all")}
        >
          Popular
        </button>
        {availableMarkets.map((id) => (
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
            {busy
              ? "Reading persisted ACTION player markets…"
              : diagnostics?.durableObservations > 0
                ? `ACTION stored ${diagnostics.durableObservations} observations, but none match the current pro-market filters.`
                : "No persisted ACTION player props are available for these games yet."}
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
            const leanMore = row.convictionLean === "MORE";
            const leanLess = row.convictionLean === "LESS";
            const tier = row.convictionTier || "NONE";
            const rank = i + 1;

            return (
              <article
                key={`${row.eventId}-${row.providerPlayerId || row.playerName}-${row.marketCanonical}-${row.book || "book"}-${i}`}
                className={`props-card props-tier-${tier}${
                  leanMore ? " props-lean-more" : leanLess ? " props-lean-less" : ""
                }`}
                role="listitem"
              >
                <div className="props-card-ribbon">
                  <span className={`props-tier-badge props-tier-badge-${tier}`}>
                    {rank <= 3 && tier !== "NONE" && tier !== "WATCH" ? `#${rank} · ` : ""}
                    {TIER_LABELS[tier] || tier}
                    {row.convictionLean ? ` · ${row.convictionLean}` : ""}
                  </span>
                  {row.leanProbability != null ? (
                    <span className="props-tier-prob">{fmtProb(row.leanProbability)}</span>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="props-card-top"
                  onClick={() => setSelectedKey(playerKey)}
                >
                  <div className="props-card-identity">
                    <PlayerAvatar row={row} size={54} />
                    <span className="props-card-teampos">
                      {teamAbbr}
                      {row.position ? ` · ${row.position}` : ""}
                    </span>
                  </div>
                  <h3 className="props-card-name">{row.playerName || "Player"}</h3>
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
