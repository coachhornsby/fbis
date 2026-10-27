import {useEffect,useState} from 'react';
export default function NhlInjuryIntelligence({game}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState(null);
 const id=game?.id;
 useEffect(()=>{
  if(!open||!id)return;
  const controller=new AbortController();let active=true;
  setData(null);setError(null);
  fetch(`/api/nhl-intelligence?id=${encodeURIComponent(id)}`,{signal:controller.signal})
   .then(async r=>{const d=await r.json();if(!r.ok||!d.ok)throw Error(d.reason||'Source unavailable');return d;})
   .then(d=>{if(active)setData(d);}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);});
  return()=>{active=false;controller.abort();};
 },[open,id]);
 if(String(game?.sport||'').toLowerCase()!=='nhl')return null;
 return <details className="agd-intelligence" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Injuries &amp; Goaltenders</summary>
  {open&&<div aria-live="polite">
   {error?<p>Source unavailable: {error}</p>:!data?<p>Loading source evidence…</p>:<>
    <p>Injury intelligence · incomplete coverage · checked {data.checkedAt}</p>
    <div className="game-ws-metrics">{['away','home'].map(side=>{
     const report=data.injuries[side],goalie=data.goalies?.[side];
     return <section key={side} style={{flex:'1 1 260px',padding:12}}>
      <h4>{game[side]?.abbr||report.team?.toUpperCase()} · {side}</h4>
      <p>Injuries: {report.state.replaceAll('_',' ')}</p>
      {!report.players.length&&<p>No verified injury report available. Team health is unknown.</p>}
      {report.players.map(p=><p key={p.canonicalPlayerId}><strong>{p.name} · {p.position} · {p.status}</strong><br/>
       {p.injury||'Injury detail unavailable'}{p.expectedReturn?` · Return: ${p.expectedReturn}`:''}
       <br/><a href={p.sourceUrl} target="_blank" rel="noopener noreferrer">{p.source}</a> · {p.sourceUpdatedAt}{p.stale?' · STALE':''}</p>)}
      <h4>Starting goalie</h4>
      <p>{goalie?.state==='CONFIRMED'?'CONFIRMED STARTER':goalie?.state==='PROJECTED'?'PROJECTED STARTER':goalie?.priorGameStarter?'PREVIOUS STARTER · upcoming starter unknown':'UNKNOWN'}</p>
      {goalie?.name&&<p>{goalie.name}</p>}
      <p>{goalie?.source||'No current-game source'}{goalie?.evidenceAt?` · ${goalie.evidenceAt}`:''}</p>
      {goalie?.reason&&<p>{goalie.reason.replaceAll('_',' ')}</p>}
     </section>;
    })}</div>
    <p>ESPN automated injury collection awaits provider permission. Official roster membership does not establish health. Research context only.</p>
   </>}
  </div>}
 </details>;
}
