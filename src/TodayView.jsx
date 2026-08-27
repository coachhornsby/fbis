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
  return (
    <table className="fbis-table today-table">
      <thead>
        <tr>
          <th>Matchup</th>
          <th>CT</th>
          <th>Status</th>
          <th>Proj</th>
          <th>Pin</th>
          <th>Quality</th>
          <th>Play</th>
          <th>MY BET</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g) => (
          <tr key={`${g.sport}:${g.id}`}>
            <td>
              <div className="team-block">
                <TeamIdentity team={g.away} score={g.score?.away} />
                <TeamIdentity team={g.home} score={g.score?.home} />
                <div className="muted" style={{ fontSize: 10 }}>
                  {g.venue || "—"}{g.neutral ? " · NEUTRAL" : ""}
                </div>
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
        ))}
      </tbody>
    </table>
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
