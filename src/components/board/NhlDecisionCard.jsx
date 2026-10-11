import TeamLogo from "../TeamLogo.jsx";
import { buildGameCardViewModel } from "../../lib/gameCardViewModel.js";
import { buildNhlCardEvidence } from "../../lib/nhlCardEvidence.js";
import { selectNhlCardProps } from "../../lib/nhlCardProps.js";
import "./nhlDecisionCard.css";

const number = value => value==null||value===""||!Number.isFinite(Number(value))?"—":Number(value).toFixed(1);
const factorWeight = row => {
  const v=Number(row?.value);
  return Number.isFinite(v)?Math.abs(v):0;
};
function usefulSignals(game,away,home){
  const labels={"five-v-five":"5v5 xG","special-teams":"Special teams","high-danger":"High-danger chances",rest:"Rest",finishing:"Finishing"};
  const rows=(Array.isArray(game?.matchupFactors)?game.matchupFactors:[])
    .filter(x=>x?.available!==false&&x?.value!=null&&factorWeight(x)>.001&&
      !["EVEN","NEUTRAL",""].includes(String(x?.edge||x?.advantage||"").toUpperCase()))
    .sort((a,b)=>factorWeight(b)-factorWeight(a)).slice(0,2);
  return rows.map(x=>{
    const edge=String(x.edge||x.advantage||x.team||"").toUpperCase();
    return {label:labels[x.id]||x.label||"Matchup",team:edge===String(away?.abbr||"").toUpperCase()?away.abbr:edge===String(home?.abbr||"").toUpperCase()?home.abbr:edge,
      metric:Number.isFinite(Number(x.value))?Math.abs(Number(x.value)).toFixed(2):null,id:x.id};
  });
}
const goalieLabel=(side,abbr)=>side?.sourced||side?.modeled
  ? `${abbr}: ${side.name} (${side.state})`
  : `${abbr}: unconfirmed`;

/**
 * Decision-first NHL card. Full diagnostics remain on the detail page.
 * Market price and player projections are source-bound; this view never
 * creates a bet recommendation or fills unavailable numbers with guesses.
 */
