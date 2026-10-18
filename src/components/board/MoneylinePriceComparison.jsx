import {usePolymarketQuotes} from '../../lib/usePolymarketQuotes.js';
import React from "react";
import {buildMoneylinePriceComparison} from "../../lib/marketPriceComparison.js";
import {signedAmerican} from "../../lib/marketQuoteDisplay.js";
import TeamLogo from "../TeamLogo.jsx";
import "./moneylinePriceComparison.css";

const percent=p=>p==null?"—":`${(p*100).toFixed(2)}%`;
const american=p=>p==null?"—":signedAmerican(p);
const bookImplied=a=>a==null||!Number.isFinite(Number(a))||Number(a)===0?null:
  Number(a)<0?-Number(a)/(-Number(a)+100):100/(Number(a)+100);
const gap=r=>{
 const implied=bookImplied(r.pinnoddsAmerican),model=r.fbisProbability;
 return implied==null||model==null?null:Math.round((model-implied)*1000)/10;
};
const stamp=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}):"Time unavailable";
const pp=v=>v==null?"—":`${v>0?"+":""}${v.toFixed(1)} pp`;
export default function MoneylinePriceComparison({game}){
 const live=usePolymarketQuotes(game);
 const {rows,hasPrices,researchOnly,projectionState}=buildMoneylinePriceComparison(live.game);
 if(!hasPrices)return null;
 const hasPolymarket=rows.some(r=>r.polymarketProbability!=null);
 const priced=rows.map(r=>({...r,modelBookGap:gap(r)}));
 const best=priced.filter(r=>r.modelBookGap!=null&&r.modelBookGap>0).sort((a,b)=>b.modelBookGap-a.modelBookGap)[0]||null;
 return <section className="gc-reference fbis-moneyline-comparison" aria-label="PinnOdds Polymarket and FBIS moneyline price comparison">
  <header className="fbis-moneyline-header">
   <strong>◆ MONEYLINE PRICEBOARD</strong>
   <span><i>PINNODDS</i> / <i>POLYMARKET</i> / <i>FBIS FAIR</i></span>
  </header>
  {live.updateError?<p className="fbis-moneyline-note" role="status">Market updates unavailable · check quote times before acting</p>:null}
  {best?<div className="fbis-moneyline-gap-banner">
    {game?.[best.side]?<TeamLogo team={game[best.side]} size={36}/>:null}
    <div><strong>{best.label}</strong><span>Largest positive FBIS vs PinnOdds implied-probability difference</span></div>
    <b>{pp(best.modelBookGap)}</b>
   </div>:null}
  <div className="fbis-moneyline-cards">{priced.map(r=><div key={r.side} className={`fbis-moneyline-side fbis-moneyline-${r.side}`}>
   <div className="fbis-moneyline-team">
    {game?.[r.side]?<TeamLogo team={game[r.side]} size={38}/>:null}
    <h4>{r.label}</h4>
    {r.modelBookGap!=null?<span className={`fbis-moneyline-gap-pill${r.modelBookGap>0?" is-positive":""}`}>FBIS − RAW IMPLIED {pp(r.modelBookGap)}</span>:null}
   </div>
   <div className="fbis-moneyline-triplet" style={!hasPolymarket?{gridTemplateColumns:"repeat(2,minmax(0,1fr))"}:undefined}>
    <div className="fbis-moneyline-venue fbis-moneyline-pin">
      <span>PINNODDS</span><strong>{american(r.pinnoddsAmerican)}</strong><small>Captured reference · {stamp(r.pinnacleCapturedAt)}</small>
    </div>
    {hasPolymarket ? <div className="fbis-moneyline-venue fbis-moneyline-poly">
      <span>POLYMARKET</span><strong>{percent(r.polymarketProbability)}</strong><b>{american(r.polymarketAmerican)}</b><small>Implied American · before fees</small><small>{stamp(r.polymarketObservedAt)}</small>
    </div> : null}
    <div className="fbis-moneyline-venue fbis-moneyline-fbis">
      <span>FBIS MODEL</span><strong>{percent(r.fbisProbability)}</strong><b>{american(r.fbisFairAmerican)}</b><small>Win % · Fair odds</small>
    </div>
   </div>
   <div className="fbis-poly-intelligence" data-state={r.polymarketIntelligence.state}>
    <strong>{r.polymarketIntelligence.state} · POLYMARKET</strong>
    <dl>
     <div><dt>BUY / SELL</dt><dd>{american(r.polymarketIntelligence.askAmerican)} / {american(r.polymarketIntelligence.bidAmerican)}</dd></div>
     <div><dt>NET GAP · EST.</dt><dd>{pp(r.polymarketIntelligence.netEdge==null?null:r.polymarketIntelligence.netEdge*100)}</dd></div>
     <div><dt>BREAK-EVEN · EST.</dt><dd>{r.polymarketIntelligence.maxEntry==null?"—":`${(r.polymarketIntelligence.maxEntry*100).toFixed(1)}¢`}</dd></div>
     <div><dt>DEPTH AT $5</dt><dd>{r.polymarketIntelligence.averageEntry==null?"Unverified":`${(r.polymarketIntelligence.averageEntry*100).toFixed(1)}¢ avg.`}</dd></div>
    </dl>
    <p>{r.polymarketIntelligence.synopsis}</p>
    <small>Manual review · standard taker fee estimate · no assumed rebate{r.polymarketIntelligence.delivery==='MARKET_HISTORY_RECOVERY'?" · recovery feed":""}</small>
   </div>
  </div>)}</div>
  {!hasPolymarket ? <p className="fbis-moneyline-note">Polymarket: no matched observed price for this event.</p> : null}
  <p className="fbis-moneyline-note">FBIS − book gap is a percentage-point comparison against the PinnOdds quoted implied probability (including vig), not a calibrated betting edge. Polymarket contract prices are before fees; a missing source shows —. {researchOnly?"No automatic wager authorization. ":""}{projectionState?`Model: ${String(projectionState).replaceAll("_"," ")}.`:""}</p>
 </section>;
}
