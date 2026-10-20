import {useEffect,useState} from "react";
import "./kalshiCoverageAudit.css";
const time=x=>x&&Number.isFinite(Date.parse(x))?new Date(x).toLocaleString("en-US",{
 timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",
}):"Never";
const label=x=>String(x||"Unverified").replaceAll("_"," ").toLowerCase();
export default function KalshiCoverageAudit(){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function load(signal){
  setBusy(true);setError("");
  try{
   const res=await fetch("/api/kalshi-coverage-report",{cache:"no-store",signal});
   const json=await res.json();
   if(!res.ok||!json?.ok)throw Error("unavailable");
   setData(json);
  }catch(e){if(e?.name!=="AbortError")setError("Market coverage report is unavailable.");}
  finally{if(!signal?.aborted)setBusy(false);}
 }
 useEffect(()=>{const c=new AbortController();load(c.signal);return()=>c.abort();},[]);
 return <section className="kalshi-coverage" aria-label="Kalshi NFL and CFB contract coverage">
  <header className="kalshi-coverage-head">
   <div><small>KALSHI · PHASE 2</small><h3>Verified Market Coverage Audit</h3>
    <p>Live collection progress and exact reasons contracts cannot yet enter FBIS pricing or wagering.</p></div>
   <button type="button" onClick={()=>load()} disabled={busy}>{busy?"Checking…":"Refresh coverage"}</button>
  </header>
  {error&&<p role="status" className="kalshi-coverage-error">{error}</p>}
  {data&&<>
   <div className="kalshi-coverage-grid">{(data.sports||[]).map(s=><article key={s.sport}>
    <div className="kalshi-coverage-top"><strong>{s.sport.toUpperCase()}</strong><span>{label(s.snapshotStatus)}</span></div>
    <div className="kalshi-coverage-stats">
     <div><strong>{s.recordsReviewed}</strong><small>snapshot contracts</small></div>
     <div><strong>{s.uniqueEvents}</strong><small>provider event tickers</small></div>
     <div><strong>{s.twoOutcomeCandidates}</strong><small>two-outcome candidates</small></div>
     <div><strong>{s.fullyQualifiedMarkets}</strong><small>qualified contracts</small></div>
    </div>
    <p>Last attempt: <b>{label(s.lastAttemptState)}</b> · {time(s.lastAttemptAt)}{s.lastAttemptCode?" · "+s.lastAttemptCode:""}</p>
    <p>Last snapshot: {time(s.lastSnapshotAt)} · {s.queryPaginationComplete?"Provider query reached final cursor":"Query not proven complete"}</p>
    {s.continuationPending&&<p className="kalshi-coverage-progress">Resumable capture: {s.recordsInProgress} contracts across {s.pagesInProgress} page(s); next cursor saved</p>}
    <div className="kalshi-coverage-reasons">
     <strong>Outstanding qualification gates</strong>
     {Object.entries(s.reasons||{}).slice(0,7).map(([reason,count])=>
      <div key={reason}><span>{label(reason)}</span><b>{count}</b></div>)}
     {!s.recordsReviewed&&<p>No recent qualified source snapshot. Historic records are not used as live prices.</p>}
    </div>
    <p className="kalshi-coverage-limit">No provider kickoff proof, canonical fixture match, verified outcome side, live orderbook depth, fee schedule or executable quote clock.</p>
   </article>)}</div>
   <p className="kalshi-coverage-disclaimer">A completed provider query establishes inventory coverage for the selected series only. The audit never changes CORE, PinnOdds gaps, wager eligibility, or betting performance.</p>
  </>}
 </section>;
}
