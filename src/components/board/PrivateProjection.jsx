import {privateProjectionFor} from '../../lib/privateBoardProjection.js';
import {cbbLineShopping} from '../../lib/cbbSideLineShopping.js';

const fmt=v=>Number(v).toFixed(1);
const odds=v=>v>0?`+${v}`:String(v);
function quoteLabel(q,team){
 return <span><strong>{q.source}</strong> · {team} {q.line>0?'+':''}{fmt(q.line)} <b>{odds(q.american)}</b>{q.marketUrl&&<a href={q.marketUrl} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}> Source</a>}</span>;
}
export default function PrivateProjection({game,packet,clock}){
 const p=privateProjectionFor(game,packet,clock);if(!p)return null;
 const s=v=>`${v>0?'+':''}${fmt(v)}`;
 const market=cbbLineShopping(game,p,clock);
 const winner=p.primary.margin>0?game.home:p.primary.margin<0?game.away:null;
 const favor=market.side?game[market.side]:null;
 const reference=market.bestPriceAtReference,better=market.bestLine;
 const at=q=>new Date(q.capturedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
 return <section className="private-card-projection" aria-label="Private FBIS CBB projection and verified line shopping">
 <strong>{p.historical?'SAVED PREGAME RESEARCH PROJECTION':'FBIS PRIVATE CBB RESEARCH PROJECTION'}</strong>
 <div className="private-score-row"><span>{game.away.name}<b>{fmt(p.primary.away)}</b></span><span>{game.home.name}<b>{fmt(p.primary.home)}</b></span></div>
 <div>Model margin (home) <b>{s(p.primary.margin)}</b> · Model total <b>{fmt(p.primary.total)}</b></div>
 <small>{p.primary.attribution||p.primary.modelId} · Unconfirmed estimate</small>
 {p.comparison&&<small>Torvik comparison: {fmt(p.comparison.away)} – {fmt(p.comparison.home)} · Home margin {s(p.comparison.margin)} · Total {fmt(p.comparison.total)}</small>}
 <div className="cbb-side-market" aria-label="CBB model side and available sportsbook prices">
   <div className="cbb-side-market-heading"><strong>PROJECTED SIDE / BEST VERIFIED BOOK</strong><span>REFERENCE ONLY</span></div>
   <div className="cbb-side-market-summary">
     <div><small>Model projected winner</small><b>{winner?.name||'Tie'}</b></div>
     <div><small>Model fair spread</small><b>{winner?winner.name+' -'+fmt(Math.abs(p.primary.margin)):'Pick'} </b></div>
   </div>
   {market.state==='REFERENCE_COMPARISON'||market.state==='NO_MATCHED_SIDE_QUOTE'?<>
      <p>Market reference: {game.home.name} {market.referenceHomeSpread>0?'+':''}{fmt(market.referenceHomeSpread)}. {market.side?<><b>Model ATS lean: {favor?.name}</b> ({fmt(market.referenceEdgePoints)} pts vs reference).</>:'No model edge at the reference line.'}</p>
      {reference?<div className="cbb-best-price"><small>{market.referenceBooks>1?'BEST PRICE AT SAME SPREAD':'ONLY VERIFIED PRICE AT THIS SPREAD'}</small>{quoteLabel(reference,favor?.name)}<small>{market.referenceBooks} matched bookmaker{market.referenceBooks===1?'':'s'} · captured {at(reference)} CT</small></div>:<small>No verified bookmaker price for the model side at the reference line.</small>}
      {better&&(!reference||better.line!==reference.line)?<div className="cbb-other-line"><small>BEST AVAILABLE POINTS (DIFFERENT SPREAD)</small>{quoteLabel(better,favor?.name)}<small>Different spreads cannot be ranked by American odds alone.</small></div>:null}
      {market.state==='NO_MATCHED_SIDE_QUOTE'&&<small>No offer for the projected ATS side.</small>}
    </>:<p className="cbb-market-unavailable">{market.state==='HISTORICAL_PROJECTION'||market.state==='GAME_NOT_PREGAME'?'Archived/started game: no claim of current best odds.':market.state==='MODEL_MARKET_ALIGNED'?'Model and observed market spread aligned. No ATS side selected.':'No verified current sportsbook prices. Model ATS side and best book cannot be determined.'}</p>}
 </div>
 <small>{p.expired?'Inputs expired':p.started?'Game started · frozen pregame estimate':`Inputs expire ${new Date(p.expiresAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})} CT`} · CBBD confirmation {p.confirmationAvailable?'available':'unavailable'} · No wager approval</small>
 </section>;
}
