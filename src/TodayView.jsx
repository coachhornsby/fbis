import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { fmtAmerican, fmtNum, fmtPct } from "./lib/format.js";
import { propWatchEmptyCopy, todayFeedNote } from "../functions/lib/propConviction.js";
import { kickoffCt } from "../functions/lib/gameStatus.js";
import { TeamIdentity } from "./components/TeamLogo.jsx";
import { ChallengerSelect } from "./components/ChallengerSelect.jsx";
import PopulationDescriptor from "./components/PopulationDescriptor.jsx";
import { Fragment, useState } from "react";
import { badgeLabel, valueOrUnavailable } from "./lib/healthState.js";

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
  stale,
  lastSuccessAt,
  attemptAt,
  state,
  date,
  onDate,
  sportFilter,
  onSportFilter,
  bucket,
  onBucket,
  onRetry,
  onImport,
}) {
  const groups = board?.groups || [];
  const health = board?.health || {};
  const counts = board?.counts || {};
  const empty = board?.empty;
  const coverage = board?.coverage || null;
  const shown = (groups || []).map((g) => ({
    ...g,
    games: filterRows(g.games || [], sportFilter, bucket),
  })).filter((g) => (sportFilter === "all" || g.sport === sportFilter) && (g.games.length || g.error));
  const unavailable = Boolean(error && !board);
  const d = (v, fallback = "—") => valueOrUnavailable(unavailable, v, fallback);
  const sourceStatus = health?.sourceStatus?.statuses || {};
  const qualificationValue =
    sportFilter === "all" && coverage && !coverage.qualificationAuthoritative
      ? "Qualification unavailable (incomplete all-sports coverage)"
      : d(health.qualifiedTickets ?? counts.qualified ?? 0);

  return (
    <div className="main-content today-board">
      {error && <div className="panel"><div className="error">{error}</div></div>}

      <section className="panel">
        <div className="panel-header">
          <h2>TODAY · {date} CT</h2>
          <span className="last-updated">
            {loading ? "Loading…" : `${badgeLabel(state || health?.state || "DEGRADED")} · ${unavailable ? "Unavailable" : `${counts.games ?? 0} games`}`}
          </span>
        </div>
        <div className="panel-body">
          <div className="today-controls">
            <button className="header-btn" onClick={() => onDate(shift(date, -1))} aria-label="Previous day">← Prev</button>
            <input type="date" value={date} onChange={(e) => onDate(e.target.value)} />
            <button className="header-btn" onClick={() => onDate(shift(date, 1))} aria-label="Next day">Next →</button>
            <button className="header-btn" onClick={() => onDate(board?.health?.todayCt || date)}>Today</button>
            {onImport && (
              <button className="header-btn header-btn-refresh" onClick={onImport}>IMPORT BET SLIP</button>
            )}
            {onRetry && <button className="header-btn" onClick={() => onRetry?.()} disabled={loading}>{loading ? "Retrying…" : "Retry"}</button>}
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {attemptAt ? `Current attempt ${fmtTs(attemptAt)}. ` : ""}
            Population: scheduled and live board rows for this date/sport filter. {lastSuccessAt ? `Last successful load ${fmtTs(lastSuccessAt)}.` : "No successful load yet."}
            {stale ? " Showing last-known-good snapshot (stale)." : ""}
          </p>
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
            <Stat label="Last collect" value={d(fmtTs(health.lastCollect))} />
            <Stat label="Last harvest" value={d(fmtTs(health.lastHarvest))} />
            <Stat label="D1" value={d(health.d1 || "—")} />
            <Stat label="Sports" value={d((health.sportsLoaded || []).join(" ") || "—")} />
            <Stat label="Games" value={d(health.gamesLoaded ?? counts.games ?? 0)} />
            <Stat label="Projections" value={d(health.projectionsAvailable ?? "—")} />
            <Stat label="Markets" value={d(health.marketsAvailable ?? "—")} />
            <Stat label="Qualified" value={qualificationValue} />
          </div>
          {coverage ? (
            <p className="muted" style={{ marginTop: 8 }}>
              Coverage: {coverage.numerator} of {coverage.denominator} sports authoritative.
              {coverage.allSportsAuthoritative
                ? " All-sports qualification counts are authoritative."
                : " All-sports qualification is incomplete; unavailable sports are excluded from authoritative totals."}
            </p>
          ) : null}
          {Object.keys(sourceStatus).length ? (
            <div className="status-grid" style={{ marginTop: 10 }}>
              {Object.entries(sourceStatus).map(([sportId, s]) => (
                <Stat
                  key={sportId}
                  label={`${String(sportId).toUpperCase()} source`}
                  value={`${s.schedule}/${s.projections}/${s.markets} · ${s.source}${s.error ? ` · ${s.error}` : ""}`}
                />
              ))}
            </div>
          ) : null}
          {(health.openFailures || []).length > 0 && (
            <p className="error" style={{ marginTop: 8 }}>{health.openFailures.join(" · ")}</p>
          )}
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            {todayFeedNote(health, counts.mlbPropWatch)}
          </p>
          <PopulationDescriptor descriptor={board?.population?.board} title="Board population descriptor" />
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
            {group.sport === "mlb" && counts.mlbPropWatch && !counts.mlbPropWatch.convictions ? (
              <div className="muted" style={{ padding: "10px 14px 0" }}>{propWatchEmptyCopy(counts.mlbPropWatch)}</div>
            ) : null}
            {group.games.length > 0 && <div className="table-scroll"><TodayTable games={group.games} propWatch={counts.mlbPropWatch} /></div>}
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

function TodayTable({ games, propWatch }) {
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
              <div className="team-block team-block-lg">
                <TeamIdentity team={g.away} score={g.score?.away} size={52} />
                <TeamIdentity team={g.home} score={g.score?.home} size={52} />
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
            {mlb ? <td><TodayPropsCell g={g} propWatch={propWatch} /></td> : null}
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
                  {g.sport === "cfb" && g.projHome != null && g.projAway != null ? <div className="muted">Projected winner: {g.projHome >= g.projAway ? g.home.fullName || g.home.name : g.away.fullName || g.away.name}</div> : null}
                </>
              ) : g.lean ? (
                <>
                  <span className="tier-badge tier-LEAN">LEAN</span>
                  <div>{g.lean.pick}</div>
                  <div className="muted">{g.lean.reason || g.noPlayReason}</div>
                  {g.sport === "cfb" && g.projHome != null && g.projAway != null ? <div className="muted">Projected winner: {g.projHome >= g.projAway ? g.home.fullName || g.home.name : g.away.fullName || g.away.name}</div> : null}
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
  if (g.sport === "cfb") return <CfbGameDetails g={g} />;
  const props = g.propConvictions || [];
  return (
    <div className="game-detail-grid">
      <section>
        <h3>GAME MODEL</h3>
        <div>FBIS: {fmtNum(g.projAway)}–{fmtNum(g.projHome)} · total {fmtNum(g.projTotal)}</div>
        <div>Ballpark Pal: {g.palAway == null ? "—" : `${fmtNum(g.palAway)}–${fmtNum(g.palHome)}`}</div>
        <div>Pinnacle ML: {fmtAmerican(g.pinMlAway)} / {fmtAmerican(g.pinMlHome)}</div>
        <div>Kalshi sentiment: {g.sentiment?.home == null ? "—" : `${fmtPct(g.sentiment.home)} home`}</div>
        {!g.pinMlHome && !g.pinMlAway && (g.odds?.homeMl != null || g.odds?.awayMl != null) ? (
          <div className="muted">Soft ML ({g.odds?.softSource || "espn"}): {fmtAmerican(g.odds?.awayMl)} / {fmtAmerican(g.odds?.homeMl)}</div>
        ) : null}
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
          <div>
            {g.weather.temperature == null ? "" : `${g.weather.temperature}°F`}
            {g.weather.windSpeed == null ? "" : ` · wind ${g.weather.windSpeed} mph`}
            {g.weather.precipProbability == null ? "" : ` · precip ${g.weather.precipProbability}%`}
          </div>
          {g.weather.note ? <div className="muted">{g.weather.note}</div> : null}
          {g.weather.attribution ? <div className="muted">{g.weather.attribution}</div> : null}
        </> : <div className="muted">Weather unavailable for this feed.</div>}
        <div>{g.palPark?.name || g.palPark?.parkName || g.venue || "Venue unavailable"}</div>
      </section>
      <section className="detail-props">
        <h3>CONVICTION PLAYER PROPS · {props.length}</h3>
        {!props.length ? (
          <div className="muted">
            {propWatchEmptyCopy({
              status: (g.sportsbookPropCount || (g.sportsbookProps || []).length) ? "available" : "empty",
              sportsbookContracts: g.sportsbookPropCount || (g.sportsbookProps || []).length || 0,
              convictions: 0,
            })}
          </div>
        ) : (
          <table className="mini-prop-table"><thead><tr><th>Player</th><th>Prop</th><th>FBIS proj</th><th>Probability</th><th>Expected ROI</th><th>Book</th></tr></thead>
            <tbody>{props.map((p, i) => <tr key={`${p.playerName}:${p.market}:${p.line}:${i}`}><td>{p.playerName}</td><td><span className="tier-badge tier-CONVICTION">CONVICTION</span> {p.side} {p.line} {fmtAmerican(p.price)}</td><td>{p.projection == null ? "—" : fmtNum(p.projection)}</td><td>{fmtPct(p.probability)}</td><td>{fmtPct(p.ev)}</td><td>{p.book || "—"}</td></tr>)}</tbody>
          </table>
        )}
      </section>
      <section>
        <h3>MY BET / TRACKING</h3>
        {(g.myBets || []).length ? g.myBets.map((b) => <div key={b.id}>{b.selectedTeam || b.selectedSide} {fmtAmerican(b.executionPrice)} · ${Number(b.riskAmount || 0).toFixed(2)} · {b.result || "OPEN"}</div>) : <div className="muted">No imported bet.</div>}
        <div className="muted">Checkpoint: {g.checkpoint || "—"} · Model: {g.modelVersion || "—"}</div>
      </section>
    </div>
  );
}

function CfbGameDetails({ g }) {
  const c = g.cfbDetail || {};
  const steps = g.projectionRecipe?.steps || [];
  return (
    <div className="game-detail-grid">
      <section>
        <h3>CFB PROJECTION</h3>
        <div>FBIS: {fmtNum(g.projAway)}–{fmtNum(g.projHome)} · total {fmtNum(g.projTotal)} · margin {fmtNum(g.projMargin)}</div>
        <div>State: {g.projectionState || "—"} · quality {c.dataQuality ?? g.quality?.score ?? "—"}</div>
        <div>Projected winner: {g.projHome >= g.projAway ? g.home.fullName || g.home.name : g.away.fullName || g.away.name}</div>
      </section>
      <section>
        <h3>MARKET</h3>
        <div>ML: {fmtAmerican(g.pinMlAway)} / {fmtAmerican(g.pinMlHome)}</div>
        <div>Home spread: {g.pinSpread == null ? "—" : g.pinSpread} · total {g.pinTotal ?? "—"}</div>
        <div className="muted">Pinnacle is the benchmark; it is not an independent projection input.</div>
      </section>
      <section>
        <h3>UNCERTAINTY / VENUE</h3>
        <div>HFA: {c.hfa ?? "—"} · margin σ {c.sigmaMargin ?? "—"} · total σ {c.sigmaTotal ?? "—"}</div>
        <div>{g.neutral ? "Confirmed neutral site" : g.venue || "Venue unavailable"}</div>
        <div className="muted">{(c.flags || []).slice(0, 8).join(" · ") || "No flags"}</div>
      </section>
      <section>
        <h3>TEAM INPUTS</h3>
        <div>{g.away.name}: prior O/D {fmtNum(c.away?.priorOff)}/{fmtNum(c.away?.priorDef)} · current games {c.away?.games ?? 0}</div>
        <div>{g.home.name}: prior O/D {fmtNum(c.home?.priorOff)}/{fmtNum(c.home?.priorDef)} · current games {c.home?.games ?? 0}</div>
        <div>{g.away.name}: adjusted O/D {fmtNum(c.away?.off)}/{fmtNum(c.away?.def)} · features {((c.away?.usedFeatures || []).join(", ") || "none")}</div>
        <div>{g.home.name}: adjusted O/D {fmtNum(c.home?.off)}/{fmtNum(c.home?.def)} · features {((c.home?.usedFeatures || []).join(", ") || "none")}</div>
        {(c.away?.qb?.starterKnown || c.home?.qb?.starterKnown) ? (
          <div className="muted">
            QB starters: {g.away.abbr} {c.away?.qb?.starterName || "unknown"}{c.away?.qb?.starterTransfer ? " (transfer)" : ""} · {g.home.abbr} {c.home?.qb?.starterName || "unknown"}{c.home?.qb?.starterTransfer ? " (transfer)" : ""}
          </div>
        ) : null}
        <div className="muted">Prior: {c.priorVersion || "—"}</div>
      </section>
      <section className="detail-props">
        <h3>HOW THIS PROJECTION WAS BUILT</h3>
        {steps.length ? steps.map((s, i) => <div key={i} className="muted">{i + 1}. {s}</div>) : <div className="muted">Projection recipe unavailable.</div>}
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

function TodayPropsCell({ g, propWatch }) {
  if (g.sport !== "mlb") return <span className="muted">—</span>;
  const props = g.propConvictions || [];
  if (!props.length) {
    if (propWatch && (propWatch.skipped || propWatch.status === "error" || propWatch.status === "empty" || !propWatch.sportsbookContracts)) {
      return <span className="muted">—</span>;
    }
    return <span className="muted">None qualify</span>;
  }
  return (
    <details className="prop-watch">
      <summary>{props.length} CONVICTION {props.length === 1 ? "PROP" : "PROPS"}</summary>
      {props.map((p, i) => (
        <div key={`${p.playerName}:${p.market}:${i}`} title={p.reason}>
          {p.playerName} · {p.side} {p.line} {fmtAmerican(p.price)} · proj {p.projection == null ? "—" : fmtNum(p.projection)} · Expected ROI {fmtPct(p.ev)}
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
