import {useState} from "react";
import "./cfbThreeVenueLines.css";
const pct=v=>v==null||!Number.isFinite(Number(v))?"—":(Number(v)*100).toFixed(1)+"%";
const american=v=>v==null||!Number.isFinite(Number(v))?"—":Number(v)>0?"+"+Math.round(v):String(Math.round(v));
const signed=v=>Number(v)>0?"+"+Number(v):String(Number(v));
const marketLabel=m=>m==="moneyline"?"ML":m==="spread"?"SPREAD":"TOTAL";
export default function CfbThreeVenueLines({game,compact=false}){
 const [expanded,setExpanded]=useState(false);
 if(String(game?.sport||"").toLowerCase()!=="cfb")return null;
 const shop=game?.cfbMarketShopping;
 if(!shop)return null;
 const all=Array.isArray(shop.bestPrices)?shop.bestPrices:[];
 const count=shop.providerCoverage||{};
 const list=expanded?all:all.slice(0,compact?3:6);
 return <section className={"cfb-three-venue"+(compact?" is-compact":"")} aria-label="CFB PinnOdds Polymarket Kalshi odds comparison">
  <header className="cfb-three-venue-header"><div><strong>THREE-VENUE LINE SHOP</strong><small>ML · SPREAD · TOTAL · INDEPENDENT PROVIDER PRICES</small></div>
   <div className="cfb-venue-counts"><span>PinnOdds {count.PinnOdds||0}</span><span>Polymarket {count["Polymarket US"]||0}</span><span>Kalshi {count.Kalshi||0}</span></div></header>
  {list.length?<div className="cfb-three-venue-scroll"><table>
   <thead><tr><th>Market</th><th>Selection</th><th>Best source</th><th>Odds</th><th>Market %</th><th>FBIS %</th><th>Gross EV</th></tr></thead>
   <tbody>{list.map((q,i)=><tr key={[q.marketFamily,q.side,q.line,i].join("|")}>
    <td>{marketLabel(q.marketFamily)}</td>
    <td><strong>{q.selection}{q.marketFamily==="moneyline"?" ML":q.marketFamily==="spread"?" "+signed(q.line):" "+q.line}</strong></td>
    <td>{q.source}<small>{(q.alternativeProviders||[]).length?" · "+q.alternativeProviders.length+" other":" · only source"}</small></td>
    <td className="cfb-quote-emphasis">{american(q.americanEquivalent)}</td>
    <td>{pct(q.impliedProbability)}</td>
    <td>{pct(q.modelProbability)}</td>
    <td className={q.grossExpectedRoi>0?"cfb-positive-gross":""}>{q.grossExpectedRoi==null?"—":(q.grossExpectedRoi>0?"+":"")+(q.grossExpectedRoi*100).toFixed(1)+"%"}</td>
   </tr>)}</tbody></table></div>:<p className="cfb-venue-empty">No matched, current pregame offers. Quotes are not inferred from historical prices.</p>}
  {all.length>(compact?3:6)&&<button type="button" className="cfb-venue-expand" onClick={e=>{e.stopPropagation();setExpanded(v=>!v);}}>{expanded?"Show fewer lines":"Compare all "+all.length+" matched selections"}</button>}
  <p className="cfb-venue-footnote">
   Best listed price for each exact side and line. Percentages are gross break-even probabilities; source capture is not execution confirmation.
   FBIS EV appears only when a frozen independent probability exists for that exact outcome. Venue fees, depth and settlement are not verified for wagering.
  </p>
 </section>;
}
