import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {reconcileFreeTennisIdentities} from '../lib/tennisFreeIdentity.js';
import {loadCanonicalFreeTennisFeatures} from '../lib/tennisFreeCanonicalFeatures.js';
import {loadValidatedCurrentTennisElo} from '../lib/tennisCurrentEloResearch.js';
const send=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 if(env.TENNIS_FREE_RESEARCH_ENABLED!=='true')return send({ok:false,reason:'RESEARCH_DISABLED'},409);
 if(!env.TENNIS_DB?.prepare)return send({ok:false,reason:'TENNIS_SHARD_UNBOUND'},503);
 try{return send(await reconcileFreeTennisIdentities(env.TENNIS_DB));}
 catch(e){return send({ok:false,reason:String(e.message||'IDENTITY_REFRESH_UNAVAILABLE')},503);}
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 if(!env.TENNIS_DB?.prepare||!env.DB?.prepare)return send({ok:false,reason:'DATABASE_BINDING_MISSING'},503);
 const url=new URL(request.url);
 const id=url.searchParams.get('player_id');
 if(!id)return send({ok:false,reason:'CANONICAL_PLAYER_ID_REQUIRED'},400);
 const asOf=url.searchParams.get('as_of')||new Date().toISOString();
 try{
  const features=await loadCanonicalFreeTennisFeatures(env.TENNIS_DB,{playerId:id,asOf});
  if(!features.ok)return send(features,404);
  // Elo originates in a separately archived research snapshot, never in TML.
  // A complete, contemporaneously observed source run is mandatory.
  const eloSource=await loadValidatedCurrentTennisElo(env.DB,{now:new Date(asOf)});
  const run=eloSource.snapshots?.get(features.researchStats.tour);
  let elo=null;
  if(run){
   const e=await env.DB.prepare(`SELECT e.overall_elo,e.hard_elo,e.clay_elo,e.grass_elo,
      e.elo_rank,e.report_date,e.retrieved_at,e.source_hash
      FROM tennis_players p JOIN tennis_abstract_elo_players e
       ON e.tour=p.tour AND e.player_key=p.normalized_name
      WHERE p.fbis_player_id=? AND e.report_date=? AND e.source_hash=?
       AND julianday(e.retrieved_at)<=julianday(?)
      LIMIT 1`).bind(id,run.report_date,run.source_hash,asOf).first();
   if(e)elo={overall:e.overall_elo,hard:e.hard_elo,clay:e.clay_elo,
    grass:e.grass_elo,rank:e.elo_rank,sourceReportDate:e.report_date,
    observedAt:e.retrieved_at,source:'TENNIS_ABSTRACT_CURRENT_ELO_RESEARCH_ONLY',
    derivedFromCurrentFreeStats:false,contractTradingAuthorized:false};
  }
  return send({...features,elo,eloCoverage:elo?'RECENT_COMPLETE_RESEARCH_REPORT':'NO_VERIFIED_RECENT_REPORT',
   exactMatchChronologyAvailable:false,projectionEligible:false});
 }catch(e){return send({ok:false,reason:String(e.message||'RESEARCH_PROFILE_UNAVAILABLE'),
  contractTradingAuthorized:false},503);}
}
