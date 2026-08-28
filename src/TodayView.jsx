import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { fmtAmerican, fmtNum, fmtPct } from "./lib/format.js";
import { kickoffCt } from "../functions/lib/gameStatus.js";
import { TeamIdentity } from "./components/TeamLogo.jsx";
import { ChallengerSelect } from "./components/ChallengerSelect.jsx";

const FILTERS = [
  ["all", "All games"],
  ["scheduled", "Scheduled / pregame"],
  ["live", "Live"],
  ["final", "Final"],
  ["qualified", "Qualified"],
  ["leans", "Model leans"],
];

export default function TodayView({
  board,
  error,
  loading,
  date,
  onDate,
  sportFilter,
  onSportFilter,
  bucket,
  onBucket,
  onImport,
}) {
  const groups = board?.groups || [];
  const health = board?.health || {};
  const counts = board?.counts || {};
  const empty = board?.empty;
  const shown = (groups || []).map((g) => ({
    ...g,
    games: filterRows(g.games || [], sportFilter, bucket),
  })).filter((g) => (sportFilter === "all" || g.sport === sportFilter) && (g.games.length || g.error));

  return (
    <div className="main-content today-board">
      {error && <div className="panel"><div className="error">{error}</div></div>}

      <section className="panel">
        <div className="panel-header">
          <h2>TODAY · {date} CT</h2>
          <span className="last-updated">{loading ? "Loading…" : `${counts.games ?? 0} games`}</span>
        </div>
        <div className="panel-body">
          <div className="today-controls">
            <button className="header-btn" onClick={() => onDate(shift(date, -1))} aria-label="Previous day">← Prev</button>
            <input type="date" value={date} onChange={(e) => onDate(e.target.value)} />
            <button className="header-btn" onClick={() => onDate(shift(date, 1))} aria-label="Next day">Next →</button>
            <button className="header-btn" onClick={() => onDate(board?.health?.todayCt || date)}>Today</button>
            {onImport && (
              <button className="header-btn header-btn-refresh" onClick={onImport}>IMPORT HERITAGE BET SLIP</button>
            )}
          </div>
          <div className="filter-row" style={{ marginTop: 10 }}>
            <button className={sportFilter === "all" ? "chip active" : "chip"} onClick={() => onSportFilter("all")}>All sports</button>
            {BOARD_SPORTS.map((id) => (
              <button key={id} className={sportFilter === id ? "chip active" : "chip"} onClick={() => onSportFilter(id)}>
                {SPORTS[id].label} {counts.bySport?.[id] != null ? `(${counts.bySport[id]})` : ""}
              </button>
            ))}
          </div>
          <div className="filter-row">
            {FILTERS.map(([id, label]) => (
              <button key={id} className={bucket === id ? "chip active" : "chip"} onClick={() => onBucket(id)}>{label}</button>
            ))}
          </div>
          <div className="status-grid" style={{ marginTop: 10 }}>
            <Stat label="Last collect" value={fmtTs(health.lastCollect)} />
            <Stat label="Last harvest" value={fmtTs(health.lastHarvest)} />
            <Stat label="D1" value={health.d1 || "—"} />
            <Stat label="Sports" value={(health.sportsLoaded || []).join(" ") || "—"} />
            <Stat label="Games" value={health.gamesLoaded ?? counts.games ?? 0} />
            <Stat label="Projections" value={health.projectionsAvailable ?? "—"} />
            <Stat label="Markets" value={health.marketsAvailable ?? "—"} />
            <Stat label="Qualified" value={health.qualifiedTickets ?? counts.qualified ?? 0} />
          </div>
          {(health.openFailures || []).length > 0 && (
            <p className="error" style={{ marginTop: 8 }}>{health.openFailures.join(" · ")}</p>
          )}
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Cache-only odds on this page. Missing Pinnacle is context, not a bet. Pal last collect: {health.pal?.matched ?? 0} matched / {health.pal?.unmatched ?? 0} unmatched
            {health.pal?.mlbGames != null ? ` of ${health.pal.mlbGames} MLB games` : ""}
            {health.pal?.recordsReturned != null ? ` · Pal records ${health.pal.recordsReturned}` : ""}
            {health.pal?.usable != null ? ` · usable ${health.pal.usable}` : ""}
            {health.pal?.ambiguous ? ` · ambiguous ${health.pal.ambiguous}` : ""}
            {health.pal?.reason ? ` · ${health.pal.reason}` : ""}
            {health.pal?.error ? ` · ${health.pal.error}` : ""}.
          </p>
        </div>
      </section>

      {empty && !shown.some((g) => g.games.length) && (
        <div className="panel"><div className="empty">{empty.message || "No games scheduled."}</div></div>
      )}

      {shown.map((group) => (
        <section className="panel" key={group.sport}>
          <div className="panel-header">
            <h2>{group.label} · {group.games.length}{group.n != null && group.n !== group.games.length ? ` / ${group.n}` : ""}</h2>
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            {group.error && <div className="empty">Feed failure: {group.error}</div>}
            {!group.error && !group.games.length && <div className="empty">No games in this filter for {group.label}.</div>}
            {group.games.length > 0 && <TodayTable games={group.games} />}
          </div>
        </section>
      ))}
    </div>
  );
}

