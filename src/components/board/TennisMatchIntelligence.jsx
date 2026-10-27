import {useEffect,useState} from 'react';
const pct=v=>typeof v==='number'&&Number.isFinite(v)?`${(v*100).toFixed(1)}%`:'Unavailable';
export default function TennisMatchIntelligence({game}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState(null);
 const tour=String(game?.tour||game?.tennisProjection?.tour||'').toLowerCase();
 const home=game?.home?.fullName||game?.home?.name,away=game?.away?.fullName||game?.away?.name;
 useEffect(()=>{
  if(!open||!['atp','wta'].includes(tour)||!home||!away)return;
  let active=true;const controller=new AbortController();setData(null);setError(null);
  const q=new URLSearchParams({tour,home,away});
  fetch(`/api/tennis-match-intelligence?${q}`,{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok||!d.ok)throw Error(d.reason||'Source unavailable');return d;})
   .then(d=>{if(active)setData(d);}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);});
  return()=>{active=false;controller.abort();};
 },[open,tour,home,away]);
 if(String(game?.sport||'').toLowerCase()!=='tennis')return null;
 return <details className="agd-intelligence" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Player &amp; Match Intelligence</summary>
  {open&&<div aria-live="polite">{error?<p>{error}</p>:!data?<p>{['atp','wta'].includes(tour)?'Loading player research…':'Tour identity unverified'}</p>:<>
   <p>{tour.toUpperCase()} · Historical research · source dates retained</p>
   <div className="game-ws-metrics">{['away','home'].map(side=>{const p=data[side];return <section key={side} style={{flex:'1 1 260px',padding:12}}>
    <h4>{p.name}</h4><p>{p.state.replaceAll('_',' ')}</p>
    <p>Ranking: {p.rank??'Unavailable'} · {p.identitySource||'Source unavailable'} · {p.identityEffectiveAt||'Effective date unavailable'}</p>
    {p.profiles.map((r,i)=><p key={i}><strong>{r.surface||'Surface unverified'}</strong> · {r.matches??'Unknown'} matches<br/>
     Serve points won {pct(r.servePointWin)} · Return points won {pct(r.returnPointWin)}<br/>
     {r.source} · source as of {r.sourceAsOf||'unknown'} · last match {r.lastMatchDate||'unknown'}</p>)}
    {!p.profiles.length&&<p>Surface and serve/return statistics unavailable.</p>}
    <h4>Recent match evidence</h4>{p.recent.map((r,i)=><p key={i}>{r.match_date} · {r.tournament||'Tournament unavailable'} · {r.surface||'Surface unavailable'}<br/>{r.player1_name} / {r.player2_name} · {r.score||'Score unavailable'}</p>)}
    {!p.recent.length&&<p>No matched recent history.</p>}
    <p>Current withdrawals / retirements: unverified.</p>
    {p.canonicalId&&<a href={`/api/tennis-player-profile?id=${encodeURIComponent(p.canonicalId)}`} target="_blank" rel="noopener noreferrer">Full player research</a>}
   </section>;})}</div><p>SportScore data has not passed source admission. No model or wagering authority.</p>
  </>}</div>}
 </details>;
}
