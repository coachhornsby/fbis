import React from "react";
import {buildMoneylinePriceComparison} from "../../lib/marketPriceComparison.js";
import {signedAmerican} from "../../lib/marketQuoteDisplay.js";
import "./moneylinePriceComparison.css";

const percent=p=>p==null?"—":`${(p*100).toFixed(2)}%`;
const american=p=>p==null?"—":signedAmerican(p);
export default function MoneylinePriceComparison({game}){
 const {rows,hasPrices,researchOnly,projectionState}=buildMoneylinePriceComparison(game);
 if(!hasPrices)return null;
 return <section className="gc-reference fbis-moneyline-comparison" aria-label="PinnOdds Polymarket and FBIS moneyline prices">
  <header className="fbis-moneyline-header">
   <strong>◆ MONEYLINE PRICEBOARD</strong>
   <span><i>PINNODDS</i> / <i>POLYMARKET</i> / <i>FBIS FAIR</i></span>
  </header>
  <div className="fbis-moneyline-cards">{rows.map(r=><div key={r.side} className={`fbis-moneyline-side fbis-moneyline-${r.side}`}>
   <h4>{r.label}</h4>
   <div className="fbis-moneyline-triplet">
    <div className="fbis-moneyline-venue fbis-moneyline-pin">
      <span>PINNODDS</span>
      <strong>{american(r.pinnoddsAmerican)}</strong>
      <small>Book price</small>
    </div>
    <div className="fbis-moneyline-venue fbis-moneyline-poly">
      <span>POLYMARKET</span>
      <strong>{percent(r.polymarketProbability)}</strong>
      <b>{american(r.polymarketAmerican)}</b>
      <small>Contract-implied</small>
    </div>
    <div className="fbis-moneyline-venue fbis-moneyline-fbis">
      <span>FBIS MODEL</span>
      <strong>{percent(r.fbisProbability)}</strong>
      <b>{american(r.fbisFairAmerican)}</b>
      <small>Fair price</small>
    </div>
   </div>
  </div>)}</div>
  <p className="fbis-moneyline-note">Market prices and independent FBIS fair prices shown side-by-side. Polymarket contract probability is before fees; missing prices show —. Captured PinnOdds quotes may move. {researchOnly?"Research comparison, not an authorized wager. ":""}{projectionState?`Model: ${String(projectionState).replaceAll("_"," ")}.`:""}</p>
 </section>;
}