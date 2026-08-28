import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { CHECKPOINT_OPTIONS } from "../functions/lib/checkpoints.js";
import { fmtNum, fmtPct, fmtSigned, fmtMetric as fmtMetricN0 } from "./lib/format.js";
import { useEffect, useState } from "react";

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

export default function TrackView({ report, error, loading, filters, onFilters, onRefresh }) {
  const acc = report?.accuracy || { n: 0 };
  const pack = report?.pack || {};
  const table = pack.table || { headline: {}, rows: [] };
  const dist = pack.distribution || {};
  const models = pack.models || [];
  const br = pack.breakdowns || {};
  const games = report?.games || [];
  const graded = games.filter((g) => g.status === "GRADED");
  const open = games.filter((g) => g.status === "OPEN");
  const guide = report?.recipeGuide || {};
  const db = report?.db || {};
  const hl = table.headline || {};
  const tab = filters?.tab || "overall";
  const perGame = filters?.type !== "totals";

  return (
    <div className="main-content">
      {error && <div className="panel"><div className="error">{error}</div></div>}

      <section className="panel">
        <div className="panel-header"><h2>Sport systems</h2><span className="last-updated">independent tracking by board</span></div>
        <div className="panel-body">
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

      <section className="panel">
        <div className="panel-header">
          <h2>Research DB</h2>
          <span className="last-updated">{loading ? "Loading…" : db.lastWrite ? `${new Date(db.lastWrite).toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT` : ""}</span>
        </div>
        <div className="panel-body">
          <div className={`db-banner ${db.ok ? "db-ok" : "db-bad"}`}>
            {db.ok ? "RESEARCH DB: CONNECTED" : `RESEARCH DB ${db.reason === "unbound" ? "UNBOUND" : "ERROR"}`}
            <span className="muted" style={{ marginLeft: 10 }}>
              health source {db.healthSource || db.source || report?.source || "—"} · stored today {db.predictions ?? 0} · graded today {db.graded ?? 0} · awaiting {db.awaiting ?? 0}
              {db.lastCollectSuccess || db.lastCollect ? ` · collect ${new Date(db.lastCollectSuccess || db.lastCollect).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT` : ""}
              {db.lastHarvestSuccess || db.lastHarvest ? ` · harvest ${new Date(db.lastHarvestSuccess || db.lastHarvest).toLocaleString("en-US", { timeZone: "America/Chicago" })} CT` : ""}
              {db.failedWrites ? ` · failed writes ${db.failedWrites}` : ""}
              {db.failedHarvests ? ` · failed harvests ${db.failedHarvests}` : ""}
              {db.lastError ? ` · ${db.lastError}` : ""}
            </span>
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
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Projection Accuracy</h2>
          <span className="last-updated">{hl.n || 0} games</span>
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
                value={filters.team || ""}
                placeholder="abbr"
                onChange={(e) => onFilters({ team: e.target.value })}
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
            {hl.n
              ? `Projected runs have been ${fmtPctSigned(hl.pctDiff)} vs actual (${hl.n} games). Median abs ${fmtNum(hl.medianAbs)} · MAE ${fmtNum(hl.mae)} · RMSE ${fmtNum(hl.rmse)}.`
              : "No graded projections in this window yet. Collection runs on a schedule — you do not need to open the board."}
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
            <Stat label="Games graded" value={hl.n || 0} />
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

          {tab === "overall" && (
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
          {tab === "month" && <BreakTable rows={br.month || []} extra />}
          {tab === "day" && <BreakTable rows={(br.day || []).slice(0, 45)} extra />}
          {tab === "park" && <BreakTable rows={br.park || []} />}
          {tab === "team" && <BreakTable rows={br.team || []} rpg />}
          {tab === "starter" && <BreakTable rows={(br.starter || []).slice(0, 40)} rpg />}
          {tab === "homeAway" && <BreakTable rows={br.homeAway || []} />}
          {tab === "version" && <BreakTable rows={br.version || []} extra />}
          {tab === "checkpoint" && <BreakTable rows={br.checkpoint || []} extra />}
          {tab === "week" && <BreakTable rows={br.week || []} extra />}
          {tab === "conference" && <BreakTable rows={br.conference || []} extra />}
          {tab === "favDog" && <BreakTable rows={br.favDog || []} extra />}
          {tab === "spreadRange" && <BreakTable rows={br.spreadRange || []} extra />}

          <div style={{ marginTop: 12 }}>
            <button className="header-btn header-btn-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? "Loading…" : "Reload SYS"}
            </button>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Strategy Performance</h2>
          <span className="last-updated">qualified / executed tickets</span>
        </div>
        <div className="panel-body">
          <p className="headline-line">
            {report?.strategyPerformance?.message ||
              (report?.strategyPerformance?.settled
                ? `Settled ${report.strategyPerformance.record} on ${report.strategyPerformance.settled} tickets.`
                : "No settled strategy tickets yet.")}
          </p>
          <div className="status-grid">
            <Stat label="Tickets" value={report?.strategyPerformance?.tickets ?? 0} />
            <Stat label="Open" value={report?.strategyPerformance?.open ?? 0} />
            <Stat label="Settled" value={report?.strategyPerformance?.settled ?? 0} />
            <Stat label="Record" value={report?.strategyPerformance?.record || "—"} />
            <Stat label="Hit rate" value={fmtPct(report?.strategyPerformance?.hitRate)} />
            <Stat label="Units" value={fmtSigned(report?.strategyPerformance?.units)} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>CLV Tracker</h2>
          <span className="last-updated">{report?.clv?.n ?? 0} valid Pin entry+close</span>
        </div>
        <div className="panel-body">
          <p className="headline-line">
            {report?.clv?.unavailable
              ? report.clv.message || "No tickets have both a valid Pinnacle entry and close yet."
              : `Avg CLV ${fmtSigned(report?.clv?.avg, 3)} · positive share ${fmtPct(report?.clv?.positiveShare)}.`}
          </p>
          <p className="muted">CLV is close no-vig − entry no-vig, same side. Independent of W/L. Heritage Current Line is not Pin close.</p>
          <div className="status-grid">
            <Stat label="Valid CLV N" value={report?.clv?.validClv ?? 0} />
            <Stat label="Missing entry" value={report?.clv?.missingEntry ?? 0} />
            <Stat label="Missing close" value={report?.clv?.missingClose ?? 0} />
            <Stat label="Line mismatch" value={report?.clv?.lineMismatch ?? 0} />
            <Stat label="Coverage" value={fmtPct(report?.clv?.coveragePct)} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Model Diagnostics · layers</h2>
          <span className="last-updated">{report?.layers?.leader ? `leader ${report.layers.leader}` : "N=0"}</span>
        </div>
        <div className="panel-body">
          <p className="muted">{report?.layers?.note || "Layer leader is lowest Brier on frozen forecasts. Closest-to-binary counts are not used."}</p>
          <table className="fbis-table">
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
          </table>
        </div>
      </section>

      <StrategyPanel />

      <section className="panel">
        <div className="panel-header"><h2>How projections are made</h2></div>
        <div className="panel-body">
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
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2>Calibration (favorite confidence)</h2></div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!(acc.calibration || []).some((b) => b.n) ? (
            <div className="empty">Buckets fill after graded games freeze the final FBIS probability. Home p below 50% is included as the favorite side.</div>
          ) : (
            <table className="fbis-table">
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
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2>Calibration (home win %)</h2></div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!(acc.calibrationHome || []).some((b) => b.n) ? (
            <div className="empty">0–10 through 90–100 home-win buckets. Underdogs are no longer dropped.</div>
          ) : (
            <table className="fbis-table">
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
            </table>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2>By sport</h2></div>
        <div className="panel-body" style={{ padding: 0 }}>
          <table className="fbis-table">
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
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Projection vs final</h2>
          <span className="last-updated">{graded.length} graded · {open.length} waiting</span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!games.length ? (
            <div className="empty">No frozen projections in this window. Collection is scheduled — opening the board is not required.</div>
          ) : (
            <table className="fbis-table">
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
                {games.slice(0, 120).map((g) => (
                  <tr key={`${g.date}:${g.id}:${g.checkpoint || ""}`} title={(g.steps || []).join("\n")}>
                    <td className="muted">{g.date}</td>
                    <td>{g.matchup}</td>
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
            </table>
          )}
        </div>
      </section>
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
    <table className="fbis-table">
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
    </table>
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
    <table className="fbis-table">
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
    </table>
  );
}

function SliceTable({ rows }) {
  return (
    <table className="fbis-table">
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
    </table>
  );
}

function BreakTable({ rows, extra, rpg }) {
  return (
    <table className="fbis-table">
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
    </table>
  );
}

function RollingTable({ rows }) {
  return (
    <table className="fbis-table">
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
    </table>
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
        <Stat label="OVER EV" value={fmtMetric(over.avgEv?.over)} />
        <Stat label="UNDER EV" value={fmtMetric(over.avgEv?.under)} />
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
      <table className="fbis-table">
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
      </table>
    </div>
  );
}

function StrategyPanel() {
  const [pack, setPack] = useState(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch(`/api/strategy?_t=${Date.now()}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => setPack(d))
      .catch(() => {});
    return () => ac.abort();
  }, []);
  const seed = pack?.seed || { tickets: [], stats: {}, traits: {} };
  const pro = pack?.prospective || { tickets: [], stats: {}, traits: {} };
  const rec = pack?.reconstruction || {};
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Strategy · FBIS-HC-v1</h2>
        <span className="last-updated">expected N={pack?.expectedSeedN || 7} · recovered {pack?.actualRecoveredN ?? rec.recoveredN ?? 0} · {rec.state || rec.confidence || "operator-declared"}</span>
      </div>
      <div className="panel-body">
        <p className="headline-line">
          High-conviction means a <b>qualified</b> ticket with EV ≥ 8% (tag CONVICTION). Leans are excluded.
          The 7-0 does not rewrite blend weights. N=7 is not evidence the filter works.
        </p>
        <p className="muted" style={{ marginBottom: 10 }}>
          Reconstruction: {rec.state || rec.confidence || "operator-declared"}
          {` · expected seed N=${pack?.expectedSeedN ?? 7}`}
          {` · recovered N=${pack?.actualRecoveredN ?? rec.recoveredN ?? 0}`}
          {` · recovered record ${pack?.recoveredRecord || rec.recoveredRecord || "—"}`}
          {` · settled (recovered) ${pack?.settledTicketCount ?? rec.settledTicketCount ?? 0}`}
          {` · operator-graded ${pack?.gradedRecord || rec.gradedRecord || seed.stats?.gradedRecord || "—"}`}
          {rec.note ? ` — ${rec.note}` : ""}
        </p>
        <p className="muted" style={{ marginBottom: 10 }}>
          {pack?.strategy?.seedObservation ||
            "The 2026-08-26 seed sample was MLB-heavy overs (5/7 totals at 8.5–9.5, 1 ML, 1 +1.5 RL). That is an observation, not a gate."}
        </p>
        <div className="status-grid" style={{ marginBottom: 12 }}>
          <Stat label="Expected N" value={pack?.expectedSeedN ?? 7} />
          <Stat label="Recovered N" value={pack?.actualRecoveredN ?? rec.recoveredN ?? 0} />
          <Stat label="State" value={rec.state || rec.confidence || "unrecovered"} />
          <Stat label="Recovered record" value={pack?.recoveredRecord || rec.recoveredRecord || "—"} />
          <Stat label="Graded (named)" value={pack?.gradedRecord || rec.gradedRecord || (seed.stats?.settled ? `${seed.stats.wins}-${seed.stats.losses}` : "—")} />
          <Stat label="Prospective N" value={pro.stats?.n ?? 0} />
          <Stat label="Prospective hit" value={fmtPct(pro.stats?.hitRate)} />
          <Stat label="Prospective ROI" value={fmtSigned(pro.stats?.roi)} />
          <Stat label="Avg CLV" value={fmtSigned(pro.stats?.avgClv)} />
          <Stat label="Drawdown" value={fmtSigned(pro.stats?.drawdown)} />
          <Stat label="Open" value={pro.stats?.open ?? 0} />
        </div>
        <h3 className="subhead">Seed traits (shared characteristics)</h3>
        <TraitLine traits={seed.traits} />
        <h3 className="subhead">Seed tickets</h3>
        <TicketTable rows={seed.tickets || []} empty="Operator-declared 2026-08-26 CONVICTION names. Journal EV/prices unrecovered until imported." />
        <h3 className="subhead">Prospective matches</h3>
        <TicketTable rows={(pro.tickets || []).slice(0, 40)} empty="No prospective CONVICTION tickets stored yet. Collection tags matches automatically." />
      </div>
    </section>
  );
}

function TraitLine({ traits }) {
  if (!traits?.n) return <p className="muted">No seed tickets recovered yet. Strategy definition still applies prospectively.</p>;
  const fmtMap = (obj) =>
    Object.entries(obj || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "—";
  return (
    <p className="muted">
      N={traits.n} · sports {fmtMap(traits.sports)} · markets {fmtMap(traits.markets)} · sides {fmtMap(traits.sides)} · avg EV {fmtPct(traits.avgEv)} · home {fmtPct(traits.homeShare)} · over {fmtPct(traits.overShare)}
    </p>
  );
}

function TicketTable({ rows, empty }) {
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <table className="fbis-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Game</th>
          <th>Market</th>
          <th>Pick</th>
          <th>EV</th>
          <th>Tag</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className={t.result === "WON" ? "won-row" : t.result === "LOST" ? "lost-row" : ""}>
            <td className="muted">{t.date}</td>
            <td>{t.matchup || t.gameId}</td>
            <td>{t.market} {t.side}</td>
            <td>{t.pick}</td>
            <td>{fmtPct(t.ev)}</td>
            <td>{t.tag}</td>
            <td>{t.result || "OPEN"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
