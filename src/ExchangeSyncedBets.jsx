import {useEffect,useState} from "react";
const fmt=n=>n==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n));
export default function ExchangeSyncedBets(){
 const [secret,setSecret]=useState(""),[active,setActive]=useState(false);
 const [payload,setPayload]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!active||!secret)return;
  let gone=false;
  const load=async()=>{
   setLoading(true);
   try{
    const response=await fetch("/api/exchange-bets-sync",{
      headers:{"x-fbis-account-token":secret},cache:"no-store"});
    const result=await response.json();
    if(!response.ok||!result.ok)throw new Error(result.code||"Read unavailable");
    if(!gone){setPayload(result);setError("");}
   }catch(e){if(!gone){setPayload(null);setError(String(e?.message||e));}}
   finally{if(!gone)setLoading(false);}
  };
  load();const every=setInterval(load,60000);
  return()=>{gone=true;clearInterval(every)};
 },[active,secret]);
 return <section className="panel" aria-label="Exchange synced wager history">
  <div className="panel-header"><h2>Exchange Bets <span className="bets-title-sub">Confirmed fills · Kalshi + Polymarket US</span></h2></div>
  <div className="panel-body">
   {!active?<form onSubmit={e=>{e.preventDefault();if(secret.trim())setActive(true);}}>
     <p className="muted">Private exchange wager history. Access requires your FBIS portfolio view code; no API signing keys are entered here.</p>
     <input type="password" autoComplete="off" aria-label="FBIS account view code" value={secret} onChange={e=>setSecret(e.target.value)}/>
     <button type="submit" className="header-btn" disabled={!secret.trim()}>Show exchange bets</button>
   </form>:<>
    <button className="header-btn" onClick={()=>{setActive(false);setSecret("");setPayload(null)}}>Lock private bets</button>
    {loading&&<span className="muted"> Refreshing…</span>}
    {error&&<p role="alert" className="error">Exchange history unavailable: {error}</p>}
    {payload&&<><p className="muted"> {payload.tickets.length} confirmed exchange order groups · {payload.unresolved} incomplete source fills excluded. Updated from stored account events. No model or CLV qualification is inferred.</p>
    <div className="table-scroll"><table className="fbis-table"><thead><tr><th>Exchange</th><th>Market</th><th>Side</th><th>Contracts</th><th>Stake incl. fees</th><th>Max profit</th><th>Status</th><th>Realized P/L</th><th>Ticket</th></tr></thead><tbody>
      {payload.tickets.map(t=><tr key={t.id}><td>{t.provider}</td><td>{t.marketLabel}</td><td>{t.side}</td><td>{t.contracts}</td><td>{fmt(t.risk)}</td><td>{fmt(t.toWin)}</td><td>{t.status}</td><td>{fmt(t.profit)}</td><td>{t.id}</td></tr>)}
      {!payload.tickets.length&&<tr><td colSpan="9">No complete exchange executions recorded yet.</td></tr>}
    </tbody></table></div></>}
   </>}
  </div>
 </section>
}
