import {useEffect,useState} from "react";
import "./kalshiOpsStatus.css";

function statusText(value) {
  return String(value||"Unknown").replaceAll("_"," ").toLowerCase();
}
const when=value=>value&&Number.isFinite(Date.parse(value))
  ?new Date(value).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+" CT"
  :"Never verified";
export default function KalshiOpsStatus(){
  const [result,setResult]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
  async function read(signal){
    setLoading(true);setError("");
    try {
      const response=await fetch("/api/kalshi-integration-health",{cache:"no-store",signal});
      if(!response.ok)throw Error("unavailable");
      const data=await response.json();
      if(!data?.ok)throw Error("unavailable");
      setResult(data);
    }catch(e){
      if(e?.name!=="AbortError")setError("Kalshi integration health could not be read.");
    }finally{if(!signal?.aborted)setLoading(false);}
  }
  useEffect(()=>{const c=new AbortController();read(c.signal);return()=>c.abort();},[]);
  const records=result?.sports||[];
  return (
    <section className="kalshi-ops panel" aria-label="Kalshi integration readiness">
      <header className="kalshi-ops-head">
        <div><div className="kalshi-ops-overline">KALSHI / SOURCE OPERATIONS</div>
          <h2>Exchange Integration Readiness</h2>
          <p>Collector status and qualification gates. This monitor never reads private exchange account data.</p>
        </div>
        <button type="button" disabled={loading} onClick={()=>read()}>
          {loading?"Checking…":"↻ Refresh status"}
        </button>
      </header>
      {error&&<p role="status" className="kalshi-ops-error">{error}</p>}
      {result&&<>
        <div className="kalshi-ops-cards">
          <article>
            <span>Scheduled collector</span>
            <strong>{statusText(result.collector?.state)}</strong>
            <small>Last attempt: {when(result.collector?.lastAttemptAt)}</small>
          </article>
          {records.map(s=><article key={s.sport}>
            <span>{s.sport.toUpperCase()} · {s.series}</span>
            <strong>{statusText(s.status)}</strong>
            <small>{s.records===null?"No qualified market inventory":s.records+" market records"} · {s.pageComplete===true?"Full first page":"Coverage not complete"}</small>
            <small>Snapshot: {when(s.capturedAt)}</small>
          </article>)}
          <article>
            <span>Pricing and wager authority</span>
            <strong>Not qualified</strong>
            <small>CORE, PinnOdds gap, player props, combos, fills and settlement unchanged</small>
          </article>
        </div>
        {result.collector?.blockedUntil&&<p className="kalshi-ops-alert" role="status">Kalshi rate-limit / source cooldown until {when(result.collector.blockedUntil)}. No automatic retries from website visitors.</p>}
        <div className="kalshi-ops-gates">
          {Object.entries(result.stages||{}).map(([key,state])=>
            <div key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><strong>{statusText(state)}</strong></div>)}
        </div>
      </>}
    </section>
  );
}
