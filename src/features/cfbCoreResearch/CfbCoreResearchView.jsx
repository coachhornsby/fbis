import {useEffect,useMemo,useState} from "react";
import "./cfbCoreResearch.css";

const fmt = (v, d = 1) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(d));
const pct = (v, n) => (v == null ? "—" : `${(Number(v) * 100).toFixed(1)}%${n != null ? ` (n=${n})` : ""}`);

function MatchupCard({row}) {
  const home = row.homeTeam || "Home";
  const away = row.awayTeam || "Away";
  const elig = row.eligibility === "eligible_projected";
  return (
    <article className="ccr-matchup" data-eligibility={row.eligibility}>
      <header className="ccr-matchup-head">
        <div className="ccr-teams">
          <strong>{away}</strong>
          <span className="ccr-at">@</span>
          <strong>{home}</strong>
        </div>
        <div className="ccr-meta">
          <span>W{row.week ?? "—"}</span>
          <span>{row.kickoff ? new Date(row.kickoff).toLocaleString() : "Kickoff unavailable"}</span>
          <span className={elig ? "ccr-pill ok" : "ccr-pill warn"}>{elig ? "Eligible" : (row.missingReason || row.eligibility)}</span>
        </div>
      </header>
      <div className="ccr-table-wrap">
        <table className="ccr-compare">
          <thead>
            <tr>
              <th>Metric</th>
              <th>FBIS Champion</th>
              <th>CORE Challenger</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Projected spread</td>
              <td>{fmt(row.champion?.spread)}</td>
              <td>{fmt(row.core?.spread)}</td>
            </tr>
            <tr>
              <td>Projected total</td>
              <td>{fmt(row.champion?.total)}</td>
              <td>{fmt(row.core?.total)}</td>
            </tr>
            <tr>
              <td>Win probability</td>
              <td>{row.champion?.pHomeWin == null ? "Unavailable" : pct(row.champion.pHomeWin)}</td>
              <td>{row.core?.pHomeWin == null ? "Unavailable" : pct(row.core.pHomeWin)}</td>
            </tr>
            <tr>
              <td>PinnOdds spread gap</td>
              <td>{fmt(row.champion?.pinnSpreadGap)}</td>
              <td>{fmt(row.core?.pinnSpreadGap)}</td>
            </tr>
            <tr>
              <td>PinnOdds total gap</td>
              <td>{fmt(row.champion?.pinnTotalGap)}</td>
              <td>{fmt(row.core?.pinnTotalGap)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ccr-driver">
        Matchup drivers: home CORE off {fmt(row.core?.homeOffense, 2)} vs away def {fmt(row.core?.awayDefense, 2)};
        away CORE off {fmt(row.core?.awayOffense, 2)} vs home def {fmt(row.core?.homeDefense, 2)}.
        Through-week {row.core?.throughWeek ?? "—"}. HFA {fmt(row.hfaPoints)}.
        Driver: {row.disagreement?.driver || "n/a"}. Disagreement ≠ proven edge.
      </p>
    </article>
  );
}

function MaeChart({accuracy}) {
  if (!accuracy || !accuracy.n) {
    return <p className="ccr-empty">No settled prospective sample yet (n=0).</p>;
  }
  const bars = [
    {label: "Champ spread MAE", value: accuracy.championSpreadMae},
    {label: "CORE spread MAE", value: accuracy.coreSpreadMae},
    {label: "Champ total MAE", value: accuracy.championTotalMae},
    {label: "CORE total MAE", value: accuracy.coreTotalMae},
  ].filter(b => b.value != null);
  const max = Math.max(...bars.map(b => Number(b.value) || 0), 1);
  return (
    <div className="ccr-chart" role="img" aria-label={`Prospective MAE chart n=${accuracy.n}`}>
      {bars.map(b => (
        <div className="ccr-bar-row" key={b.label}>
          <span>{b.label}</span>
          <div className="ccr-bar-track">
            <div className="ccr-bar" style={{width: `${(Number(b.value) / max) * 100}%`}} />
          </div>
          <strong>{fmt(b.value, 2)}</strong>
        </div>
      ))}
      <p className="ccr-note">Sample size n={accuracy.n}. {accuracy.note}</p>
    </div>
  );
}

export default function CfbCoreResearchView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/cfb-core-research", {signal: controller.signal, credentials: "same-origin"})
      .then(async r => {
        const d = await r.json();
        if (!r.ok || d?.ok === false) throw Error(d?.reason || d?.error || "CORE research unavailable");
        setData(d);
      })
      .catch(e => {
        if (e.name !== "AbortError") setError(e.message || String(e));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const health = data?.sections?.dataCoverage;
  const classification = data?.sections?.predictiveAccuracy?.classification || data?.latestReport?.classification;

  const disagreementRows = useMemo(
    () => data?.sections?.disagreements?.rows || [],
    [data]
  );

  return (
    <section className="panel ccr-panel" aria-label="CFB CORE research">
      <header className="panel-header ccr-header">
        <div>
          <h2 className="panel-title">CFB CORE Research</h2>
          <p className="muted">
            Challenger {data?.challengerId || "CFB-CORE-SHADOW-v1"} · Champion remains authoritative · Research only · No wager authority
          </p>
        </div>
        {classification ? <span className="ccr-pill warn">{classification}</span> : null}
      </header>

      {loading ? <p className="muted">Loading CORE research…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && !error && data ? (
        <>
          <section className="ccr-section" aria-label="Data coverage and health">
            <h3>E. Data Coverage and Health</h3>
            <div className="ccr-health-grid">
              <div><span>Rated FBS teams</span><strong>{health?.ratedFbsTeams ?? "Unavailable"}</strong></div>
              <div><span>CORE through-week</span><strong>{health?.currentCoreThroughWeek ?? "Unavailable"}</strong></div>
              <div><span>Shadow projections</span><strong>{health?.shadowProjectionCoverage?.shadowProjections ?? "Unavailable"}</strong></div>
              <div><span>Eligible projected</span><strong>{health?.shadowProjectionCoverage?.eligibleProjected ?? "Unavailable"}</strong></div>
              <div><span>Flagged / missing</span><strong>{health?.shadowProjectionCoverage?.flaggedMissing ?? "Unavailable"}</strong></div>
              <div><span>Eval sample (prospective)</span><strong>{health?.evaluationSampleSize ?? 0}</strong></div>
              <div><span>Fitted OOS artifact</span><strong>{health?.fittedArtifact?.verifiedOos ? "Verified" : "Not verified"}</strong></div>
              <div><span>Provider allowance</span><strong>{health?.providerAllowance?.available ? health.providerAllowance.providerRemaining : (health?.providerAllowance?.reason || "Unavailable")}</strong></div>
            </div>
            <p className="ccr-note">{health?.staleOrMissingNote}</p>
            <p className="ccr-note">{health?.preKickoffFeatureValidity}</p>
          </section>

          <section className="ccr-section" aria-label="CORE vs FBIS">
            <h3>A. CORE vs FBIS</h3>
            <p className="ccr-note">{data.sections?.vsFbis?.note}</p>
            {(data.sections?.vsFbis?.rows || []).length === 0 ? (
              <p className="ccr-empty">No upcoming shadow rows yet. Freeze job persists immutable pregame research records when champion predictions and week-bounded CORE align.</p>
            ) : (
              <div className="ccr-matchup-list">
                {data.sections.vsFbis.rows.map(row => <MatchupCard key={row.id || row.gameId} row={row} />)}
              </div>
            )}
          </section>

          <section className="ccr-section" aria-label="Where CORE disagrees">
            <h3>B. Where CORE Disagrees</h3>
            <p className="ccr-note">{data.sections?.disagreements?.note}</p>
            {disagreementRows.length === 0 ? (
              <p className="ccr-empty">No eligible disagreement rows.</p>
            ) : (
              <div className="ccr-table-wrap">
                <table className="ccr-compare">
                  <thead>
                    <tr>
                      <th>Matchup</th>
                      <th>|Δ Spread|</th>
                      <th>Driver</th>
                      <th>Proven edge?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disagreementRows.map(r => (
                      <tr key={`d-${r.id || r.gameId}`}>
                        <td>{r.awayTeam} @ {r.homeTeam}</td>
                        <td>{fmt(Math.abs(Number(r.disagreement?.spread)), 2)}</td>
                        <td>{r.disagreement?.driver || "—"}</td>
                        <td>No</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="ccr-section" aria-label="Predictive accuracy">
            <h3>C. Predictive Accuracy</h3>
            <MaeChart accuracy={data.sections?.predictiveAccuracy?.prospective} />
            {data.sections?.predictiveAccuracy?.historical ? (
              <div className="ccr-table-wrap">
                <table className="ccr-compare">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Spread MAE</th>
                      <th>Total MAE</th>
                      <th>n</th>
                    </tr>
                  </thead>
                  <tbody>
                    {["champion", "coreOnly", "combined"].map(k => {
                      const m = data.sections.predictiveAccuracy.historical[k] || {};
                      return (
                        <tr key={k}>
                          <td>{k}</td>
                          <td>{fmt(m.spreadMae, 3)}</td>
                          <td>{fmt(m.totalMae, 3)}</td>
                          <td>{data.sections.predictiveAccuracy.historical.n ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ccr-empty">Historical OOS comparison unavailable until multi-season PIT CORE rows exist.</p>
            )}
          </section>

          <section className="ccr-section" aria-label="Betting edge research">
            <h3>D. Betting Edge Research</h3>
            <p className="ccr-note">
              Status: {data.sections?.bettingEdge?.status || "unavailable"}. Game lines only; player props excluded. Not approved bets.
            </p>
            <p className="ccr-note">{data.sections?.bettingEdge?.note}</p>
            {!data.sections?.bettingEdge?.summary ? (
              <p className="ccr-empty">No timestamped PinnOdds market-edge summary on eligible historical CORE rows.</p>
            ) : (
              <pre className="ccr-json">{JSON.stringify(data.sections.bettingEdge.summary, null, 2)}</pre>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