export default function NhlDecisionCard({game,vm:givenVm,onOpen,expanded=false}) {
  const vm=givenVm||buildGameCardViewModel(game);
  const e=buildNhlCardEvidence(game,vm);
  const away=vm.away||{},home=vm.home||{},p=vm.projection||{},market=vm.market||{};
  const final=Boolean(vm.event?.final||game?.final||game?.status?.completed);
  const live=Boolean(vm.event?.live||game?.live);
  const actualAway=game?.away?.score??away.score??null;
  const actualHome=game?.home?.score??home.score??null;
  const scored=(final||live)&&actualAway!=null&&actualHome!=null;
  const isPregame=!final&&!live&&Date.now()<Date.parse(game?.start||"");
  const props=selectNhlCardProps(game,{live,final});
  const signals=usefulSignals(game,away,home);
  const ml=e?.moneyline,quote=e?.market,goalies=e?.goalies;
  const mlVerified=ml?.valid&&ml?.integrity==="PIT-AUDITED RESEARCH";
  const hasQuote=quote&&(quote.home!=="—"||quote.away!=="—");
  const quoteSource=hasQuote?[quote.book,quote.role].filter(Boolean).join(" · "):"No verified paired moneyline";
  const label=final?"FINAL":live?"LIVE":"PREGAME";
  const open=typeof onOpen==="function"?()=>onOpen(game):null;
  return <article
    className={`nhlc${open?" nhlc-openable":""}${expanded?" nhlc-expanded":""}`}
    data-sport="nhl" data-game-id={game?.id||""}
    tabIndex={open?0:undefined} role={open?"button":undefined}
    onClick={open||undefined}
    onKeyDown={open?ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();open();}}:undefined}
    aria-label={open?`Open NHL analysis for ${away.abbr||"away"} and ${home.abbr||"home"}`:undefined}>
    <header className="nhlc-head">
      <div className="nhlc-headline"><span>NHL</span><strong>{vm.timing?.timeLine||"Game time unavailable"}</strong></div>
      <div className="nhlc-labels"><span className={`nhlc-state nhlc-state-${label.toLowerCase()}`}>{label}</span><span className="nhlc-research">RESEARCH ONLY</span></div>
    </header>
    {scored?<div className="nhlc-score"><span>{final?"FINAL":"LIVE"} SCORE</span><strong>{away.abbr} {actualAway} – {actualHome} {home.abbr}</strong></div>:null}
    <div className="nhlc-matchup">
      <div className="nhlc-team"><TeamLogo team={away} size={46}/><strong>{away.abbr}</strong><span title={away.fullName||away.name}>{away.fullName||away.name||""}</span></div>
      <div className="nhlc-projection"><span>FBIS PRE-GAME FORECAST</span><strong>{p.available?`${number(p.away)} – ${number(p.home)}`:"Unavailable"}</strong><small>{p.available?`Projected total ${number(p.total)} goals`:"No independent projection"}</small></div>
      <div className="nhlc-team"><TeamLogo team={home} size={46}/><strong>{home.abbr}</strong><span title={home.fullName||home.name}>{home.fullName||home.name||""}</span></div>
    </div>
    <div className="nhlc-market" aria-label="Model and sportsbook context">
      <div><span>MARKET TOTAL</span><strong>{market.total==null?"—":number(market.total)}</strong></div>
      <div><span>PUCK LINE</span><strong>{market.spreadLabel||"—"}</strong></div>
      <div><span>MONEYLINE · {mlVerified?"FBIS":"STATUS"}</span><strong>{mlVerified?`${e.away} ${ml.away} · ${e.home} ${ml.home}`:"Integrity hold"}</strong></div>
    </div>
    <div className="nhlc-quick">
      <span className="nhlc-quick-title">GOALIES</span>
      <span>{goalieLabel(goalies?.away,away.abbr)} <i>·</i> {goalieLabel(goalies?.home,home.abbr)}</span>
    </div>
    {hasQuote?<div className="nhlc-source">Market ML: {e.away} {quote.away} / {e.home} {quote.home} <span>· {quoteSource}</span></div>:
      <div className="nhlc-source">Market ML unavailable <span>· No source-verified offer</span></div>}
    {signals.length?<div className="nhlc-signals" aria-label="Two useful matchup indicators">
      {signals.map(s=><div key={s.id}><span>{s.label}</span><strong>{s.team} {s.metric!=null?`+${s.metric}`:""}</strong></div>)}
    </div>:null}
    <section className="nhlc-props" aria-label="Two FBIS player prop projections">
      <div className="nhlc-props-head"><strong>PLAYER PROJECTIONS</strong><span>FBIS MODEL · NOT BETTING PICKS</span></div>
      {props.length?<div className="nhlc-props-grid">{props.map(r=>
        <div className="nhlc-prop" key={r.player+":"+r.market}>
          <div><strong>{r.player}</strong><span>{r.team} · {r.market==="shots_on_goal"?"Shots on goal":"Points"}</span></div>
          <div><strong>{number(r.projection)}</strong><span>FBIS projection</span></div>
        </div>
      )}</div>:<p className="nhlc-props-empty">{isPregame?"Game-bound player projections not available yet":"No verified frozen pregame player projections to display"}</p>}
    </section>
    <footer className="nhlc-footer">
      <span>{p.available?"NHL-PRO-v2":"NO PURE MODEL"} · {hasQuote?"SOURCED MARKET":"NO VERIFIED ML"} · NO BET AUTHORITY</span>
      <strong>{open?"VIEW ANALYSIS →":expanded?"MODEL DETAILS BELOW":"RESEARCH"}</strong>
    </footer>
  </article>;
}
