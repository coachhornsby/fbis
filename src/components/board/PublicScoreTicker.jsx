import TeamLogo from '../TeamLogo.jsx';
import {SNAPSHOT_MAX_AGE_MS}from'../../../functions/lib/publicBoardSnapshot.js';
export default function PublicScoreTicker({games,clock,busy}){
 const priority={live:0,scheduled:1,final:2};
 const items=[...games].sort((a,b)=>(priority[a.status]??3)-(priority[b.status]??3)||a.start.localeCompare(b.start));
 function render(g,i,copy){
  const stale=!Number.isFinite(Date.parse(g.capturedAt))||clock-Date.parse(g.capturedAt)>SNAPSHOT_MAX_AGE_MS;
  const hasScore=g.status==='live'||g.status==='final';
  const detail=stale?'Score update delayed':g.status==='scheduled'?new Date(g.start).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})+' CT':g.statusDetail;
  return <div className={'public-score-item'+(!stale&&g.status==='live'?' is-live':'')} key={`${g.sport}-${g.id}-${i}-${copy}`}>
    <div className="public-score-meta"><b>{g.sport.toUpperCase()}{g.tour?' · '+g.tour.toUpperCase():''}</b><span>{!stale&&g.status==='live'?'● LIVE · ':''}{detail}</span></div>
    {[g.away,g.home].map((team,index)=><div className="public-score-team" key={index}><TeamLogo team={team} size={22}/><span>{team.abbr||team.name}</span><strong>{hasScore&&team.score!=null?team.score:'—'}</strong></div>)}
  </div>;
 }
 return <section className="public-score-ticker" aria-label="Live scoreboard"><div className="public-score-heading"><strong>LIVE SCOREBOARD</strong><span>{busy?'Updating…':'Scores refresh every minute'}</span></div>
  {items.length?<div className="public-score-viewport" tabIndex={0} aria-label="Scores; hover or focus to pause scrolling"><div className="public-score-track" style={{'--ticker-duration':`${Math.max(30,items.length*5)}s`}}><div className="public-score-group">{items.map((g,i)=>render(g,i,0))}</div><div className="public-score-group" aria-hidden="true">{items.map((g,i)=>render(g,i,1))}</div></div></div>:<p className="public-score-empty">{busy?'Loading scores…':'No scores available for this date. Check the source status below.'}</p>}
 </section>;
}
