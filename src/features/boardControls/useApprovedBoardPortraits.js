import {useEffect,useState,useMemo} from 'react';
export default function useApprovedBoardPortraits(groups){
 const signature=JSON.stringify((groups||[]).flatMap(g=>g.games||[]).filter(g=>g.sport==='tennis').map(g=>[String(g.tour||g.tennisProjection?.tour||'').toLowerCase(),g.home?.fullName||g.home?.name,g.away?.fullName||g.away?.name]));
 const [pack,setPack]=useState({signature:null,players:{}});
 useEffect(()=>{
  let active=true;const abort=new AbortController();const fixtures=JSON.parse(signature);
  if(!fixtures.length)return()=>abort.abort();
  (async()=>{
   const result={};
   for(const tour of ['atp','wta']){
    const names=[...new Set(fixtures.filter(r=>r[0]===tour).flatMap(r=>r.slice(1)).filter(Boolean))].slice(0,240);
    for(let i=0;i<names.length;i+=40){
     const q=new URLSearchParams({tour,names:JSON.stringify(names.slice(i,i+40))});
     try{const r=await fetch(`/api/tennis-board-portraits?${q}`,{signal:abort.signal});if(!r.ok)continue;
      const d=await r.json();if(d.ok)for(const p of d.players||[])result[`${tour}:${p.name.toLowerCase().trim()}`]=p;
     }catch(e){if(e.name==='AbortError')return;}
    }
   }if(active)setPack({signature,players:result});
  })();return()=>{active=false;abort.abort();};
 },[signature]);
 return useMemo(()=>{
  if(pack.signature!==signature)return groups;
  return groups.map(group=>({...group,games:(group.games||[]).map(game=>{
   if(game.sport!=='tennis')return game;
   const tour=String(game.tour||game.tennisProjection?.tour||'').toLowerCase();const next={...game};
   for(const side of ['home','away']){const team=game[side]||{},p=pack.players[`${tour}:${String(team.fullName||team.name||'').toLowerCase().trim()}`];
    if(p&&(!(team.canonicalId||team.fbisPlayerId)||(team.canonicalId||team.fbisPlayerId)===p.canonicalId))next[side]={...team,headshotUrl:p.portrait.url,portrait:p.portrait};
   }return next;
  })}));
 },[groups,pack,signature]);
}
