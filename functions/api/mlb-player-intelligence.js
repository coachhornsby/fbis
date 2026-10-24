import { loadCanonicalPropHistory } from '../lib/propHistoryResearch.js';
import { resolvePropResearchEnv } from '../lib/propResearchData.js';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'public,max-age=300'}});
export async function onRequestGet({env,request}) {
 const u=new URL(request.url),id=u.searchParams.get('playerId')||'',market=u.searchParams.get('market')||'hits';
 if(!/^\d+$/.test(id))return reply({ok:false,error:'Official MLB player ID required'},400);
 const asOf=new Date().toISOString();
 const read=async path=>{const r=await fetch('https://statsapi.mlb.com/api/v1/'+path,{signal:AbortSignal.timeout(6500)});if(!r.ok)throw Error('MLB_SOURCE_'+r.status);return r.json();};
 try{
  const owner=await resolvePropResearchEnv(env,'mlb');if(!owner.ok)return reply({ok:false,error:'MLB owner unavailable'},503);
  const [person,history]=await Promise.all([read(`people/${id}?hydrate=stats(group=[hitting,pitching],type=[season],season=${new Date().getUTCFullYear()})`),loadCanonicalPropHistory(owner.env,{sport:'mlb',provider:'mlb',playerId:id,market,asOf})]);
  const player=person.people?.find(p=>String(p.id)===id);if(!player)return reply({ok:false,error:'Official player not found'},404);
  let stored=null;
  if(owner.db?.prepare)try{stored=await owner.db.prepare('SELECT profile_json,as_of FROM mlb_player_state_profiles WHERE player_id=?').bind(id).first();}catch{}
  let state=null;try{state=JSON.parse(stored?.profile_json||'null');}catch{}
  return reply({ok:true,canonicalPlayerId:`mlb:mlb:${id}`,player,history,storedState:state,storedAsOf:stored?.as_of||null,sourceFetchedAt:asOf,owner:owner.binding,canAuthorizeWager:false});
 }catch{return reply({ok:false,error:'Official MLB profile unavailable'},502);}
}
