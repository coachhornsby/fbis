import {useEffect,useState} from "react";
import "./sportAccountability.css";

const SPORTS=["all","nfl","cfb","nba","cbb","wnba","mlb","npb","kbo","nhl","soccer","tennis"];
const fmt=(n,d=1)=>typeof n==="number"&&Number.isFinite(n)?n.toFixed(d):"—";
const pct=n=>typeof n==="number"&&Number.isFinite(n)?(n*100).toFixed(1)+"%":"—";
function statusName(s){return s==="READ_DEGRADED"?"Snapshot source unavailable":s==="PREGAME_OUTCOMES_GRADED"?"Graded pregame outcomes":"Awaiting verified outcomes";}
function Badge({ok,children}){return <span className={"si-status "+(ok?"si-ok":"si-muted")}>{children}</span>}
export default function SportAccountabilityPanel({sportFilter="all"}){
  const [sport,setSport]=useState(SPORTS.includes(sportFilter)?sportFilter:"all");
  const [days,setDays]=useState(14);
  const [report,setReport]=useState(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);
  useEffect(()=>{setSport(SPORTS.includes(sportFilter)?sportFilter:"all")},[sportFilter]);
  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError("");
    fetch("/api/simulation-intelligence?sport="+encodeURIComponent(sport)+"&days="+days,{
      signal:controller.signal,credentials:"same-origin",cache:"no-store"
    }).then(async r=>{const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||"Unverified source");return j})
      .then(j=>setReport(j)).catch(e=>{if(e.name!=="AbortError"){setError(String(e.message||e));setReport(null)}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return ()=>controller.abort();
  },[sport,days]);
  const sports=report?.sports||[];
  return <section className="si-panel" aria-label="FBIS model accountability">
    <div className="si-header">
      <div>
        <p className="si-kicker">FBIS · MODEL INTELLIGENCE</p>
        <h2>Simulation & Model Accountability</h2>
        <p className="si-subtitle">Frozen pregame projections compared with graded outcomes. Simulation-range and betting economics stay blank until independently supported.</p>
      </div>
      <div className="si-controls">
        <label>Sport <select aria-label="Accountability sport" value={sport} onChange={e=>setSport(e.target.value)}>
          {SPORTS.map(s=><option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select></label>
        <label>Window <select aria-label="Accountability window" value={days} onChange={e=>setDays(Number(e.target.value))}>
          <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
        </select></label>
      </div>
    </div>
    {loading&&<p role="status" className="si-subtitle">Reading frozen model evidence…</p>}
    {error&&<p role="alert" className="si-error">Model accountability unavailable: {error}. No results inferred.</p>}
    {report&&<div className="si-content">
      {report.degraded&&<p className="si-error" role="alert">Snapshot source degraded for {report.failedSports?.join(", ")}. Those sports are not counted as healthy.</p>}
      <div className="si-stat-grid">
        <article className="si-stat"><span>Official graded forecasts</span><strong>{report.eligibleForecasts}</strong><small>{report.eligibleEvents} events · across models</small></article>
        <article className="si-stat"><span>Covered sports</span><strong>{sports.filter(s=>s.samples>0).length}<small>/{sports.length}</small></strong><small>Verified pregame evidence only</small></article>
        <article className="si-stat"><span>Simulation range coverage</span><strong>—</strong><small>Awaiting prospective simulation quantiles</small></article>
        <article className="si-stat"><span>Verified betting ROI</span><strong>—</strong><small>Requires executed wager ledger</small></article>
      </div>
      <h3 className="si-section">Sport-specific accuracy</h3>
      <div className="si-sport-grid">
        {sports.map(s=><article className="si-sport" key={s.sport}>
          <header><strong>{s.sport.toUpperCase()}</strong><Badge ok={s.samples>0}>{statusName(s.status)}</Badge></header>
          <div className="si-sport-gridmetrics"><div><span>Games / model forecasts</span><b>{s.samples}</b></div><div><span>Score MAE</span><b>{fmt(s.scoreMae)}</b></div><div><span>Win side</span><b>{pct(s.winnerHitRate)}</b></div><div><span>Brier</span><b>{fmt(s.brier,3)}</b></div></div>
          <p>{s.unit.replaceAll("_"," ")} model · <span>{s.simulationStatus==="NO_VERIFIED_SIMULATION_EVIDENCE"?"Simulation unverified":"Simulation evidence available"}</span></p>
        </article>)}
      </div>
      {report.cohorts?.length>0&&<><h3 className="si-section">Model version cohorts</h3>
        <div className="si-tablewrap"><table className="si-table"><thead><tr><th>Sport</th><th>Model</th><th>Forecasts</th><th>Score MAE</th><th>Margin bias</th><th>Win side</th><th>Brier</th><th>ROI</th></tr></thead><tbody>{report.cohorts.map((c,i)=><tr key={c.modelId+i}><td>{String(c.sport).toUpperCase()}</td><td>{c.modelId}</td><td>{c.samples}</td><td>{fmt(c.scoreMae)}</td><td>{fmt(c.marginBias)}</td><td>{pct(c.winnerHitRate)}</td><td>{fmt(c.brier,3)}</td><td>—</td></tr>)}</tbody></table></div>
      </>}
      {report.receipts?.length>0&&<><h3 className="si-section">Pregame receipts · latest graded</h3>
        <div className="si-tablewrap"><table className="si-table"><thead><tr><th>Sport</th><th>Matchup</th><th>Model</th><th>Projected</th><th>Actual</th><th>Frozen</th></tr></thead><tbody>{report.receipts.slice(0,12).map((r,i)=><tr key={r.snapshotId+i}><td>{String(r.sport).toUpperCase()}</td><td>{r.matchup||r.gameId}</td><td>{r.modelId}</td><td>{r.projected.join("–")}</td><td>{r.actual.join("–")}</td><td>{new Date(r.frozenAt).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"})} CT</td></tr>)}</tbody></table></div>
      </>}
      <div className="si-footer">
        <span>Read-only · No automatic model promotion · No wagering permissions modified</span>
        <span>{report.range?.start} to {report.range?.end} · {report.queriedSnapshotRows} snapshot rows</span>
      </div>
      <details className="si-audit"><summary>Evidence limitations & rejected records</summary>
        <p>{report.notes?.join(" ")}</p>
        <pre>{JSON.stringify(report.rejectionCounts,null,2)}</pre>
      </details>
    </div>}
  </section>
}
