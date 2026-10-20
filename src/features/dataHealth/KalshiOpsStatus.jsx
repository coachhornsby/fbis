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
  const [accessCode,setAccessCode]=useState("");
  const [diagnosticSport,setDiagnosticSport]=useState("nfl");
  const [checking,setChecking]=useState(false);
  const [probe,setProbe]=useState(null);
  const [probeError,setProbeError]=useState("");
  async function checkNow(event){
    event.preventDefault();
    const code=accessCode.trim();
    if(!code)return;
    setAccessCode("");
    setChecking(true);setProbeError("");
    try{
      const response=await fetch("/api/kalshi-connectivity-diagnostic?sport="+diagnosticSport,{
        method:"POST",cache:"no-store",
        headers:{"x-fbis-account-token":code},
      });
      const body=await response.json();
      if(!response.ok||!body?.ok){
        setProbeError(body?.code==="PORTFOLIO_ACCESS_DENIED"
          ?"FBIS portfolio access code was not accepted."
          :body?.code==="DIAGNOSTIC_RATE_LIMIT_STORE_MISSING"
          ?"Rate-limit protection is unavailable; no upstream probe was attempted."
          :"Diagnostic unavailable ("+(body?.code||"UNKNOWN")+").");
        setProbe(null);
      }else{
        setProbe(body);
      }
    }catch{
      setProbe(null);setProbeError("FBIS could not complete the diagnostic request.");
    }finally{setChecking(false);}
  }
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
  const exchange=result?.exchangeStatus;
  const statusFlag=v=>v===true?"Last reported active":v===false?"Last reported inactive":"Not verified";
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
            <small>Market access: {statusText(result.collector?.authenticationMode||"UNVERIFIED")}</small>
          </article>
          <article>
            <span>Kalshi exchange · hourly snapshot</span>
            <strong>{statusText(exchange?.state)}</strong>
            <small>Trading: {statusFlag(exchange?.tradingActive)}</small>
            <small>Exchange: {statusFlag(exchange?.exchangeActive)}</small>
            <small>Transfers: {statusFlag(exchange?.transfersActive)}</small>
            <small>Last checked: {when(exchange?.lastObservedAt)}</small>
            {exchange?.estimatedResumeAt&&<small>Estimated resume (not guaranteed): {when(exchange.estimatedResumeAt)}</small>}
            {exchange?.exchangeIndexCount!=null&&<small>Provider index statuses: {exchange.exchangeIndexCount}</small>}
            <small>Exchange status does not verify sports API access or authorize trades.</small>
          </article>
          {records.map(s=><article key={s.sport}>
            <span>{s.sport.toUpperCase()} · {s.series}</span>
            <strong>{statusText(s.status)}</strong>
            <small>{s.records===null?"No qualified market inventory":s.records+" market records"} · {s.pageComplete===true?"Query pagination complete":"Coverage not complete"}</small>
            <small>Snapshot: {when(s.capturedAt)}</small>
          </article>)}
          <article>
            <span>Sports series discovery · daily</span>
            <strong>{statusText(result.seriesCatalog?.state)}</strong>
            <small>{result.seriesCatalog?.storedSeriesCount==null?"Catalog not yet collected":result.seriesCatalog.storedSeriesCount+" discovered series candidates"}</small>
            <small>Updated: {when(result.seriesCatalog?.observedAt)}</small>
            <small>Discovery does not mean verified FBIS contract coverage.</small>
          </article>
          <article>
            <span>Pricing and wager authority</span>
            <strong>Not qualified</strong>
            <small>CORE, PinnOdds gap, player props, combos, fills and settlement unchanged</small>
          </article>
        </div>
        {result.collector?.blockedUntil&&<p className="kalshi-ops-alert" role="status">Kalshi rate-limit / source cooldown until {when(result.collector.blockedUntil)}. No automatic retries from website visitors.</p>}
        <section className="kalshi-ops-diagnostic" aria-label="Operator-only Kalshi connectivity check">
          <div>
            <strong>Test Kalshi connectivity now</strong>
            <p>One controlled comparison of anonymous versus signed market GET requests. Uses your existing FBIS portfolio access code and the configured Kalshi API key. This does not place an order, bypass provider limits, or make research prices executable.</p>
          </div>
          <form onSubmit={checkNow} className="kalshi-ops-diagnostic-form">
            <label>Sport <select value={diagnosticSport} disabled={checking} onChange={e=>setDiagnosticSport(e.target.value)}>
              <option value="nfl">NFL</option><option value="cfb">CFB</option>
            </select></label>
            <label>Private FBIS access code <input type="password" value={accessCode} autoComplete="off" disabled={checking}
              onChange={e=>setAccessCode(e.target.value)} placeholder="Access code" required /></label>
            <button type="submit" disabled={checking||!accessCode.trim()}>{checking?"Testing…":"Run one-time check"}</button>
          </form>
          <small>Operator-only, globally cached for 15 minutes. Results show HTTP statuses only; the access code is cleared immediately and is not saved in the browser.</small>
          {probeError&&<p className="kalshi-ops-error" role="alert">{probeError}</p>}
          {probe&&<div className="kalshi-ops-probe" role="status">
            <div><strong>{probe.cached?"Previous diagnostic result":"New diagnostic result"}</strong>
              <span>{probe.testedSport?.toUpperCase()} · {when(probe.checkedAt)}</span></div>
            <div><strong>Anonymous market GET</strong><span>{probe.guest?.result||"Not completed"} · HTTP {probe.guest?.httpStatus??"—"}{probe.guest?.failureKind?" · "+probe.guest.failureKind.replaceAll("_"," "):""}</span></div>
            <div><strong>Signed market GET</strong><span>{probe.signed?.result||"Not completed"} · HTTP {probe.signed?.httpStatus??"—"}{probe.signed?.failureKind?" · "+probe.signed.failureKind.replaceAll("_"," "):""}</span></div>
            <p>Diagnosis: {String(probe.diagnosis||"INCONCLUSIVE").replaceAll("_"," ").toLowerCase()}.
              {probe.diagnosis==="ANONYMOUS_RATE_LIMIT_AUTHENTICATED_ACCEPTED"
                ?" Signed market access works, and the scheduled collector is already configured for signed collection. The anonymous 429 is expected and does not block signed NFL/CFB snapshots."
                :" This comparison does not authorize trading or prove quote freshness."}
            </p>
            <small>Next eligible test: {when(probe.nextAllowedAt)}</small>
          </div>}
        </section>
        <div className="kalshi-ops-gates">
          {Object.entries(result.stages||{}).map(([key,state])=>
            <div key={key}><span>{key.replace(/([A-Z])/g," $1")}</span><strong>{statusText(state)}</strong></div>)}
        </div>
      </>}
    </section>
  );
}
