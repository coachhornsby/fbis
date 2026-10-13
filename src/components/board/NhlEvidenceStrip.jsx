import { buildNhlCardEvidence } from "../../lib/nhlCardEvidence.js";
import "./nhlEvidenceStrip.css";

export default function NhlEvidenceStrip({game,vm,expanded=false}){
  const e=buildNhlCardEvidence(game,vm);
  if(!e)return null;
  const a=e.moneyline,b=e.market;
  return <section className={`nhl-evidence${expanded?" is-expanded":""}`} aria-label="NHL model moneyline, market and goalie source coverage">
    <div className="nhl-evidence-head"><strong>NHL INTELLIGENCE</strong><span>RESEARCH · NO WAGER AUTHORITY</span></div>
    <div className="nhl-evidence-grid">
      <div className="nhl-evidence-block nhl-evidence-model">
        <span>MODEL ML · INCLUDING OT / SO</span>
        <strong>{a.valid?`${e.away} ${a.away} · ${e.home} ${a.home}`:"INTEGRITY HOLD"}</strong>
        <small>{a.integrity} · {e.model}</small>
      </div>
      <div className="nhl-evidence-block nhl-evidence-market">
        <span>MARKET ML · SOURCE-BOUND</span>
        <strong>{b.home==="—"&&b.away==="—"?"NO MARKET PRICE":`${e.away} ${b.away} · ${e.home} ${b.home}`}</strong>
        <small>{b.role}{b.book?` · ${b.book}`:""}{b.observedAt?` · ${b.observedAt}`:""}</small>
      </div>
      <div className="nhl-evidence-block nhl-evidence-goalies">
        <span>GOALIE CONTEXT · SOURCE STATUS</span>
        <div className="nhl-goalie-pair">{[["away",e.away],["home",e.home]].map(([side,abbr])=><div key={side} className={`nhl-goalie-side${e.goalies[side].sourced?"":" is-unverified"}`}>
          <span>{abbr}</span><strong>{e.goalies[side].name==="No sourced goalie"?"Starter not identified":e.goalies[side].name}</strong><small>{e.goalies[side].state}</small>
        </div>)}</div>
      </div>
    </div>
    <div className="nhl-evidence-coverage"><strong>DATA COVERAGE</strong>{Object.entries(e.coverage).map(([key,state])=><span key={key} className={state==="AVAILABLE"||state==="CONFIRMED"?"is-ready":"is-missing"}>{key.toUpperCase()}: {state.replaceAll("_"," ")}</span>)}</div>
    {expanded||e.notes.length?<div className="nhl-evidence-note">{e.notes.length?e.notes.join(" · "):"All listed evidence is present; projections and market comparisons remain research-only."}{expanded&&a.reason?` · ML: ${a.reason}`:""}</div>:null}
  </section>;
}
