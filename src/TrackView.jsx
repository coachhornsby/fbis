import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { CHECKPOINTS } from "../functions/lib/checkpoints.js";
import { fmtNum, fmtPct, fmtSigned } from "./lib/format.js";

const PERIODS = [
  ["7", "Last 7"],
  ["14", "Last 14"],
  ["30", "Last 30"],
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
        <div className="panel-header">
          <h2>Research DB</h2>
          <span className="last-updated">{loading ? "Loading…" : db.lastWrite ? `${new Date(db.lastWrite).toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT` : ""}</span>
        </div>
        <div className="panel-body">
          <div className={`db-banner ${db.ok ? "db-ok" : "db-bad"}`}>
            {db.ok ? "RESEARCH DB: CONNECTED" : `RESEARCH DB ${db.reason === "unbound" ? "UNBOUND" : "ERROR"}`}
            <span className="muted" style={{ marginLeft: 10 }}>
              source {report?.source || db.source || "—"} · stored today {db.predictions ?? 0} · graded today {db.graded ?? 0}
              {db.lastError ? ` · ${db.lastError}` : ""}
            </span>
          </div>
          <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
            Scheduled collection writes pregame checkpoints even if this page is closed. SYS reads D1; cache is only a fallback. Bias near zero is not accuracy — MAE, median abs, and RMSE sit beside every total.
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
                {CHECKPOINTS.map((c) => (
                  <option key={c} value={c}>{c}</option>
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

          <div className="status-grid" style={{ marginBottom: 14 }}>
            <Stat label="Games graded" value={hl.n || 0} />
            <Stat label={perGame ? "Actual / game" : "Actual runs"} value={fmtNum(hl.actualRuns)} />
            <Stat label={perGame ? "Projected / game" : "Projected runs"} value={fmtNum(hl.projectedRuns)} />
            <Stat label="Difference" value={fmtSigned(hl.diff)} />
            <Stat label="% Difference" value={fmtPctSigned(hl.pctDiff)} />
            <Stat label="Home bias" value={fmtPctSigned(hl.homeBias)} />
            <Stat label="Away bias" value={fmtPctSigned(hl.awayBias)} />
            <Stat label="Median error" value={fmtSigned(hl.median)} />
            <Stat label="Median abs" value={fmtNum(hl.medianAbs)} />
            <Stat label="MAE" value={fmtNum(hl.mae)} />
            <Stat label="RMSE" value={fmtNum(hl.rmse)} />
            <Stat label="Score winner" value={fmtPct(acc.winnerHitScore ?? acc.winnerHit)} />
            <Stat label="Ensemble winner" value={fmtPct(acc.winnerHitProb)} />
          </div>

          {tab === "overall" && (
            <>
              <MetricTable rows={table.rows || []} />
              <h3 className="subhead">Error distribution</h3>
              <DistBlock dist={dist} />
              <h3 className="subhead">Model comparison</h3>
              <ModelsTable models={models} />
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

          <div style={{ marginTop: 12 }}>
            <button className="header-btn header-btn-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? "Loading…" : "Reload SYS"}
            </button>
          </div>
        </div>
      </section>

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
  const t = dist.total || {};
  const team = dist.team || {};
  const m = dist.margin || {};
  return (
    <div className="dist-grid">
      <div>
        <b>Total</b>
        <ul>
          <li>Within 0.5 · {fmtPct(t.within05)}</li>
          <li>Within 1 · {fmtPct(t.within1)}</li>
          <li>Within 2 · {fmtPct(t.within2)}</li>
          <li>Within 3 · {fmtPct(t.within3)}</li>
          <li>Within 4 · {fmtPct(t.within4)}</li>
        </ul>
      </div>
      <div>
        <b>Team score</b>
        <ul>
          <li>Within 0.5 · {fmtPct(team.within05)}</li>
          <li>Within 1 · {fmtPct(team.within1)}</li>
          <li>Within 2 · {fmtPct(team.within2)}</li>
        </ul>
      </div>
      <div>
        <b>Margin</b>
        <ul>
          <li>Within 1 · {fmtPct(m.within1)}</li>
          <li>Within 2 · {fmtPct(m.within2)}</li>
          <li>Within 3 · {fmtPct(m.within3)}</li>
        </ul>
      </div>
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
          <th>Winner</th>
        </tr>
      </thead>
      <tbody>
        {models.map((m) => (
          <tr key={m.key} className={m.key === "ensemble" ? "won-row" : ""}>
            <td>{m.label}</td>
            <td>{m.n || 0}</td>
            <td>{fmtNum(m.maeTotal)}</td>
            <td>{fmtNum(m.maeTeam)}</td>
            <td>{fmtNum(m.maeMargin)}</td>
            <td>{fmtNum(m.rmse)}</td>
            <td>{fmtSigned(m.bias)}</td>
            <td>{fmtNum(m.brier, 3)}</td>
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

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
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
