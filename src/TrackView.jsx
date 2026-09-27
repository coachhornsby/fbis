import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { CHECKPOINT_OPTIONS } from "../functions/lib/checkpoints.js";
import { fmtNum, fmtPct, fmtSigned, fmtMetric as fmtMetricN0 } from "./lib/format.js";
import { useEffect, useState } from "react";
import useIsCompact from "./hooks/useIsCompact.js";
import { badgeLabel, valueOrUnavailable } from "./lib/healthState.js";
import PopulationDescriptor from "./components/PopulationDescriptor.jsx";

const PERIODS = [
  ["7", "Last 7"],
  ["14", "Last 14"],
  ["30", "Last 30"],
  ["50", "Last 50 games"],
  ["100", "Last 100 games"],
  ["season", "Season"],
  ["lifetime", "Lifetime"],
];
const MODELS = [
  ["ensemble", "FBIS Ensemble"],
  ["proprietary", "FBIS Proprietary"],
  ["pal", "Ballpark Pal"],
  ["savant", "Savant"],
  ["market", "Pinnacle"],
];
const TABS = [
  ["overall", "Overall"],
  ["month", "Month"],
  ["day", "Day"],
  ["park", "Park"],
  ["team", "Team"],
  ["starter", "Starter"],
  ["homeAway", "Home/Away"],
  ["version", "Model Version"],
  ["checkpoint", "Checkpoint"],
  ["week", "Week"],
  ["conference", "Conference"],
  ["favDog", "Fav / Dog"],
  ["spreadRange", "Spread range"],
];

