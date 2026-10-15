import React from "react";
import {marketDisplayAmerican,signedAmerican} from "../../lib/marketQuoteDisplay.js";
import {selectPinnoddsGameMarkets,pinnoddsMarketOrder} from "../../lib/pinnoddsMarketSelection.js";
import "./pinnoddsCardMarkets.css";

const signed=v=>v==null?"—":v>0?"+".concat(String(v)):String(v);
const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString("en-US",{
  timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"
}):"Time unverified";
const labels={spread:"POINT SPREAD",total:"GAME TOTAL",moneyline:"MONEYLINE"};
const icons={spread:"↗",total:"Σ",moneyline:"★"};
const name=(game,side)=>{
  const team=game?.[side];
  return team?.abbr||team?.shortName||team?.name||side.toUpperCase();
};
const lineText=(family,q)=>family==="spread"?signed(q.line):family==="total"?`${q.side==="over"?"O":"U"} ${q.line}`:"ML";
const quoteLabel=(game,family,q)=>family==="spread"||family==="moneyline"?name(game,q.side):q.side.toUpperCase();

/** Display-only, bookmaker-captured and non-executable. Every quoted handicap has its own price. */
export default function PinnoddsCardMarkets({game,marketFamilies,compact=false}){
  const selection=selectPinnoddsGameMarkets(game);
  const sport=String(game?.sport||"").toLowerCase();
  const order=marketFamilies||pinnoddsMarketOrder(sport);
  if(!order.length)return null;
  const available=order.some(f=>selection.families[f]);
  const highPriority=["cfb","nfl","cbb","nba","wnba"].includes(sport);
  return <section className={`pinnodds-board-odds fbis-priced-markets ${highPriority?"fbis-priced-markets-priority":"fbis-priced-markets-secondary"}${compact?" is-compact":""}`} aria-label="PinnOdds spread and total lines with American odds">
    <header className="fbis-priced-header">
      <span className="fbis-priced-heading"><b className="fbis-priced-flare" aria-hidden="true">◆</b>
        <span><strong>PINNODDS</strong><small>{highPriority?"SPREADS + TOTALS":"TOTALS + HANDICAPS"}</small></span>
      </span>
      <span className="fbis-priced-research-tag">CAPTURED · RESEARCH</span>
    </header>
    {available?<div className="fbis-priced-grid">{order.map(f=>{
      const market=selection.families[f];
      if(!market)return <div key={f} className={`fbis-priced-family fbis-priced-${f} is-unavailable`}>
        <div className="fbis-priced-family-head"><span aria-hidden="true">{icons[f]}</span><strong>{labels[f]}</strong></div>
        <p>Matched full-game lines unavailable</p>
      </div>;
      return <div key={f} className={`fbis-priced-family fbis-priced-${f}`}>
        <div className="fbis-priced-family-head"><span aria-hidden="true">{icons[f]}</span><strong>{labels[f]}</strong>
          <small>{market.primaryVerified?"MAIN LINE":"MAIN UNVERIFIED"}</small>
        </div>
        <div className="fbis-priced-selections">{market.quotes.map(q=><div className={`fbis-priced-selection fbis-priced-${q.side}`} key={`${q.side}:${q.line}`}>
          <span className="fbis-priced-team">{quoteLabel(game,f,q)}</span>
          <strong className="fbis-priced-line">{lineText(f,q)}</strong>
          <span className="fbis-priced-odds">{signedAmerican(marketDisplayAmerican(q))}</span>
        </div>)}</div>
      </div>;
    })}</div>:<p className="fbis-priced-empty">No matched, paired full-game PinnOdds spread or total quotes. No odds inferred.</p>}
    <p className="fbis-priced-footnote">
      <b>PINNODDS CAPTURE:</b> {stamp(selection.capturedAt)} · Provider quote time unverified.
      {available?" Paired lines and their exact prices; bookmaker main-line designation may be unverified.":""}
      {" "}Not live/executable · No automatic bet authorization.
    </p>
  </section>;
}