function filterRows(games, sport, bucket) {
  let xs = games || [];
  if (sport && sport !== "all") xs = xs.filter((g) => g.sport === sport);
  if (bucket === "scheduled") xs = xs.filter((g) => g.status === "scheduled" || g.status === "pregame");
  else if (bucket === "live") xs = xs.filter((g) => g.status === "live" || g.status === "halftime");
  else if (bucket === "final") xs = xs.filter((g) => g.status === "final");
  else if (bucket === "qualified") xs = xs.filter((g) => g.rec);
  else if (bucket === "leans") xs = xs.filter((g) => g.lean && !g.rec);
  return xs;
}

function shift(date, delta) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function fmtTs(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function TodayTable({ games }) {
  const mlb = games.some((g) => g.sport === "mlb");
  const [open, setOpen] = useState(() => new Set());
  const toggle = (key) => setOpen((before) => {
    const next = new Set(before);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const columns = 8 + (mlb ? 2 : 0);
  return (
    <table className="fbis-table today-table">
      <thead>
        <tr>
          <th>Matchup</th>
          <th>CT</th>
          <th>Status</th>
          <th>Proj</th>
          {mlb ? <th>F5</th> : null}
          {mlb ? <th>Props</th> : null}
          <th>Pin</th>
          <th>Quality</th>
          <th>Play</th>
          <th>MY BET</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => {
          const key = `${g.sport}:${g.id}`;
          return <Fragment key={key}>
          <tr>
            <td>
              <div className="team-block">
                <TeamIdentity team={g.away} score={g.score?.away} />
                <TeamIdentity team={g.home} score={g.score?.home} />
                <div className="muted" style={{ fontSize: 10 }}>
                  {g.venue || "—"}{g.neutral ? " · NEUTRAL" : ""}
                </div>
                <button className="game-expand" onClick={() => toggle(key)} aria-expanded={open.has(key)}>
                  {open.has(key) ? "Hide game details" : "View game details"}
                </button>
              </div>
            </td>
            <td>
              <div>{g.startCt || kickoffCt(g.start) || "—"}</div>
              <div className="muted">{g.modelVersion || ""}{g.checkpoint ? ` · ${g.checkpoint}` : ""}</div>
            </td>
            <td>
              <span className={`status-pill status-${g.status}`}>{g.status}</span>
              <div className="muted">{g.statusDetail}</div>
            </td>
            <td>
              <ProjCell g={g} />
            </td>
            {mlb ? <td><TodayF5Cell g={g} /></td> : null}
            {mlb ? <td><TodayPropsCell g={g} /></td> : null}
            <td>
              {g.marketUnresolved || g.marketUnavailable ? (
                <span className="muted">{g.marketUnresolved ? "TEAM MATCH UNRESOLVED" : "market unavailable"}</span>
              ) : (
                <>
                  <div>{pinMlLabel(g)}</div>
                  <div className="muted">{pinSpreadLabel(g)}</div>
                  <div className="muted">{g.marketLabels?.totalOver?.label || (g.pinTotal != null ? `tot ${g.pinTotal}` : "tot —")}</div>
                </>
              )}
            </td>
            <td>
              <div>{g.quality?.score ?? "—"}</div>
              <div className="muted">{(g.quality?.flags || []).slice(0, 2).join(" · ") || "—"}</div>
            </td>
            <td>
              {g.qualificationBlocked || (g.sport === "cfb" && g.bettingAllowed === false) ? (
                <span className="muted">{g.blockReason || g.noPlayReason || "Blocked"}</span>
              ) : g.rec ? (
                <>
                  <span className={`tier-badge tier-${g.rec.tag}`}>{g.rec.tag}</span>
                  <div>{g.rec.pick} · {g.rec.market}</div>
                </>
              ) : g.lean ? (
                <>
                  <span className="tier-badge tier-LEAN">LEAN</span>
                  <div>{g.lean.pick}</div>
                  <div className="muted">{g.lean.reason || g.noPlayReason}</div>
                </>
              ) : (
                <span className="muted">{g.noPlayReason || "No play"}</span>
              )}
            </td>
            <td>
              {(g.myBets || []).length ? (
                (g.myBets || []).map((b) => (
                  <div key={b.id} className="mybet-mark">
                    <span className="tier-badge tier-LEAN">MY BET</span>
                    <div>{b.selectedTeam || b.selectedSide} {fmtAmerican(b.executionPrice)}</div>
                    <div className="muted">${Number(b.riskAmount || 0).toFixed(2)} · {b.result || "OPEN"}</div>
                    <div className="muted">{b.attributionLabel || "OPERATOR BET · NOT ATTRIBUTED TO FBIS"}</div>
                    <div className="muted">{b.clv == null ? "CLV —" : `CLV ${Number(b.clv).toFixed(3)}`}</div>
                  </div>
                ))
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
          {open.has(key) ? <tr className="game-detail-row"><td colSpan={columns}><GameDetails g={g} /></td></tr> : null}
          </Fragment>;
        })}
      </tbody>
    </table>
  );
}

export function GameDetails({ g }) {
  const props = g.sportsbookProps || [];
  const grouped = Object.entries(props.reduce((out, p) => {
    const key = p.marketLabel || p.marketKey || "Player prop";
    (out[key] ||= []).push(p);
    return out;
  }, {}));
  return (
    <div className="game-detail-grid">
      <section>
        <h3>GAME MODEL</h3>
        <div>FBIS: {fmtNum(g.projAway)}–{fmtNum(g.projHome)} · total {fmtNum(g.projTotal)}</div>
        <div>Ballpark Pal: {g.palAway == null ? "—" : `${fmtNum(g.palAway)}–${fmtNum(g.palHome)}`}</div>
        <div>Pinnacle ML: {fmtAmerican(g.pinMlAway)} / {fmtAmerican(g.pinMlHome)}</div>
        <div>Kalshi sentiment: {g.sentiment?.home == null ? "—" : `${fmtPct(g.sentiment.home)} home`}</div>
      </section>
      <section>
        <h3>F5</h3>
        <TodayF5Cell g={g} />
        <div className="muted">Pal is the projection. Listed book prices are the executable market comparison.</div>
      </section>
      <section>
        <h3>WEATHER / PARK</h3>
        {g.weather ? <>
          <div>{g.weather.description || "Conditions available"}</div>
          <div>{g.weather.temperature == null ? "" : `${g.weather.temperature}°F`} {g.weather.windSpeed == null ? "" : `· wind ${g.weather.windSpeed} mph`}</div>
        </> : <div className="muted">Weather unavailable for this feed.</div>}
        <div>{g.palPark?.name || g.palPark?.parkName || g.venue || "Venue unavailable"}</div>
      </section>
      <section className="detail-props">
        <h3>SPORTSBOOK PLAYER PROPS · {props.length}</h3>
        {!props.length ? <div className="muted">No complete two-way player-prop prices in the current Parlay cache.</div> : grouped.map(([label, rows]) => (
          <details key={label}><summary>{label} · {rows.length}</summary>
            <table className="mini-prop-table"><thead><tr><th>Player</th><th>Line</th><th>Over</th><th>Under</th><th>Book</th></tr></thead>
              <tbody>{rows.map((p, i) => <tr key={`${p.playerName}:${p.marketKey}:${p.bookmakerKey}:${p.line}:${i}`}><td>{p.playerName}</td><td>{p.line}</td><td>{fmtAmerican(p.overPrice)}</td><td>{fmtAmerican(p.underPrice)}</td><td>{p.bookmaker}</td></tr>)}</tbody>
            </table>
          </details>
        ))}
        {(g.palProps || []).length ? <div className="muted">Pal projection watchlist: {g.palProps.length} displayed. Prop EV remains unavailable until player identity and exact contract match.</div> : null}
      </section>
      <section>
        <h3>MY BET / TRACKING</h3>
        {(g.myBets || []).length ? g.myBets.map((b) => <div key={b.id}>{b.selectedTeam || b.selectedSide} {fmtAmerican(b.executionPrice)} · ${Number(b.riskAmount || 0).toFixed(2)} · {b.result || "OPEN"}</div>) : <div className="muted">No imported Heritage bet.</div>}
        <div className="muted">Checkpoint: {g.checkpoint || "—"} · Model: {g.modelVersion || "—"}</div>
      </section>
    </div>
  );
}

function TodayF5Cell({ g }) {
  if (g.sport !== "mlb") return <span className="muted">—</span>;
  const b = g.f5Book;
  const pricedMl = b?.homeMl != null && b?.awayMl != null;
  const pricedTotal = b?.total != null && b?.overPrice != null && b?.underPrice != null;
  const pricedSpread = b?.spread != null && b?.spreadHomePrice != null && b?.spreadAwayPrice != null;
  if (g.palF5Home == null && !b) return <span className="muted">F5 unavailable</span>;
  return (
    <div className="f5-cell">
      {g.palF5Away != null ? <div>Pal {fmtNum(g.palF5Away)}–{fmtNum(g.palF5Home)}{g.palF5HomeWin != null ? ` · pH ${fmtPct(g.palF5HomeWin)}` : ""}</div> : null}
      {pricedMl ? <div className="muted">ML {fmtAmerican(b.awayMl)} / {fmtAmerican(b.homeMl)}</div> : null}
      {pricedSpread ? <div className="muted">RL {b.spread > 0 ? "+" : ""}{b.spread} · {fmtAmerican(b.spreadAwayPrice)} / {fmtAmerican(b.spreadHomePrice)}</div> : null}
      {pricedTotal ? <div className="muted">Tot {b.total} · O {fmtAmerican(b.overPrice)} / U {fmtAmerican(b.underPrice)}</div> : null}
      {!pricedMl && !pricedSpread && !pricedTotal ? <div className="muted">UNPRICED F5 LEAN · NO BET</div> : null}
    </div>
  );
}

function TodayPropsCell({ g }) {
  if (g.sport !== "mlb") return <span className="muted">—</span>;
  const props = g.palProps || [];
  if (!props.length) return <span className="muted">No Pal props</span>;
  return (
    <details className="prop-watch">
      <summary>{props.length} PROP WATCH</summary>
      <div className="muted">UNPRICED · NO BET</div>
      {props.slice(0, 8).map((p) => (
        <div key={p.marketId} title={p.displayName}>
          {p.playerName || (p.playerId != null ? `Player #${p.playerId}` : p.subjectType)} · {p.displayName} {p.line ?? "—"} · O {p.over == null ? "—" : fmtPct(p.over)}
        </div>
      ))}
    </details>
  );
}

function ProjCell({ g }) {
  if (g.sport === "cfb" && g.projectionState === "LEAGUE_AVERAGE_ONLY") {
    return (
      <>
        <div className="proj-blocked">PROJECTION BLOCKED</div>
        <div className="muted">Team-specific inputs missing</div>
        {g.projAway != null && <div className="muted">diag {fmtNum(g.projAway)} – {fmtNum(g.projHome)}</div>}
        <div className="proj-state muted">LEAGUE_AVERAGE_ONLY</div>
      </>
    );
  }
  if (g.sport === "nfl") {
    const implied = g.marketProjAway != null ? `${fmtNum(g.marketProjAway)} – ${fmtNum(g.marketProjHome)}` : null;
    return (
      <>
        <div className="muted">FBIS projection unavailable</div>
        {implied && <div className="proj-implied">Pinnacle implied score: {implied}</div>}
      </>
    );
  }
  if (g.projectionUnavailable || (g.projHome == null && g.projAway == null)) {
    return <span className="muted">projection unavailable</span>;
  }
  return (
    <>
      <div className="text-blue">{fmtNum(g.projAway)} – {fmtNum(g.projHome)}</div>
      <div className="muted">tot {fmtNum(g.projTotal)} · mgn {fmtNum(g.projMargin)}</div>
      {g.palAway != null && g.palHome != null ? (
        <div className="muted">
          Pal {fmtNum(g.palAway)}–{fmtNum(g.palHome)}
          {g.palPHome != null ? ` · pH ${fmtPct(g.palPHome)}` : ""}
          {g.palF5Away != null ? ` · F5 ${fmtNum(g.palF5Away)}–${fmtNum(g.palF5Home)}` : ""}
        </div>
      ) : g.sport === "mlb" ? (
        <div className="muted">Pal {g.palUnavailableReason || "unavailable"}</div>
      ) : null}
      {g.projectionState && <div className="proj-state muted">{g.projectionState}</div>}
      {(g.sport === "cfb" || g.sport === "cbb") && (
        <ChallengerSelect game={g} championHome={g.projHome} championAway={g.projAway} />
      )}
    </>
  );
}

function pinMlLabel(g) {
  const away = g.marketLabels?.mlAway?.label;
  const home = g.marketLabels?.mlHome?.label;
  if (away && home) return `${away} / ${home}`;
  return `${fmtAmerican(g.pinMlAway)} / ${fmtAmerican(g.pinMlHome)}`;
}

function pinSpreadLabel(g) {
  return g.marketLabels?.spreadHome?.label || (g.pinSpread != null ? `RL ${g.pinSpread > 0 ? "+" : ""}${g.pinSpread}` : "RL —");
}
import { Fragment, useState } from "react";