export default function TrackView({ report, error, loading, stale, lastSuccessAt, attemptAt, state, filters, onFilters, onRefresh }) {
  const unavailable = state === "UNAVAILABLE";
  const acc = report?.accuracy || { n: 0 };
  const pack = report?.pack || {};
  const table = pack.table || { headline: {}, rows: [] };
  const dist = pack.distribution || {};
  const models = pack.models || [];
  const br = pack.breakdowns || {};
  const games = unavailable ? [] : (report?.games || []);
  const graded = games.filter((g) => g.status === "GRADED");
  const open = games.filter((g) => g.status === "OPEN");
  const guide = report?.recipeGuide || {};
  const db = report?.db || {};
  const hl = table.headline || {};
  const tab = filters?.tab || "overall";
  const perGame = filters?.type !== "totals";
  const gamesBySport = splitRowsBySport(games);
  const [teamInput, setTeamInput] = useState(filters?.team || "");
  const compact = useIsCompact(760);
  const [openPanels, setOpenPanels] = useState({
    model: false,
    guide: false,
    calFav: false,
    calHome: false,
    bySport: false,
    ops: false,
    research: false,
    projections: false,
    diagnostics: false,
  });
  const actionIssues = [];
  if (error) actionIssues.push(`SYS feed error: ${error}`);
  if (!db.ok) actionIssues.push(`Research DB unavailable (${db.reason || db.lastError || "unknown"}).`);
  if (Number(db.failedWrites || 0) > 0) actionIssues.push(`${db.failedWrites} failed write(s) detected.`);
  if (Number(db.failedHarvests || 0) > 0) actionIssues.push(`${db.failedHarvests} failed harvest(s) detected.`);
  for (const w of db.scheduleWarnings || []) actionIssues.push(String(w));

  const rowKey = (g) => `${g.date}:${g.id}:${g.checkpoint || ""}`;
  const togglePanel = (key) => setOpenPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  useEffect(() => {
    setTeamInput(filters?.team || "");
  }, [filters?.team]);

  useEffect(() => {
    const id = setTimeout(() => {
      if ((filters?.team || "") !== teamInput) onFilters?.({ team: teamInput });
    }, 300);
    return () => clearTimeout(id);
  }, [teamInput, filters?.team, onFilters]);

  return (
    <div className="main-content">
      {error && <div className="panel"><div className="error">{error}</div></div>}
      {actionIssues.length ? (
        <section id="action-required" className="panel sys-action-sticky">
          <div className="panel-body" style={{ padding: "8px 12px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ color: "#fff" }}>Action · {badgeLabel(state || "DEGRADED")}</strong>
              <span className="muted">{lastSuccessAt ? `Last OK ${fmtTs(lastSuccessAt)}` : "No successful SYS refresh yet."}</span>
            </div>
            <ul style={{ margin: "6px 0 0 18px" }}>
              {actionIssues.slice(0, 4).map((issue, i) => <li key={`${issue}-${i}`} className="text-red">{issue}</li>)}
            </ul>
          </div>
        </section>
      ) : null}

      <section className="panel sys-section-nav">
        <div className="panel-body">
          <div className="chip-row">
            <a className="chip" href="#results-scoreboard">Results</a>
            <a className="chip" href="#your-picks">Your picks</a>
            <a className="chip" href="#ops-health">Ops</a>
            <a className="chip" href="#sys-diagnostics" onClick={() => setOpenPanels((p) => ({ ...p, diagnostics: true }))}>Diagnostics</a>
          </div>
        </div>
      </section>

      <StrategyPanel sectionId="results-scoreboard" reloadKey={`${lastSuccessAt || ""}:${attemptAt || ""}`} />

      <HeritageExecutedPanel summary={report?.executedBets?.summary} unavailable={unavailable} />
      <AdvisorAnalyticsPanel reloadKey={`${lastSuccessAt || ""}:${attemptAt || ""}`} />

      <section id="ops-health" className="panel">
        <div className="panel-header">
          <h2>Ops</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="last-updated">{badgeLabel(state || "DEGRADED")}</span>
            <button type="button" className="header-btn" onClick={() => togglePanel("ops")}>{openPanels.ops ? "Hide" : "Details"}</button>
          </div>
        </div>
        <div className="panel-body">
          <div className="status-grid">
            <Stat label="Collect" value={db.scheduled?.collect?.state || "unknown"} />
            <Stat label="Harvest" value={db.scheduled?.harvest?.state || "unknown"} />
            <Stat label="D1 write" value={Number(db.failedWrites || 0) === 0 ? "healthy" : `${db.failedWrites} failed`} />
            <Stat label="Pipeline" value={badgeLabel(state || "DEGRADED")} />
          </div>
          {openPanels.ops ? (
            <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
              Collect {fmtTs(db.lastScheduledCollectSuccess || db.scheduled?.collect?.lastObservedAt)} · Harvest {fmtTs(db.lastScheduledHarvestSuccess || db.scheduled?.harvest?.lastObservedAt)}
              {db.scheduled?.lastRunUrl ? ` · ${db.scheduled.lastRunUrl}` : ""}
            </p>
          ) : null}
        </div>
      </section>

      <section id="sys-diagnostics" className="panel">
        <div className="panel-header">
          <h2>Diagnostics</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="last-updated">projections · research · CLV · anomalies</span>
            <button type="button" className="header-btn" onClick={() => togglePanel("diagnostics")}>
              {openPanels.diagnostics ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {!openPanels.diagnostics ? (
          <div className="panel-body">
            <p className="muted" style={{ margin: 0 }}>
              Projection accuracy, Research DB, settlement backlog, CLV, model layers, and anomalies stay collapsed so Results and Your picks stay readable.
            </p>
          </div>
        ) : null}
      </section>

      {openPanels.diagnostics ? (
        <>
      <section id="sport-systems" className="panel">
        <div className="panel-header"><h2>Sport systems</h2><span className="last-updated">independent tracking by board</span></div>
        <div className="panel-body">
          <p className="muted" style={{ marginBottom: 8 }}>
            Population: frozen projection snapshots and their settled finals for the selected filters.
          </p>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            <button className={filters.sport === "all" ? "chip active" : "chip"} onClick={() => onFilters({ sport: "all" })}>ALL</button>
            {BOARD_SPORTS.map((id) => <button key={id} className={filters.sport === id ? "chip active" : "chip"} onClick={() => onFilters({ sport: id })}>{SPORTS[id].label}</button>)}
          </div>
          <div className="glossary-grid">
            {(report?.sports || []).map((s) => <article className="g-card" key={s.sport}>
              <h3>{SPORTS[s.sport]?.label || s.sport}</h3>
              <p>{s.recipe?.engine || "No engine configured"}</p>
              <div className="muted">Graded N={s.accuracy?.n ?? 0} · Total MAE {fmtNum(s.accuracy?.maeTotal)} · Margin MAE {fmtNum(s.accuracy?.maeMargin)}</div>
              <div className="muted">Winner {fmtPct(s.accuracy?.winnerHitProb ?? s.accuracy?.winnerHit)} · Brier {fmtNum(s.accuracy?.brierModel, 3)}</div>
            </article>)}
          </div>
        </div>
      </section>

      <section id="research-db" className="panel">
        <div className="panel-header">
          <h2>Research DB</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="last-updated">{loading ? "Loading…" : db.lastWrite ? `${new Date(db.lastWrite).toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT` : ""}</span>
            <button className="header-btn" onClick={() => togglePanel("research")}>{openPanels.research ? "Collapse" : "Expand"}</button>
          </div>
        </div>
        <div className="panel-body">
          <div className={`db-banner ${db.ok ? "db-ok" : "db-bad"}`}>
            {db.ok ? "RESEARCH DB: READ HEALTHY" : `RESEARCH DB ${db.reason === "unbound" ? "UNBOUND" : "ERROR"}`}
            <span className="muted" style={{ marginLeft: 10 }}>
              collect {db.scheduled?.collect?.state || "—"} · harvest {db.scheduled?.harvest?.state || "—"}
              {db.failedWrites ? ` · failed writes ${db.failedWrites}` : ""}
            </span>
          </div>
          {openPanels.research ? (
          <>
          <div className="status-grid" style={{ marginTop: 10 }}>
            <Stat label="D1 binding" value={db.bound === false ? "unbound" : "bound"} />
            <Stat label="D1 read health" value={db.ok ? "healthy" : "failed"} />
            <Stat
              label="D1 write health"
              value={Number(db.failedWrites || 0) === 0 && Number(db.failedHarvests || 0) === 0 ? "healthy" : "degraded"}
            />
            <Stat label="Last successful read" value={valueOrUnavailable(!db.ok, fmtTs(db.lastCollectSuccess || db.lastCollect))} />
            <Stat label="Last successful write" value={valueOrUnavailable(!db.ok, fmtTs(db.lastD1WriteSuccess || db.lastWrite))} />
            <Stat label="Failed writes" value={db.failedWrites ?? 0} />
            <Stat label="Failed harvest writes" value={db.failedHarvests ?? 0} />
            <Stat label="Current DB error" value={db.reason || db.lastError || "none"} />
          </div>
          {(db.scheduleWarnings || []).length > 0 && (
            <p className="error" style={{ marginTop: 8, marginBottom: 0 }}>
              {(db.scheduleWarnings || []).join(" ")}
            </p>
          )}
          {db.scheduled && (
            <div className="status-grid" style={{ marginTop: 10 }}>
              <Stat label="Scheduled collect" value={fmtTs(db.lastScheduledCollectSuccess || db.scheduled?.collect?.lastObservedAt)} />
              <Stat label="Scheduled harvest" value={fmtTs(db.lastScheduledHarvestSuccess || db.scheduled?.harvest?.lastObservedAt)} />
              <Stat label="Next expected" value={fmtTs(db.scheduled?.nextCollect)} />
              <Stat label="Collect state" value={db.scheduled?.collect?.state || "unknown"} />
              <Stat label="Harvest state" value={db.scheduled?.harvest?.state || "unknown"} />
              <Stat label="Last event" value={db.scheduled?.lastEventType || "none"} />
              <Stat label="Manual collect" value={fmtTs(db.lastManualCollectSuccess)} />
              <Stat label="Manual harvest" value={fmtTs(db.lastManualHarvestSuccess)} />
            </div>
          )}
          {db.scheduled?.lastRunUrl && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Last scheduled run: {db.scheduled.lastRunUrl}
            </p>
          )}
          {db.palPipeline && (
            <>
              <h3 className="subhead">Ballpark Pal</h3>
              <div className="status-grid">
                <Stat label="Configured" value="yes" />
                <Stat label="Last success" value={fmtTs(db.palPipeline.lastSuccess)} />
                <Stat label="Last failure" value={db.palPipeline.lastFailure || "—"} />
                <Stat label="HTTP" value={db.palPipeline.httpStatus || "—"} />
                <Stat label="Records" value={db.palPipeline.recordsReturned ?? "—"} />
                <Stat label="Usable" value={db.palPipeline.usable ?? "—"} />
                <Stat label="Matched" value={db.palPipeline.matched ?? "—"} />
                <Stat label="Unmatched" value={db.palPipeline.unmatched ?? "—"} />
                <Stat label="Ambiguous" value={db.palPipeline.ambiguous ?? "—"} />
                <Stat label="D1 writes" value={db.palPipeline.persisted ?? "—"} />
                <Stat label="asOf" value={fmtTs(db.palPipeline.asOf)} />
                <Stat label="requestId" value={db.palPipeline.requestId || "—"} />
                <Stat label="Last attempt HTTP" value={db.palPipeline.lastAttemptHttpStatus || "—"} />
              </div>
              {db.palPipeline.availableFromCache && <p className="muted" style={{ marginTop: 8 }}>Available from the last successful cache; latest refresh was rate-limited.</p>}
              {db.palPipeline.reason && <p className="muted" style={{ marginTop: 8 }}>Pal reason: {db.palPipeline.reason}</p>}
            </>
          )}
          {db.college && (
            <>
              <h3 className="subhead">College research (shadow)</h3>
              <div className="status-grid">
                <Stat label="CFBD key" value={db.college.keys?.cfbdConfigured ? "configured" : "missing"} />
                <Stat label="CBBD key" value={db.college.keys?.cbbdConfigured ? "configured" : "missing"} />
                <Stat label="Shared alias" value={db.college.keys?.sharedAlias ? "yes" : "no"} />
                <Stat label="Quota used" value={db.college.quota?.used ?? "—"} />
                <Stat label="Quota %" value={db.college.quota?.used != null ? `${Math.round((db.college.quota.pct || 0) * 100)}%` : "N=0 — unavailable"} />
                <Stat label="Quota level" value={db.college.quota?.level || "—"} />
                <Stat label="D1 bytes" value={db.college.storage?.d1Bytes ?? "unknown"} />
                <Stat label="D1 level" value={db.college.storage?.d1Level || "—"} />
                <Stat label="R2" value={db.college.storage?.r2?.bound ? "bound" : "unbound"} />
              </div>
              <p className="muted" style={{ marginTop: 8 }}>{db.college.note}</p>
            </>
          )}
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Scheduled collection writes pregame checkpoints even if this page is closed. SYS reads D1; cache is only a fallback. Bias near zero is not accuracy — MAE, median abs, and RMSE sit beside every total.
          </p>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
            Heritage Confirm writes from this site without pasting HARVEST_SECRET. Collect and strategy POST still use the Pages secret.
          </p>
          </>
          ) : null}
        </div>
      </section>

      <section id="settlement-backlog" className="panel">
        <div className="panel-header">
          <h2>Settlement backlog</h2>
          <span className="last-updated">{unavailable ? "Unavailable" : `${open.length} waiting`}</span>
        </div>
        <div className="panel-body">
          <div className="status-grid">
            <Stat label="Open snapshots" value={valueOrUnavailable(unavailable, open.length)} />
            <Stat label="Graded snapshots" value={valueOrUnavailable(unavailable, graded.length)} />
            <Stat label="Last collect success" value={fmtTs(db.lastCollectSuccess || db.lastCollect)} />
            <Stat label="Last harvest success" value={fmtTs(db.lastHarvestSuccess || db.lastHarvest)} />
          </div>
          <p className="muted">Effective scope: projection snapshots in the currently active SYS filters; not all historical records.</p>
        </div>
      </section>

      <section id="projection-accuracy" className="panel">
        <div className="panel-header">
          <h2>Projection Accuracy</h2>
          <span className="last-updated">
            {unavailable ? "DATA UNAVAILABLE" : (db.ok ? `${hl.n || 0} games` : "Unavailable")}
          </span>
        </div>
        <div className="panel-body">
          <div className="filter-row">
            <Filter label="Board">
              <select value={filters.sport} onChange={(e) => onFilters({ sport: e.target.value })}>
                <option value="all">All</option>
                {BOARD_SPORTS.map((id) => (
                  <option key={id} value={id}>{SPORTS[id].label}</option>
                ))}
              </select>
            </Filter>
            <Filter label="Period">
              <select value={filters.days} onChange={(e) => onFilters({ days: e.target.value, year: "" })}>
                {PERIODS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Filter>
            <Filter label="Year">
              <select value={filters.year || ""} onChange={(e) => onFilters({ year: e.target.value })}>
                <option value="">All years</option>
                <option value="2026">2026</option>
                <option value="2027">2027</option>
              </select>
            </Filter>
            <Filter label="Model">
              <select value={filters.model} onChange={(e) => onFilters({ model: e.target.value })}>
                {MODELS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </Filter>
            <Filter label="Checkpoint">
              <select value={filters.checkpoint} onChange={(e) => onFilters({ checkpoint: e.target.value })}>
                <option value="LATEST">Latest</option>
                {CHECKPOINT_OPTIONS.filter((c) => c !== "LATEST").map((c) => (
                  <option key={c} value={c}>{c === "INFORMATION_CONFIRMED" ? "INFORMATION_CONFIRMED → LINEUP_CONFIRMED" : c}</option>
                ))}
              </select>
            </Filter>
            <Filter label="Version">
              <select value={filters.version} onChange={(e) => onFilters({ version: e.target.value })}>
                <option value="all">All versions</option>
                {(report?.versions || []).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </Filter>
            <Filter label="Team">
              <input
                value={teamInput}
                placeholder="abbr"
                onChange={(e) => setTeamInput(e.target.value)}
                style={{ background: "var(--navy)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", fontSize: 12, width: 80 }}
              />
            </Filter>
            <Filter label="Type">
              <div className="chip-row">
                <button className={perGame ? "chip active" : "chip"} onClick={() => onFilters({ type: "perGame" })}>Per Game</button>
                <button className={!perGame ? "chip active" : "chip"} onClick={() => onFilters({ type: "totals" })}>Totals</button>
              </div>
            </Filter>
          </div>

          <div className="chip-row" style={{ marginBottom: 14 }}>
            {TABS.map(([id, label]) => (
              <button key={id} className={tab === id ? "chip active" : "chip"} onClick={() => onFilters({ tab: id })}>{label}</button>
            ))}
          </div>

          <p className="headline-line">
            {unavailable
              ? `Projection accuracy unavailable: ${(report?.health?.failures || []).map((f) => `${f.name}=${f.detail || "failed"}`).join(" · ") || error || "authoritative population unavailable"}.`
              : hl.n
              ? `Projected runs have been ${fmtPctSigned(hl.pctDiff)} vs actual (${hl.n} games). Median abs ${fmtNum(hl.medianAbs)} · MAE ${fmtNum(hl.mae)} · RMSE ${fmtNum(hl.rmse)}.`
              : db.ok ? "No graded projections in this window yet. Collection runs on a schedule — you do not need to open the board." : "Projection accuracy unavailable until DB access recovers."}
          </p>
          <p className="muted">
            Projection Accuracy is frozen D1 snapshots vs finals — not ticket W/L.
            {report?.pal?.unavailable
              ? " Pal: N=0 — unavailable."
              : report?.pal
                ? ` Pal projected N=${report.pal.projectedN ?? report.pal.matchedN ?? 0}; Pal graded N=${report.pal.gradedN ?? 0}.`
                : ""}
            {report?.pal?.message ? ` ${report.pal.message}` : ""}
            {report?.coverage ? ` Pin totals ${report.coverage.pinTotal ?? 0} / projected ${report.coverage.projected ?? 0}.` : ""}
          </p>

          <div className="status-grid" style={{ marginBottom: 14 }}>
            <Stat label="Games graded" value={valueOrUnavailable(unavailable, hl.n || 0)} />
            <Stat label={perGame ? "Actual / game" : "Actual runs"} value={fmtMetricN0(hl.n, hl.actualRuns, fmtNum)} />
            <Stat label={perGame ? "Projected / game" : "Projected runs"} value={fmtMetricN0(hl.n, hl.projectedRuns, fmtNum)} />
            <Stat label="Difference" value={fmtMetricN0(hl.n, hl.diff, fmtSigned)} />
            <Stat label="% Difference" value={fmtMetricN0(hl.n, hl.pctDiff, fmtPctSigned)} />
            <Stat label="Home bias" value={fmtMetricN0(hl.n, hl.homeBias, fmtPctSigned)} />
            <Stat label="Away bias" value={fmtMetricN0(hl.n, hl.awayBias, fmtPctSigned)} />
            <Stat label="Median error" value={fmtMetricN0(hl.n, hl.median, fmtSigned)} />
            <Stat label="Median abs" value={fmtMetricN0(hl.n, hl.medianAbs, fmtNum)} />
            <Stat label="MAE" value={fmtMetricN0(hl.n, hl.mae, fmtNum)} />
            <Stat label="RMSE" value={fmtMetricN0(hl.n, hl.rmse, fmtNum)} />
            <Stat label="Score winner" value={fmtMetricN0(acc.n, acc.winnerHitScore ?? acc.winnerHit, fmtPct)} />
            <Stat label="Ensemble winner" value={fmtMetricN0(acc.n, acc.winnerHitProb, fmtPct)} />
            <Stat label="Brier vs Pin" value={fmtMetricN0(acc.n, acc.brierImprovement, (v) => fmtSigned(v, 3))} />
          </div>
          <PopulationDescriptor descriptor={report?.population?.accuracy} title="Accuracy population descriptor" />

          {!unavailable && tab === "overall" && (
            <>
              <MetricTable rows={table.rows || []} />
              <h3 className="subhead">Error distribution</h3>
              <DistBlock dist={dist} />
              <h3 className="subhead">Model comparison</h3>
              <ModelsTable models={models} />
              {(report?.over) && (
                <>
                  <h3 className="subhead">Over / under disagreement</h3>
                  <OverBlock over={report.over} />
                </>
              )}
              {(report?.dailyReports || []).length > 0 && (
                <>
                  <h3 className="subhead">Latest research note</h3>
                  <pre className="daily-note">{report.dailyReports[0].body}</pre>
                </>
              )}
              <h3 className="subhead">Projection bias</h3>
              <SliceTable rows={br.biasSlices || []} />
              {(br.rolling || []).length > 4 && (
                <>
                  <h3 className="subhead">Rolling 50-game</h3>
                  <RollingTable rows={(br.rolling || []).slice(-12)} />
                </>
              )}
            </>
          )}
          {!unavailable && tab === "month" && <BreakTable rows={br.month || []} extra />}
          {!unavailable && tab === "day" && <BreakTable rows={(br.day || []).slice(0, 45)} extra />}
          {!unavailable && tab === "park" && <BreakTable rows={br.park || []} />}
          {!unavailable && tab === "team" && <BreakTable rows={br.team || []} rpg />}
          {!unavailable && tab === "starter" && <BreakTable rows={(br.starter || []).slice(0, 40)} rpg />}
          {!unavailable && tab === "homeAway" && <BreakTable rows={br.homeAway || []} />}
          {!unavailable && tab === "version" && <BreakTable rows={br.version || []} extra />}
          {!unavailable && tab === "checkpoint" && <BreakTable rows={br.checkpoint || []} extra />}
          {!unavailable && tab === "week" && <BreakTable rows={br.week || []} extra />}
          {!unavailable && tab === "conference" && <BreakTable rows={br.conference || []} extra />}
          {!unavailable && tab === "favDog" && <BreakTable rows={br.favDog || []} extra />}
          {!unavailable && tab === "spreadRange" && <BreakTable rows={br.spreadRange || []} extra />}

          <div style={{ marginTop: 12 }}>
            <button className="header-btn header-btn-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? "Loading…" : "Reload SYS"}
            </button>
          </div>
        </div>
      </section>

      <section id="clv-tracker" className="panel">
        <div className="panel-header">
          <h2>CLV Tracker</h2>
          <span className="last-updated">{report?.clv?.n ?? 0} valid Pin entry+close</span>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginBottom: 8 }}>
            Population: tickets with valid entry and close benchmark data for identical market contracts.
          </p>
          <p className="headline-line">
            {unavailable
              ? "CLV unavailable because authoritative strategy/ticket population is unavailable."
              : report?.clv?.unavailable
              ? report.clv.message || "No tickets have both a valid Pinnacle entry and close yet."
              : `Avg CLV ${fmtSigned(report?.clv?.avg, 3)} · positive share ${fmtPct(report?.clv?.positiveShare)}.`}
          </p>
          <p className="muted">CLV is close no-vig − entry no-vig, same side. Independent of W/L. Heritage Current Line is not Pin close.</p>
          <h3 className="subhead">FBIS-HC-v1 strategy tickets</h3>
          <div className="status-grid">
            <Stat label="Valid CLV N" value={valueOrUnavailable(unavailable, report?.clv?.validClv ?? 0)} />
            <Stat label="Missing entry" value={report?.clv?.missingEntry ?? 0} />
            <Stat label="Missing close" value={report?.clv?.missingClose ?? 0} />
            <Stat label="Line mismatch" value={report?.clv?.lineMismatch ?? 0} />
            <Stat label="Coverage" value={fmtPct(report?.clv?.coveragePct)} />
          </div>
          <PopulationDescriptor descriptor={report?.population?.strategy} title="CLV/strategy population descriptor" />
          <h3 className="subhead">Heritage executed bets</h3>
          <p className="muted">Separate population: bets actually entered at Heritage. These numbers are never merged into FBIS-HC-v1 strategy results.</p>
          <div className="status-grid">
            <Stat label="Bets" value={report?.executedBets?.summary?.bets ?? "—"} />
            <Stat label="Settled" value={report?.executedBets?.summary?.settled ?? "—"} />
            <Stat label="Open" value={report?.executedBets?.summary?.open ?? "—"} />
            <Stat label="Valid CLV N" value={report?.executedBets?.summary?.validClvN ?? "—"} />
            <Stat label="Avg CLV" value={fmtSigned(report?.executedBets?.summary?.avgClv)} />
          </div>
        </div>
      </section>

      <section id="model-diagnostics" className="panel">
        <div className="panel-header">
          <h2>Model Diagnostics · layers</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="last-updated">{report?.layers?.leader ? `leader ${report.layers.leader}` : "N=0"}</span>
            <button className="header-btn" onClick={() => togglePanel("model")}>{openPanels.model ? "Collapse" : "Expand"}</button>
          </div>
        </div>
        {openPanels.model ? <div className="panel-body">
          <p className="muted">Population: frozen forecast rows with final outcomes. {report?.layers?.note || "Layer leader is lowest Brier on frozen forecasts. Closest-to-binary counts are not used."}</p>
          <div className="table-scroll"><table className="fbis-table">
            <thead>
              <tr>
                <th>Layer</th>
                <th>N</th>
                <th>Brier</th>
                <th>Log loss</th>
                <th>Winner</th>
              </tr>
            </thead>
            <tbody>
              {(report?.layers?.layers || []).map((row) => (
                <tr key={row.layer} className={row.layer === report?.layers?.leader ? "won-row" : ""}>
                  <td>{row.layer}</td>
                  <td>{row.unavailable ? "N=0 — unavailable" : row.n}</td>
                  <td>{fmtNum(row.brier, 3)}</td>
                  <td>{fmtNum(row.logLoss, 3)}</td>
                  <td>{fmtPct(row.winnerHit)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div> : null}
      </section>

      <section id="sys-anomalies" className="panel">
        <div className="panel-header">
          <h2>Historical EV anomalies</h2>
          <span className="last-updated">
            {report?.anomalies?.available ? `${report?.anomalies?.count || 0} findings` : "Unavailable"}
          </span>
        </div>
        <div className="panel-body">
          {filters?.includeAnomalies !== "1" ? (
            <div style={{ marginBottom: 8 }}>
              <button className="header-btn" onClick={() => onFilters?.({ includeAnomalies: "1" })}>Load anomaly sample</button>
              <span className="muted" style={{ marginLeft: 8 }}>Loads bounded anomaly rows only on demand to reduce D1 read usage.</span>
            </div>
          ) : null}
          {!report?.anomalies?.available ? (
            <p className="error">
              EV anomaly audit unavailable: {report?.anomalies?.blockedReason || "blocked"} · migration {report?.anomalies?.migrationStatus || "MIGRATION UNVERIFIED"}.
            </p>
          ) : (
            <>
              <p className="muted">
                Findings summary: {report?.anomalies?.count || 0} findings across {report?.anomalies?.uniqueAffectedTickets || 0} unique tickets
                {report?.anomalies?.averageFindingsPerAffectedTicket ? ` · avg ${Number(report.anomalies.averageFindingsPerAffectedTicket).toFixed(2)} findings/affected ticket` : ""}
                {report?.anomalies?.maxFindingsPerTicket ? ` · max ${report.anomalies.maxFindingsPerTicket} on one ticket` : ""}.
              </p>
              <p className="muted">
                Source rows scanned: {report?.anomalies?.sourceRowsScanned ?? "—"} · unique tickets without anomaly: {report?.anomalies?.uniqueSourceTicketsWithoutAnomaly ?? "—"}.
              </p>
              <p className="muted">Counts by reason: {fmtMapSummary(report?.anomalies?.byReason)}</p>
              <p className="muted">By sport: {fmtMapSummary(report?.anomalies?.bySport)}</p>
              <p className="muted">By market family: {fmtMapSummary(report?.anomalies?.byMarketFamily)} · period: {fmtMapSummary(report?.anomalies?.byPeriodFamily)}</p>
              <p className="muted">By model: {fmtMapSummary(report?.anomalies?.byModelVersion)} · qual rule: {fmtMapSummary(report?.anomalies?.byQualificationRuleVersion)} · checkpoint: {fmtMapSummary(report?.anomalies?.byCheckpoint)}</p>
              <p className="muted">By date: {fmtMapSummary(report?.anomalies?.byDate)}</p>
              <p className="muted">
                Ticket status impact: qualified {report?.anomalies?.qualifiedCount || 0} · strategy-entered {report?.anomalies?.enteredStrategyCount || 0} · settled {report?.anomalies?.settledAffectedTickets || 0} · open {report?.anomalies?.openAffectedTickets || 0} · won {report?.anomalies?.winningAffectedTickets || 0} · lost {report?.anomalies?.losingAffectedTickets || 0} · unresolved {report?.anomalies?.unresolvedAffectedTickets || 0}
              </p>
              {(report?.anomalies?.ruleCatalog && Object.keys(report.anomalies.ruleCatalog).length) ? (
                <details style={{ marginBottom: 10 }}>
                  <summary>Anomaly rule classification</summary>
                  <div className="table-scroll"><table className="fbis-table">
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Severity</th>
                        <th>Meaning</th>
                        <th>Quarantine</th>
                        <th>Eligible after review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(report.anomalies.ruleCatalog).map((rule) => (
                        <tr key={rule.id}>
                          <td>{rule.id}</td>
                          <td>{rule.severity}</td>
                          <td>{rule.meaning}</td>
                          <td>{rule.mustQuarantine ? "yes" : "no"}</td>
                          <td>{rule.mayRemainEligibleAfterReview ? "yes" : "no"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                </details>
              ) : null}
              <div className="table-scroll"><table className="fbis-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Entity</th>
                    <th>Sport</th>
                    <th>Market</th>
                    <th>Stored ROI</th>
                    <th>Recomputed ROI</th>
                    <th>Reason</th>
                    <th>Disposition</th>
                  </tr>
                </thead>
                <tbody>
                  {(report?.anomalies?.rows || []).slice(0, 30).map((r) => (
                    <tr key={r.id}>
                      <td className="muted">{r.entityId}</td>
                      <td>{r.entityType}</td>
                      <td>{String(r.sport || "").toUpperCase()}</td>
                      <td>{r.market || "—"} {r.side || ""}</td>
                      <td>{r.storedEv == null ? "—" : fmtPct(r.storedEv)}</td>
                      <td>{r.recomputedEv == null ? "—" : fmtPct(r.recomputedEv)}</td>
                      <td>{r.anomalyReason}</td>
                      <td>{r.disposition}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </>
          )}
        </div>
      </section>

      <section id="projection-method" className="panel">
        <div className="panel-header">
          <h2>How projections are made</h2>
          <button className="header-btn" onClick={() => togglePanel("guide")}>{openPanels.guide ? "Collapse" : "Expand"}</button>
        </div>
        {openPanels.guide ? <div className="panel-body">
          <div className="glossary-grid">
            {BOARD_SPORTS.map((id) => {
              const g = guide[id] || {};
              return (
                <article className="g-card" key={id}>
                  <h3>{SPORTS[id].label} — {g.engine || "—"}</h3>
                  <p>{g.body}</p>
                </article>
              );
            })}
          </div>
        </div> : null}
      </section>

      <section id="calibration-favorite" className="panel">
        <div className="panel-header">
          <h2>Calibration (favorite confidence)</h2>
          <button className="header-btn" onClick={() => togglePanel("calFav")}>{openPanels.calFav ? "Collapse" : "Expand"}</button>
        </div>
        {openPanels.calFav ? <div className="panel-body" style={{ padding: 0 }}>
          {!(acc.calibration || []).some((b) => b.n) ? (
            <div className="empty">Buckets fill after graded games freeze the final FBIS probability. Home p below 50% is included as the favorite side.</div>
          ) : (
            <div className="table-scroll"><table className="fbis-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>N</th>
                  <th>Predicted</th>
                  <th>Actual</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {(acc.calibration || []).map((b) => (
                  <tr key={b.bucket}>
                    <td>{b.bucket}</td>
                    <td>{b.n}</td>
                    <td>{fmtPct(b.predicted)}</td>
                    <td>{fmtPct(b.actual)}</td>
                    <td className={errClass((b.error || 0) * 10)}>{fmtSigned(b.error != null ? b.error * 100 : null, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div> : null}
      </section>

      <section id="calibration-home" className="panel">
        <div className="panel-header">
          <h2>Calibration (home win %)</h2>
          <button className="header-btn" onClick={() => togglePanel("calHome")}>{openPanels.calHome ? "Collapse" : "Expand"}</button>
        </div>
        {openPanels.calHome ? <div className="panel-body" style={{ padding: 0 }}>
          {!(acc.calibrationHome || []).some((b) => b.n) ? (
            <div className="empty">0–10 through 90–100 home-win buckets. Underdogs are no longer dropped.</div>
          ) : (
            <div className="table-scroll"><table className="fbis-table">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>N</th>
                  <th>Predicted</th>
                  <th>Actual</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {(acc.calibrationHome || []).map((b) => (
                  <tr key={b.bucket}>
                    <td>{b.bucket}</td>
                    <td>{b.n}</td>
                    <td>{fmtPct(b.predicted)}</td>
                    <td>{fmtPct(b.actual)}</td>
                    <td className={errClass((b.error || 0) * 10)}>{fmtSigned(b.error != null ? b.error * 100 : null, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div> : null}
      </section>

      <section id="by-sport" className="panel">
        <div className="panel-header">
          <h2>By sport</h2>
          <button className="header-btn" onClick={() => togglePanel("bySport")}>{openPanels.bySport ? "Collapse" : "Expand"}</button>
        </div>
        {openPanels.bySport ? <div className="panel-body" style={{ padding: 0 }}>
          <div className="table-scroll"><table className="fbis-table">
            <thead>
              <tr>
                <th>Board</th>
                <th>Engine</th>
                <th>N</th>
                <th>MAE tot</th>
                <th>MAE mgn</th>
                <th>Bias</th>
                <th>Brier</th>
                <th>Score hit</th>
                <th>Prob hit</th>
              </tr>
            </thead>
            <tbody>
              {(report?.sports || []).map((s) => (
                <tr key={s.sport}>
                  <td>{s.sportName}</td>
                  <td className="muted">{s.recipe?.engine || "—"}</td>
                  <td>{s.accuracy?.n ?? 0}</td>
                  <td>{fmtNum(s.accuracy?.maeTotal)}</td>
                  <td>{fmtNum(s.accuracy?.maeMargin)}</td>
                  <td>{fmtSigned(s.accuracy?.biasTotal)}</td>
                  <td>{fmtNum(s.accuracy?.brierModel, 3)}</td>
                  <td>{fmtPct(s.accuracy?.winnerHitScore ?? s.accuracy?.winnerHit)}</td>
                  <td>{fmtPct(s.accuracy?.winnerHitProb)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div> : null}
      </section>

      <section id="projection-vs-final" className="panel">
        <div className="panel-header">
          <h2>Projection vs final</h2>
          <span className="last-updated">{graded.length} graded · {open.length} waiting</span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!games.length ? (
            <div className="empty">No frozen projections in this window. Collection is scheduled — opening the board is not required.</div>
          ) : (
            (gamesBySport.length ? gamesBySport : [{ sport: "all", label: "All sports", rows: games.slice(0, 120) }]).map((group) => (
              <div key={`pvf-${group.sport}`}>
                <h3 className="subhead" style={{ margin: "12px 12px 4px" }}>
                  {group.label} · {group.rows.length}
                </h3>
                {compact ? (
                  <div className="mobile-card-list">
                    {(group.rows || []).slice(0, 80).map((g) => (
                      <article key={rowKey(g)} className="mobile-card">
                        <div className="mobile-card-head">
                          <b>{canonicalMatchup(g)}</b>
                          <span className="muted">{g.status}</span>
                        </div>
                        <div className="muted">{g.date} · {g.checkpoint || "—"}</div>
                        <div className="mobile-kv-grid" style={{ marginTop: 8 }}>
                          <div><small>FBIS</small><b>{fmtNum(g.projAway)} – {fmtNum(g.projHome)}</b></div>
                          <div><small>Pal</small><b>{g.palAway != null ? `${fmtNum(g.palAway)} – ${fmtNum(g.palHome)}` : "—"}</b></div>
                          <div><small>Actual</small><b>{g.actualHome == null ? "—" : `${fmtNum(g.actualAway, 0)} – ${fmtNum(g.actualHome, 0)}`}</b></div>
                          <div><small>Δ total</small><b className={errClass(g.errTotal)}>{fmtSigned(g.errTotal)}</b></div>
                          <div><small>Δ margin</small><b className={errClass(g.errMargin)}>{fmtSigned(g.errMargin)}</b></div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : <div className="table-scroll"><table className="fbis-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Game</th>
                      <th>Cp</th>
                      <th>FBIS</th>
                      <th>Pal</th>
                      <th>Actual</th>
                      <th>Δ tot</th>
                      <th>Δ mgn</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(group.rows || []).slice(0, 80).map((g) => (
                      <tr key={rowKey(g)} title={(g.steps || []).join("\n")}>
                        <td className="muted">{g.date}</td>
                        <td>{canonicalMatchup(g)}</td>
                        <td className="muted">{g.checkpoint || "—"}</td>
                        <td className="text-blue">{fmtNum(g.projAway)} – {fmtNum(g.projHome)}</td>
                        <td className="muted">{g.palAway != null ? `${fmtNum(g.palAway)} – ${fmtNum(g.palHome)}` : "—"}</td>
                        <td>{g.actualHome == null ? "—" : `${fmtNum(g.actualAway, 0)} – ${fmtNum(g.actualHome, 0)}`}</td>
                        <td className={errClass(g.errTotal)}>{fmtSigned(g.errTotal)}</td>
                        <td className={errClass(g.errMargin)}>{fmtSigned(g.errMargin)}</td>
                        <td className="muted">{g.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>}
              </div>
            ))
          )}
        </div>
      </section>
        </>
      ) : null}
    </div>
  );
}

function Filter({ label, children }) {
  return (
    <label className="filter-item">
      <span>{label}</span>
      {children}
    </label>
  );
}

function MetricTable({ rows }) {
  return (
    <div className="table-scroll"><table className="fbis-table">
      <thead>
        <tr>
          <th>Projection</th>
          <th>N</th>
          <th>Actual</th>
          <th>FBIS</th>
          <th>Diff</th>
          <th>% Diff</th>
          <th>MAE</th>
          <th>Median Abs</th>
          <th>RMSE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>{r.n || 0}</td>
            <td>{fmtNum(r.actual)}</td>
            <td>{fmtNum(r.projected)}</td>
            <td className={errClass(r.diff)}>{fmtSigned(r.diff)}</td>
            <td className={errClass((r.pctDiff || 0) * 10)}>{fmtPctSigned(r.pctDiff)}</td>
            <td>{fmtNum(r.mae)}</td>
            <td>{fmtNum(r.medianAbs)}</td>
            <td>{fmtNum(r.rmse)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function DistBlock({ dist }) {
  const blocks = [
    ["Total", dist.total],
    ["Team score", dist.team],
    ["Margin", dist.margin],
  ];
  return (
    <div className="dist-grid">
      {blocks.map(([label, block]) => (
        <div key={label}>
          <b>{label}{dist.sport && dist.sport !== "mlb" ? ` · ${String(dist.sport).toUpperCase()}` : ""}</b>
          <ul>
            {(block?.bands || []).length
              ? block.bands.map((b) => (
                  <li key={b.threshold}>{b.label} · {fmtPct(b.share)}</li>
                ))
              : (
                <>
                  <li>Within 0.5 · {fmtPct(block?.within05)}</li>
                  <li>Within 1 · {fmtPct(block?.within1)}</li>
                  <li>Within 2 · {fmtPct(block?.within2)}</li>
                </>
              )}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ModelsTable({ models }) {
  return (
    <div className="table-scroll"><table className="fbis-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>N</th>
          <th>Total MAE</th>
          <th>Team MAE</th>
          <th>Margin MAE</th>
          <th>RMSE</th>
          <th>Bias</th>
          <th>Brier</th>
          <th>Log loss</th>
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <tr key={m.key} className={m.key === "ensemble" ? "won-row" : ""}>
            <td>{m.label}</td>
            <td>{m.unavailable ? "N=0 — unavailable" : (m.n || 0)}</td>
            <td>{fmtNum(m.maeTotal)}</td>
            <td>{fmtNum(m.maeTeam)}</td>
            <td>{fmtNum(m.maeMargin)}</td>
            <td>{fmtNum(m.rmse)}</td>
            <td>{fmtSigned(m.bias)}</td>
            <td>{fmtNum(m.brier, 3)}</td>
            <td>{fmtNum(m.logLoss, 3)}</td>
            <td>{fmtPct(m.winnerHit)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function SliceTable({ rows }) {
  return (
    <div className="table-scroll"><table className="fbis-table">
      <thead>
        <tr>
          <th>Slice</th>
          <th>N</th>
          <th>% Diff</th>
          <th>Bias</th>
          <th>MAE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td>{r.n || 0}</td>
            <td>{fmtPctSigned(r.pctDiff)}</td>
            <td>{fmtSigned(r.bias)}</td>
            <td>{fmtNum(r.mae)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function BreakTable({ rows, extra, rpg }) {
  return (
    <div className="table-scroll"><table className="fbis-table">
      <thead>
        <tr>
          <th>{rpg ? "Name" : "Group"}</th>
          <th>N</th>
          <th>{rpg ? "Actual RPG" : "Actual"}</th>
          <th>{rpg ? "FBIS RPG" : "Projected"}</th>
          <th>Bias</th>
          <th>MAE</th>
          {extra && <th>Margin MAE</th>}
          {extra && <th>Brier</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label || r.key}</td>
            <td>{r.n || 0}</td>
            <td>{fmtNum(r.actual)}</td>
            <td>{fmtNum(r.projected)}</td>
            <td className={errClass(r.bias)}>{fmtSigned(r.bias)}</td>
            <td>{fmtNum(r.mae)}</td>
            {extra && <td>{fmtNum(r.maeMargin)}</td>}
            {extra && <td>{fmtNum(r.brier, 3)}</td>}
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function RollingTable({ rows }) {
  return (
    <div className="table-scroll"><table className="fbis-table">
      <thead>
        <tr>
          <th>Through</th>
          <th>N</th>
          <th>MAE</th>
          <th>Brier</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.date}:${i}`}>
            <td>{r.date}</td>
            <td>{r.n}</td>
            <td>{fmtNum(r.mae)}</td>
            <td>{fmtNum(r.brier, 3)}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function fmtMetric(block, signed) {
  if (block == null) return "—";
  if (typeof block === "object" && "n" in block) {
    if (!block.n) return `N=0 — unavailable`;
    const v = signed ? fmtSigned(block.value) : fmtPct(block.value);
    return `${v} (N=${block.n})`;
  }
  return signed ? fmtSigned(block) : fmtPct(block);
}

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function fmtTs(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtPctSigned(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const pct = Number(n) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function errClass(n) {
  if (n == null) return "muted";
  const a = Math.abs(n);
  if (a < 0.6) return "text-green";
  if (a > 2) return "text-red";
  return "";
}

function OverBlock({ over }) {
  if (!over) return null;
  const palBias = over.bias?.pal;
  const fbisBias = over.bias?.proprietary?.value ?? over.bias?.proprietary;
  return (
    <div>
      <p className="muted" style={{ marginBottom: 8 }}>
        Candidates are model-vs-market disagreements, not bets. Qualified still requires +EV. Totals are not lowered from this table.
      </p>
      <div className="status-grid" style={{ marginBottom: 10 }}>
        <Stat label="Pin total N" value={over.nWithPinTotal ?? over.n ?? 0} />
        <Stat label="Missing pin total" value={over.nMissingPinTotal ?? 0} />
        <Stat label="OVER candidates" value={over.candidates?.over ?? 0} />
        <Stat label="UNDER candidates" value={over.candidates?.under ?? 0} />
        <Stat label="Qualified OVER" value={over.qualified?.over ?? 0} />
        <Stat label="Qualified UNDER" value={over.qualified?.under ?? 0} />
        <Stat label="Settled N" value={over.settled?.n ?? 0} />
        <Stat label="OVER Expected ROI" value={fmtMetric(over.avgEv?.over)} />
        <Stat label="UNDER Expected ROI" value={fmtMetric(over.avgEv?.under)} />
        <Stat label="OVER ROI" value={fmtMetric(over.roi?.over, true)} />
        <Stat label="UNDER ROI" value={fmtMetric(over.roi?.under, true)} />
        <Stat label="OVER CLV" value={fmtMetric(over.clv?.over, true)} />
        <Stat label="UNDER CLV" value={fmtMetric(over.clv?.under, true)} />
        <Stat label="FBIS total bias" value={fmtSigned(fbisBias)} />
        <Stat
          label="Pal total bias"
          value={palBias?.unavailable || palBias?.n === 0 ? "N=0 unavailable" : fmtSigned(palBias?.value ?? palBias)}
        />
      </div>
      <div className="table-scroll"><table className="fbis-table">
        <thead>
          <tr>
            <th>Disagreement</th>
            <th>N</th>
            <th>Actual avg</th>
            <th>Projected avg</th>
            <th>MAE</th>
            <th>Bias</th>
            <th>Over rate</th>
          </tr>
        </thead>
        <tbody>
          {(over.buckets || []).map((b) => (
            <tr key={b.key}>
              <td>{b.label}</td>
              <td>{b.n}</td>
              <td>{fmtNum(b.actualAvg)}</td>
              <td>{fmtNum(b.projectedAvg)}</td>
              <td>{fmtNum(b.mae)}</td>
              <td>{fmtSigned(b.bias)}</td>
              <td>{fmtPct(b.overRate)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function fmtRecord(stats) {
  if (!stats) return "—";
  const w = Number(stats.wins || 0);
  const l = Number(stats.losses || 0);
  const p = Number(stats.pushes || 0);
  let s = `${w}-${l}`;
  if (p) s += `-${p}`;
  return s;
}

function convictionStatsForGroup(group) {
  if (group?.convictionStats) return group.convictionStats;
  const tickets = (group?.tickets || []).filter((t) => String(t.tag || "").toUpperCase() === "CONVICTION");
  if (!tickets.length && group?.stats) return group.stats;
  const settled = tickets.filter((t) => t.result === "WON" || t.result === "LOST");
  const wins = settled.filter((t) => t.result === "WON").length;
  const losses = settled.filter((t) => t.result === "LOST").length;
  return {
    n: tickets.length,
    open: tickets.filter((t) => !t.result || t.result === "OPEN").length,
    settled: settled.length,
    wins,
    losses,
    pushes: tickets.filter((t) => t.result === "PUSH").length,
    voids: tickets.filter((t) => t.result === "VOID").length,
    hitRate: settled.length ? wins / settled.length : null,
  };
}

function ConvictionScoreboard({ rows }) {
  if (!rows.length) {
    return <p className="muted">No conviction tickets yet.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="fbis-table sys-scoreboard">
        <thead>
          <tr>
            <th>Sport</th>
            <th>Record</th>
            <th>Hit rate</th>
            <th>Open</th>
            <th>Void</th>
            <th>Settled</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((group) => {
            const s = convictionStatsForGroup(group);
            return (
              <tr key={`conv-${group.sport}`}>
                <td>
                  <strong>{group.label || String(group.sport || "").toUpperCase()}</strong>
                </td>
                <td>{fmtRecord(s)}</td>
                <td>{Number(s.settled || 0) > 0 ? fmtPct(s.hitRate) : "—"}</td>
                <td>{s.open ?? 0}</td>
                <td>{s.voids ?? 0}</td>
                <td>{s.settled ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdvisorAnalyticsPanel({reloadKey=""}) {
  const [data,setData]=useState(null);
  useEffect(()=>{const ac=new AbortController();fetch(`/api/bets?_t=${Date.now()}`,{signal:ac.signal}).then(r=>r.json()).then(setData).catch(()=>{});return()=>ac.abort();},[reloadKey]);
  const bets=data?.bets||[];
  const summarize=(rows)=>{
    const decided=rows.filter(x=>["WON","LOST"].includes(x.result)); const wins=decided.filter(x=>x.result==="WON").length;
    const profit=rows.map(x=>x.profit).filter(x=>Number.isFinite(Number(x))).reduce((a,b)=>a+Number(b),0);
    const risk=rows.filter(x=>["WON","LOST","PUSH","VOID"].includes(x.result)).reduce((a,b)=>a+(Number(b.riskAmount)||0),0);
    const clv=rows.map(x=>Number(x.clv)).filter(Number.isFinite);
    return {n:rows.length,decided:decided.length,record:decided.length?`${wins}-${decided.length-wins}`:"—",hit:decided.length?wins/decided.length:null,
      profit,risk,roi:risk?profit/risk:null,clvN:clv.length,avgClv:clv.length?clv.reduce((a,b)=>a+b,0)/clv.length:null};
  };
  const advisor=bets.filter(x=>x.advisorDecision || x.trackerMetadata?.advisorReviewed);
  const model=bets.filter(x=>!x.advisorDecision && (x.matchedPredictionId||x.modelVersionAtEntry||x.recommendationStatus==="QUALIFIED"));
  const a=summarize(advisor),m=summarize(model);
  const entries=data?.entries||[];
  return <section className="panel" id="advisor-analytics"><div className="panel-header"><h2>Advisor vs model</h2><span className="last-updated">frozen pre-execution cohorts</span></div>
    <div className="panel-body">
      <p className="muted">ChatGPT rows count only when a frozen advisor review existed before execution. Model-only rows require FBIS attribution and no advisor freeze. Small samples are descriptive only.</p>
      <div className="table-scroll"><table className="fbis-table"><thead><tr><th>Cohort</th><th>N</th><th>Record</th><th>Hit</th><th>Profit</th><th>ROI</th><th>CLV N</th><th>Avg CLV</th></tr></thead>
      <tbody>{[["ChatGPT-reviewed",a],["FBIS model-only",m]].map(([label,x])=><tr key={label}><td><b>{label}</b></td><td>{x.n}</td><td>{x.record}</td><td>{x.hit==null?"—":fmtPct(x.hit)}</td><td>{fmtSigned(x.profit,2)}</td><td>{x.roi==null?"—":fmtPct(x.roi)}</td><td>{x.clvN}</td><td>{x.avgClv==null?"—":fmtSigned(x.avgClv,3)}</td></tr>)}</tbody></table></div>
      <div className="status-grid" style={{marginTop:12}}><Stat label="Parent cards / parlays" value={entries.length}/><Stat label="Exception queue" value={data?.exceptions?.length??0}/><Stat label="CLV coverage" value={bets.length?fmtPct(bets.filter(x=>x.clv!=null).length/bets.length):"—"}/></div>
    </div></section>;
}

function HeritageExecutedPanel({ summary, unavailable }) {
  const bySport = summary?.bySport && typeof summary.bySport === "object" ? summary.bySport : {};
  const sportRows = Object.keys(bySport)
    .sort()
    .map((sport) => ({ sport, ...(bySport[sport] || {}) }));

  return (
    <section id="your-picks" className="panel">
      <div className="panel-header">
        <h2>Your picks · unified ledger</h2>
        <span className="last-updated">
          {unavailable ? "Unavailable" : `${summary?.bets ?? 0} tickets`}
        </span>
      </div>
      <div className="panel-body">
        <p className="muted" style={{ marginBottom: 10 }}>
          Confirmed executions across connected/imported platforms — separate from research-only FBIS strategy results.
        </p>
        {unavailable ? (
          <p className="error">Executed-bet summary unavailable until SYS recovers.</p>
        ) : !summary || !(summary.bets > 0) ? (
          <p className="muted">No executed bets yet. Confirm picks from Research to start the tally.</p>
        ) : (
          <>
            <div className="status-grid" style={{ marginBottom: 12 }}>
              <Stat label="Record" value={summary.record || `${summary.wins ?? 0}-${summary.losses ?? 0}`} />
              <Stat label="Hit rate" value={Number(summary.decided || 0) > 0 ? fmtPct(summary.hitRate) : "—"} />
              <Stat label="Open" value={summary.open ?? 0} />
              <Stat label="Push / Void" value={`${summary.pushes ?? 0} / ${summary.voids ?? 0}`} />
              <Stat label="Profit" value={summary.profit == null ? "—" : fmtSigned(summary.profit, 2)} />
              <Stat label="ROI" value={summary.roi == null ? "—" : fmtPct(summary.roi)} />
              <Stat label="Risk" value={summary.risk == null ? "—" : `$${Number(summary.risk).toFixed(2)}`} />
              <Stat label="Tickets" value={summary.bets ?? 0} />
            </div>
            {sportRows.length ? (
              <>
                <h3 className="subhead">By sport</h3>
                <div className="table-scroll">
                  <table className="fbis-table sys-scoreboard">
                    <thead>
                      <tr>
                        <th>Sport</th>
                        <th>Record</th>
                        <th>Hit rate</th>
                        <th>Open</th>
                        <th>Profit</th>
                        <th>Tickets</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sportRows.map((row) => (
                        <tr key={`exec-${row.sport}`}>
                          <td>
                            <strong>{SPORTS[row.sport]?.label || String(row.sport || "").toUpperCase()}</strong>
                          </td>
                          <td>
                            {row.record || `${row.wins ?? 0}-${row.losses ?? 0}`}
                            {row.voids ? ` (${row.voids} void)` : ""}
                          </td>
                          <td>{Number(row.decided || 0) > 0 ? fmtPct(row.hitRate) : "—"}</td>
                          <td>{row.open ?? 0}</td>
                          <td>{row.profit == null ? "—" : fmtSigned(row.profit, 2)}</td>
                          <td>{row.bets ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {summary.message ? <p className="muted" style={{ marginTop: 8 }}>{summary.message}</p> : null}
          </>
        )}
      </div>
    </section>
  );
}

function StrategyPanel({ sectionId = "", reloadKey = "" }) {
  const [pack, setPack] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [attemptAt, setAttemptAt] = useState("");
  const [lastSuccessAt, setLastSuccessAt] = useState("");
  const [showDetail, setShowDetail] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    setAttemptAt(new Date().toISOString());
    setLoadError("");
    fetch(`/api/strategy?_t=${Date.now()}`, { signal: ac.signal })
      .then(async (r) => {
        const text = await r.text();
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { throw new Error("Strategy endpoint returned invalid JSON"); }
        if (!r.ok || data?.error) throw new Error(data?.error || `HTTP ${r.status}`);
        if (data?.health?.state === "UNAVAILABLE") {
          throw new Error(`strategy unavailable: ${(data?.health?.failures || []).map((f) => `${f.name}=${f.detail || "failed"}`).join(" · ") || "authoritative data unavailable"}`);
        }
        return data;
      })
      .then((d) => {
        setPack(d);
        setLastSuccessAt(new Date().toISOString());
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setLoadError(String(err?.message || err));
      });
    return () => ac.abort();
  }, [reloadKey]);
  const seed = pack?.seed || { tickets: [], stats: {}, traits: {} };
  const seedBySport = splitRowsBySport(seed.tickets || []);
  const pro = pack?.prospective || { tickets: [], stats: null, traits: {} };
  const proBySport = pack?.prospectiveBySport || [];
  const rec = pack?.reconstruction || {};
  const integrity = pack?.integrity || {};
  const cohort = pack?.yesterdayConvictionCohort || null;
  const semanticUnavailable = Boolean(loadError);
  const scoreboardRows = proBySport.length
    ? proBySport
    : pro.tickets?.length
      ? splitRowsBySport(pro.tickets).map((g) => ({ ...g, tickets: g.rows, label: g.label }))
      : [];
  const totals = scoreboardRows.reduce(
    (acc, g) => {
      const s = convictionStatsForGroup(g);
      acc.wins += Number(s.wins || 0);
      acc.losses += Number(s.losses || 0);
      acc.open += Number(s.open || 0);
      acc.settled += Number(s.settled || 0);
      acc.n += Number(s.n || 0);
      acc.pushes += Number(s.pushes || 0);
      acc.voids += Number(s.voids || 0);
      return acc;
    },
    { wins: 0, losses: 0, open: 0, settled: 0, n: 0, pushes: 0, voids: 0 }
  );

  return (
    <section id={sectionId || undefined} className="panel">
      <div className="panel-header">
        <h2>Conviction by sport</h2>
        <span className="last-updated">
          {semanticUnavailable
            ? "DATA UNAVAILABLE"
            : `${totals.wins}-${totals.losses} settled · ${totals.open} open`}
        </span>
      </div>
      <div className="panel-body">
        {semanticUnavailable ? (
          <div className="error" style={{ marginBottom: 10 }}>
            Strategy unavailable: {loadError}
          </div>
        ) : null}

        {!semanticUnavailable ? (
          <>
            <ConvictionScoreboard rows={scoreboardRows} />
            {cohort ? (
              <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
                Yesterday ({cohort.targetDateCt || "CT"}): {cohort.wins ?? 0}-{cohort.losses ?? 0}
                {" · "}settled {cohort.settledN ?? 0} · open {cohort.openN ?? 0}
              </p>
            ) : null}
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              FBIS-HC-v1 research conviction only — not Heritage confirms.
              {pack?.convictionQualification?.paused ? " Qualification paused." : ""}
            </p>
          </>
        ) : (
          <p className="muted">Scoreboard waits on a successful strategy query.</p>
        )}

        <div id="strategy-seed-prospective" style={{ marginTop: 12 }}>
          <button type="button" className="header-btn" onClick={() => setShowDetail((v) => !v)}>
            {showDetail ? "Hide strategy detail" : "Show strategy detail"}
          </button>
        </div>

        {showDetail && !semanticUnavailable ? (
          <div style={{ marginTop: 12 }}>
            {pro.aggregateUnavailable ? (
              <p className="muted">Mixed markets/models — use per-sport rows above (no blended aggregate).</p>
            ) : pro.stats ? (
              <p className="muted">
                Aggregate: {fmtRecord(pro.stats)} · hit {fmtPct(pro.stats.hitRate)} · ROI {fmtSigned(pro.stats.roi)} · CLV N={pro.stats.clvN ?? 0}
              </p>
            ) : null}
            <p className="muted" style={{ marginBottom: 10 }}>
              Seed recovery: expected N={pack?.expectedSeedN ?? 7} · recovered {pack?.actualRecoveredN ?? rec.recoveredN ?? 0} ·{" "}
              {rec.state || rec.confidence || "operator-declared"} · recovered record {pack?.recoveredRecord || rec.recoveredRecord || "—"} ·
              graded {pack?.gradedRecord || rec.gradedRecord || "—"}. Operator-reported {pack?.reportedRecord || "7-0"} is not calculated performance.
            </p>
            <PopulationDescriptor descriptor={pack?.population?.prospective} title="Strategy prospective population descriptor" />
            <h3 className="subhead">Prospective integrity</h3>
            <div className="status-grid" style={{ marginBottom: 12 }}>
              <Stat label="Open tickets" value={integrity.open ?? 0} />
              <Stat label="Settled tickets" value={integrity.settled ?? 0} />
              <Stat label="Unresolved finals" value={integrity.unresolved ?? 0} />
              <Stat label="Pushes" value={integrity.pushes ?? 0} />
              <Stat label="Voids" value={integrity.voids ?? 0} />
              <Stat label="Duplicates excluded" value={integrity.duplicatesExcluded ?? 0} />
              <Stat label="Provenance invalid" value={integrity.invalid ?? 0} />
              <Stat label="Provenance quarantined" value={integrity.quarantined ?? 0} />
            </div>
            <p className="muted" style={{ marginBottom: 8 }}>
              Breakdown sport={fmtMapSummary(integrity.breakdowns?.sport)} · market={fmtMapSummary(integrity.breakdowns?.marketFamily)} · period={fmtMapSummary(integrity.breakdowns?.periodFamily)} · model={fmtMapSummary(integrity.breakdowns?.modelVersion)} · qual={fmtMapSummary(integrity.breakdowns?.qualificationRuleVersion)}
            </p>
            <h3 className="subhead">Seed traits</h3>
            <TraitLine traits={seed.traits} />
            <h3 className="subhead">Seed tickets</h3>
            {(seedBySport.length ? seedBySport : [{ sport: "all", label: "All sports", rows: seed.tickets || [] }]).map((group) => (
              <div key={`seed-${group.sport}`}>
                <p className="muted" style={{ marginBottom: 8 }}>
                  {group.label}: N={group.rows?.length || 0}
                </p>
                <TicketTable rows={group.rows || []} empty={`No ${group.label} seed tickets.`} />
              </div>
            ))}
            <h3 className="subhead">Prospective tickets</h3>
            {(proBySport.length ? proBySport : [{ sport: "all", label: "All sports", tickets: pro.tickets || [], stats: pro.stats || {} }]).map((group) => {
              const cs = convictionStatsForGroup(group);
              return (
                <div key={`pro-${group.sport}`}>
                  <p className="muted" style={{ marginBottom: 8 }}>
                    {group.label}: {fmtRecord(cs)} · hit {Number(cs.settled || 0) > 0 ? fmtPct(cs.hitRate) : "—"} · Open {cs.open ?? 0} · N={cs.n ?? 0}
                  </p>
                  <TicketTable rows={(group.tickets || []).slice(0, 40)} empty={`No ${group.label} prospective tickets.`} />
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TraitLine({ traits }) {
  if (!traits?.n) return <p className="muted">No seed tickets recovered yet. Strategy definition still applies prospectively.</p>;
  return (
    <p className="muted">
      N={traits.n} · sports {fmtMapSummary(traits.sports)} · markets {fmtMapSummary(traits.markets)} · sides {fmtMapSummary(traits.sides)} · avg Expected ROI {fmtPct(traits.avgEv)} · home {fmtPct(traits.homeShare)} · over {fmtPct(traits.overShare)}
    </p>
  );
}

function fmtMapSummary(obj) {
  return Object.entries(obj || {})
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ") || "—";
}

function TicketTable({ rows, empty }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  const compact = useIsCompact(760);
  if (compact) {
    return (
      <div className="mobile-card-list">
        {rows.map((t) => (
          <article key={t.id} className="mobile-card">
            <div className="mobile-card-head">
              <b>{canonicalMatchup(t)}</b>
              <span className={t.result === "WON" ? "text-green" : t.result === "LOST" ? "text-red" : "muted"}>{t.result || "OPEN"}</span>
            </div>
            <div className="muted">{t.date}</div>
            <div className="mobile-kv-grid" style={{ marginTop: 8 }}>
              <div><small>Market</small><b>{t.market} {t.side}</b></div>
              <div><small>Pick</small><b>{t.pick}</b></div>
              <div><small>Expected ROI</small><b>{fmtPct(t.ev)}</b></div>
              <div><small>Tag</small><b>{t.tag || "—"}</b></div>
            </div>
          </article>
        ))}
      </div>
    );
  }
  return (
    <div className="table-scroll"><table className="fbis-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Game</th>
          <th>Market</th>
          <th>Pick</th>
          <th>Expected ROI</th>
          <th>Tag</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className={t.result === "WON" ? "won-row" : t.result === "LOST" ? "lost-row" : ""}>
            <td className="muted">{t.date}</td>
            <td>{canonicalMatchup(t)}</td>
            <td>{t.market} {t.side}</td>
            <td>{t.pick}</td>
            <td>{fmtPct(t.ev)}</td>
            <td>{t.tag}</td>
            <td>{t.result || "OPEN"}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function splitRowsBySport(rows = []) {
  const groups = new Map();
  for (const row of rows || []) {
    const sport = row?.sport || "other";
    if (!groups.has(sport)) groups.set(sport, []);
    groups.get(sport).push(row);
  }
  return Array.from(groups.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([sport, grouped]) => ({
      sport,
      label: SPORTS[sport]?.label || String(sport).toUpperCase(),
      rows: grouped,
    }));
}

function canonicalMatchup(row = {}) {
  if (row.matchupDisplay) return row.matchupDisplay;
  if (row.awayDisplayName && row.homeDisplayName) return `${row.awayDisplayName} @ ${row.homeDisplayName}`;
  if (row.awayName && row.homeName) return `${row.awayName} @ ${row.homeName}`;
  return row.matchup || row.gameId || row.id || "—";
}
