import React,{useEffect,useState} from 'react';
import {rankAlternateLines} from '../../lib/alternateLines.js';
import {fbisProjection} from '../../lib/boardDecision.js';
export default function AlternateLines({game}){
 const [state,setState]=useState({loading:true,offers:[]});
 useEffect(()=>{if(!['nfl','cfb'].includes(game?.sport))return;const control=new AbortController();let stopped=false;
 const refresh=async()=>{try{const r=await fetch(`/api/market-alternatives?sport=${encodeURIComponent(game.sport)}&eventId=${encodeURIComponent(game.id)}`,{signal:control.signal});const x=await r.json();if(!stopped)setState(r.ok&&x.ok?{loading:false,offers:x.offers||[]}:{loading:false,offers:[],error:true});}catch{if(!stopped)setState({loading:false,offers:[],error:true});}};
 refresh();const timer=setInterval(refresh,15000);return()=>{stopped=true;clearInterval(timer);control.abort();};},[game?.sport,game?.id]);
 if(!['nfl','cfb'].includes(game?.sport))return null;
 const ranked=rankAlternateLines(game,fbisProjection(game),state.offers);
 const top=ranked.filter(x=>x.isAlternative&&x.estimatedRoi>0).slice(0,4);
 return <section className="pinnodds-board-odds" aria-label="Alternate line comparison">
  <h3>ALTERNATE LINES · PINNODDS + POLYMARKET</h3>
  <p>A higher win rate can cost too much. Compare the estimated return, exact line, fees, and available price.</p>
  {state.loading?<p>Loading available alternatives…</p>:state.error?<p>Alternative prices unavailable. Try refreshing.</p>:!top.length?<p>No positive research estimate with the available line and model data.</p>:<div className="fbis-priced-grid">{top.map((x,i)=><div className="fbis-priced-family" key={i}><strong>{x.source}</strong><p>{['home','away'].includes(x.side)?game[x.side]?.abbr:x.side.toUpperCase()} {x.line>0?'+':''}{x.line} · {x.american>0?'+':''}{x.american??'—'}</p><p>Estimated win {(x.winProbability*100).toFixed(1)}% · return {(x.estimatedRoi*100).toFixed(1)}%</p><small>VERIFY · {x.reasons.join(' · ')}</small></div>)}</div>}
  <small>{ranked.length} line/selection comparisons. Research estimates need validation before wager use. Manual execution.</small>
 </section>;
}
