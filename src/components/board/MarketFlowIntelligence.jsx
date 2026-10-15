import {useEffect,useState} from "react";
import TeamLogo from "../TeamLogo.jsx";
import {matchupTeamColors} from "../../lib/matchupTeamBrand.js";
import "./marketFlowIntelligence.css";
let cached=null,loadedAt=0,pending=null;
function load(){
 if(cached&&Date.now()-loadedAt<20000)return Promise.resolve(cached);
 if(!pending)pending=fetch('/api/market-flow').then(r=>r.ok?r.json():null).then(v=>{cached=v;loadedAt=Date.now();return v;}).catch(()=>null).finally(()=>{pending=null;});
 return pending;
}
const name=t=>typeof t==='string'?t:t?.fullName||t?.name||'';
export default function MarketFlowIntelligence({game}){
 const [data,setData]=useState(null);
 const offers=(game?.market?.venueOffers||[]).filter(o=>String(o.source||'').startsWith('Polymarket US'));
 const eligible=offers.length>0;
 useEffect(()=>{if(!eligible)return;let active=true;const update=()=>load().then(v=>{if(active)setData(v);});update();const timer=setInterval(update,30000);return()=>{active=false;clearInterval(timer);};},[eligible]);
 if(!eligible)return null;
 const slugs=new Set(offers.map(o=>o.sourceMarketId));
 const rows=(data?.markets||[]).filter(m=>slugs.has(m.marketSlug)&&String(m.identity?.eventId)===String(game.id));
 const row=rows.find(r=>r.identity?.family==='moneyline')||rows[0];
 const selection=row?.identity?.selection;
 const teams=[typeof game.awayTeam==='object'?game.awayTeam:game.away||game.awayTeam,typeof game.homeTeam==='object'?game.homeTeam:game.home||game.homeTeam];
 const team=teams.find(t=>name(t)&&name(t).toLowerCase()===String(selection).toLowerCase());
 // An opposing team requires explicit two-outcome settlement verification.
 const binary=row?.identity?.twoTeamWinnerVerified===true;
 const state=row?.state||'INSUFFICIENT DATA';
 const move=row?.movement;
 return <section className="mfi" aria-label="Market intelligence">
  <header><strong>MARKET INTELLIGENCE</strong><span>RESEARCH · LAST 15 MIN</span></header>
  <div className="mfi-selection">{team?<TeamLogo team={team} size={28}/>:null}<b>{selection||'Trading pressure'}</b></div>
  <strong>{state==='TRADING PRESSURE'&&binary?`Trading pressure favors ${row.yesShare>=.5?selection:row.identity.opposingSelection}`:state==='TRADING PRESSURE'?'Observed directional trading available':state}</strong>
  {binary&&row.yesShare!=null?[{team,label:selection,share:row.yesShare},{team:teams.find(t=>t!==team),label:row.identity.opposingSelection,share:row.noShare}].map((r,i)=><div className="mfi-bar" key={i}><span>{r.label}</span><b>{(r.share*100).toFixed(0)}%</b><div><i style={{width:`${r.share*100}%`,background:matchupTeamColors(r.team).primary||'#38bdf8'}}/></div></div>):<p>{data?.enabled===false?'Trade capture awaits resource verification.':row?'Outcome mapping or source coverage is incomplete.':'No verified trade window for this matchup.'}</p>}
  {move?<p>Last traded price: {(move.start*100).toFixed(1)}% → {(move.end*100).toFixed(1)}% · {move.changePp>0?'+':''}{move.changePp.toFixed(1)} pp<br/><small>{move.startAt} → {move.endAt} · Observed interval</small></p>:null}
  <details><summary>Flow Analysis · liquidity & evidence</summary>
   <p>{row?.classifiedTrades??0} classified trades · {row?.validQuantity??0} {row?.quantityUnit||'quantity units unverified'}</p>
   <p>Source coverage: {row?.coverageComplete?'Complete observed window':'Incomplete'} · {row?.reasons?.join(', ')||'No complete trade evidence'}</p>
   <p>Potential informed flow: Unverified · Prospective validation pending</p>
   {row?.latestBook?<><p>Observed bid {row.latestBook.bestBid??'—'} · ask {row.latestBook.bestAsk??'—'} · {row.latestBook.marketState||'State unavailable'}</p><small>Observed {row.latestBook.sourceObservedAt||row.latestBook.at} · Fill availability unverified</small></>:null}
   <p>Trading quantity describes observed aggressive activity. It does not represent ticket counts or individual bettors. Model projections and wagering gates remain separate.</p>
  </details>
 </section>;
}
