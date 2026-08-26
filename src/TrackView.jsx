import { BOARD_SPORTS, SPORTS } from "../functions/lib/slateEngine.js";
import { fmtNum, fmtPct, fmtSigned, fmtVig } from "./lib/format.js";

export default function TrackView({ report, error, loading, onRefresh }) {
  const acc = report?.accuracy || { n: 0 };
  const games = report?.games || [];
  const graded = games.filter((g) => g.status === "GRADED");
  const open = games.filter((g) => g.status === "OPEN");
  const guide = report?.recipeGuide || {};

  return (
    <div className="main-content">
      {error && <div className="panel"><div className="error">{error}</div></div>}

      <section className="panel">
        <div className="panel-header">
          <h2>Command Center</h2>
          <span className="last-updated">
            {loading ? "Harvesting finals…" : report?.harvestedAt ? `${new Date(report.harvestedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago" })} CT` : ""}
          </span>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginBottom: 12 }}>
            Forecast quality, not ticket luck. Projections freeze pregame. Finals are pulled from the scoreboard every night — Parlay credits are not used. Champion weights do not auto-rewrite from last night’s W/L.
          </p>
          <div className="status-grid">
            <Stat label="Graded games" value={acc.n || 0} />
            <Stat label="MAE total" value={fmtNum(acc.maeTotal)} />
            <Stat label="MAE margin" value={fmtNum(acc.maeMargin)} />
            <Stat label="Bias (proj−act)" value={fmtSigned(acc.biasTotal)} />
            <Stat label="Winner hit" value={fmtPct(acc.winnerHit)} />
            <Stat label="Brier model" value={fmtNum(acc.brierModel, 3)} />
            <Stat label="Brier market" value={fmtNum(acc.brierMarket, 3)} />
            <Stat label="Log loss" value={fmtNum(acc.logLossModel, 3)} />
            <Stat label="RMSE total" value={fmtNum(acc.rmseTotal)} />
            <Stat label="Open freezes" value={open.length} />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="header-btn header-btn-refresh" onClick={onRefresh} disabled={loading}>
              {loading ? "Harvesting…" : "Harvest finals"}
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
        <div className="panel-header"><h2>Calibration (home win %)</h2></div>
        <div className="panel-body" style={{ padding: 0 }}>
          {!(acc.calibration || []).some((b) => b.n) ? (
            <div className="empty">Buckets fill after graded games freeze the final FBIS probability.</div>
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
                <th>Hit</th>
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
                  <td>{fmtPct(s.accuracy?.winnerHit)}</td>
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
            <div className="empty">Open a sport board during the day so FBIS can freeze pregame projections. Finals fill in after the games.</div>
          ) : (
            <table className="fbis-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Game</th>
                  <th>Engine</th>
                  <th>Proj</th>
                  <th>Actual</th>
                  <th>Δ tot</th>
                  <th>Δ mgn</th>
                  <th>Pin vig</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {games.slice(0, 80).map((g) => (
                  <tr key={`${g.date}:${g.id}`} title={(g.steps || []).join("\n")}>
                    <td className="muted">{g.date}</td>
                    <td>{g.matchup}</td>
                    <td className="muted">{g.engine}</td>
                    <td className="text-blue">{fmtNum(g.projAway)} – {fmtNum(g.projHome)}</td>
                    <td>{g.actualHome == null ? "—" : `${fmtNum(g.actualAway, 0)} – ${fmtNum(g.actualHome, 0)}`}</td>
                    <td className={errClass(g.errTotal)}>{fmtSigned(g.errTotal)}</td>
                    <td className={errClass(g.errMargin)}>{fmtSigned(g.errMargin)}</td>
                    <td>{fmtVig(g.pinVig)}</td>
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

function Stat({ label, value }) {
  return (
    <div className="status-cell">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}

function errClass(n) {
  if (n == null) return "muted";
  const a = Math.abs(n);
  if (a < 0.6) return "text-green";
  if (a > 2) return "text-red";
  return "";
}
