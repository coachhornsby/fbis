import React from "react";
import {marketDisplayAmerican,signedAmerican} from "../../lib/marketQuoteDisplay.js";
import {selectPinnoddsGameMarkets,pinnoddsMarketOrder} from "../../lib/pinnoddsMarketSelection.js";
import {pinnoddsReferenceDifference} from "../../lib/pinnoddsReferenceDifference.js";
import "./pinnoddsCardMarkets.css";

const sign=v=>v==null?"—":v>0?`+${v}`:String(v);
const one=v=>v==null?"—":Number(v).toFixed(1);
const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString("en-US",{
 timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"
}):"—";
const labels={spread:"POINT SPREAD",total:"GAME TOTAL",moneyline:"MONEYLINE"};
const icons={spread:"↗",total:"Σ",moneyline:"★"};
const team=(game,side)=>game?.[side]?.abbr||game?.[side]?.shortName||game?.[side]?.name||side.toUpperCase();
const offered=(family,q)=>family==="spread"?sign(q.line):family==="total"?`${q.side==="over"?"O":"U"} ${q.line}`:"ML";
const side=(game,family,q)=>family==="spread"||family==="moneyline"?team(game,q.side):q.side.toUpperCase();

export default function PinnoddsCardMarkets({game,projection,marketFamilies,compact=false}){
 const selection=selectPinnoddsGameMarkets(game);
 const sport=String(game?.sport||"").toLowerCase();
 const order=marketFamilies||["moneyline",...pinnoddsMarketOrder(sport).filter(f=>f!=="moneyline")];
 if(!order.length || !game?.pinnoddsResearch?.offers?.length)return null;
 const difference=pinnoddsReferenceDifference(game,projection);
 const priority=["cfb","nfl","cbb","nba","wnba"].includes(sport);
 const hasPaired=order.some(f=>selection.families[f]);
 return <section className={`pinnodds-board-odds fbis-priced-markets ${priority?"fbis-priced-markets-priority":"fbis-priced-markets-secondary"}${compact?" is-compact":""}`} aria-label="PinnOdds prices compared with FBIS modeled point lines">
  <header className="fbis-priced-header">
   <span className="fbis-priced-heading"><b className="fbis-priced-flare" aria-hidden="true">◆</b>
    <span><strong>PINNODDS <span className="fbis-priced-diamond">× FBIS</span></strong><small>{priority?"SPREADS · TOTALS · PROJECTED DIFFERENCE":"TOTALS · HANDICAPS · PROJECTED DIFFERENCE"}</small></span>
   </span>
   <span className="fbis-priced-research-tag">MARKET REFERENCE</span>
  </header>
  <div className="fbis-priced-grid">{order.map(f=>{
   const pair=selection.families[f],diff=f==="spread"?difference.spread:f==="total"?difference.total:null;
   return <div key={f} className={`fbis-priced-family fbis-priced-${f}${pair?"":" is-unavailable"}`}>
    <div className="fbis-priced-family-head"><span aria-hidden="true">{icons[f]}</span><strong>{labels[f]}</strong>
     {pair?<small>PINNODDS</small>:<small>NO PRICE</small>}
    </div>
    {pair?<div className="fbis-priced-selections">{pair.quotes.map(q=>
     <div key={`${q.side}:${q.line}`} className={`fbis-priced-selection fbis-priced-${q.side}`}>
      <span className="fbis-priced-team">{side(game,f,q)}</span>
      <strong className="fbis-priced-line">{offered(f,q)}</strong>
      <span className="fbis-priced-odds">{signedAmerican(marketDisplayAmerican(q))}</span>
     </div>)}</div>:<p>Paired PinnOdds line not available</p>}
    {diff?<div className="fbis-priced-model-row">
     <div className="fbis-priced-model-value"><span>FBIS PROJECTED</span>
      <strong>{f==="spread"?`${team(game,"home")} ${sign(one(diff.modelHome))}`:one(diff.modelTotal)}</strong>
     </div>
     <div className="fbis-priced-gap-value"><span>LINE DIFFERENCE</span><strong>{one(diff.absDelta)}</strong>
      <small>{f==="spread"?`Toward ${diff.side==="away"?team(game,"away"):diff.side==="home"?team(game,"home"):"EVEN"}`:diff.side.toUpperCase()}</small>
     </div>
    </div>:f!=="moneyline"&&projection?.available&&pair?<div className="fbis-priced-model-row"><span>FBIS comparison unavailable</span></div>:null}
   </div>;
  })}</div>
  {!hasPaired?<p className="fbis-priced-empty">No verified paired PinnOdds moneyline, spread or total in this captured market. FBIS projections remain independent.</p>:null}
  <p className="fbis-priced-footnote"><b>PINNODDS LAST CAPTURE:</b> {stamp(selection.capturedAt)}. Matched line with its quoted American price. Projected point differences are not cover probability, EV, or an executable bet; quotes may change.</p>
 </section>;
}
