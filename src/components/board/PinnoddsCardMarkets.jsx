import React from "react";
import "./pinnoddsCardMarkets.css";
import { marketDisplayAmerican, marketDisplayImplied, signedAmerican } from "../../lib/marketQuoteDisplay.js";
const val=v=>v==null||!Number.isFinite(Number(v))?"—":Number(v).toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
const line=v=>v==null?"":` · ${Number(v)>0?"+":""}${Number(v)}`;
const fmtTime=s=>s&&Number.isFinite(Date.parse(s))?new Date(s).toLocaleString("en-US",{
 timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"
}):"Unverified";
export default function PinnoddsCardMarkets({game}){
 const evidence=game?.pinnoddsResearch;
 const rows=evidence?.offers||[];
 if(!rows.length)return <section className="pinnodds-board-odds empty" aria-label="PinnOdds market availability">
  <strong>PINNODDS</strong><span>No matched, recent full-game quote · Market unavailable</span>
 </section>;
 const families=["moneyline","spread","total"];
 return <section className="pinnodds-board-odds" aria-label="PinnOdds research-only odds">
   <header><strong>PINNODDS · CAPTURED LINES</strong><span>RESEARCH ONLY · NOT EXECUTABLE</span></header>
   <div className="pinnodds-odds-grid">{families.map(f=>{
    const offers=rows.filter(r=>r.marketFamily===f);
    if(!offers.length)return null;
    return <div className="pinnodds-odds-family" key={f}>
      <b>{f==="moneyline"?"MONEYLINE":f==="spread"?"SPREAD":"TOTAL"}</b>
      {offers.map(o=><span key={[f,o.side,o.line,o.sourceMarketId].join("|")}>
       <strong>{String(o.side).toUpperCase()}{line(o.line)}</strong>
       <em>{signedAmerican(marketDisplayAmerican(o))} · {val(o.decimalOdds)} dec · {marketDisplayImplied(o)==null ? "—" : `${(marketDisplayImplied(o)*100).toFixed(1)}%`} raw implied</em>
      </span>)}
    </div>;
   })}</div>
   <small>FBIS captured {fmtTime(evidence.latestCapturedAt)}. Provider quote time unverified. These may be alternate markets; never interpret capture time as provider observation, execution price, CLV, model edge, or a qualified bet.</small>
 </section>;
}
