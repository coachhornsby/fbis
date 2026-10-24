import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {deriveFreeTennisStatProfile} from '../lib/tennisFreeStatProfile.js';
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.TENNIS_DB?.prepare)return json({ok:false,reason:'TENNIS_SHARD_UNBOUND'},503);
 const url=new URL(request.url),tour=url.searchParams.get('tour'),
  sourcePlayerId=url.searchParams.get('source_player_id');
 if(!['atp','wta'].includes(tour)||!/^[A-Za-z0-9_-]{1,100}$/.test(sourcePlayerId||''))
  return json({ok:false,reason:'TOUR_AND_STABLE_SOURCE_ID_REQUIRED'},400);
 try{
  const count=await env.TENNIS_DB.prepare(`SELECT COUNT(*) n
   FROM tennis_free_current_matches WHERE tour=?
    AND (winner_source_id=? OR loser_source_id=?)`)
   .bind(tour,sourcePlayerId,sourcePlayerId).first();
  if(Number(count?.n||0)>1200)return json({ok:false,reason:'RESEARCH_SAMPLE_LIMIT'},409);
  const rows=(await env.TENNIS_DB.prepare(`SELECT tour,source_date_label,last_observed_at,
    surface,winner_source_id,loser_source_id,winner_stats_json,loser_stats_json
    FROM tennis_free_current_matches WHERE tour=?
    AND (winner_source_id=? OR loser_source_id=?)
    ORDER BY source_date_label DESC,source_event_key DESC LIMIT 1200`)
    .bind(tour,sourcePlayerId,sourcePlayerId).all()).results||[];
  if(rows.length!==Number(count?.n||0))
   return json({ok:false,reason:'RESEARCH_SAMPLE_INCOMPLETE'},409);
  const profile=deriveFreeTennisStatProfile(rows,{tour,sourcePlayerId});
  return json({ok:true,asOf:new Date().toISOString(),...profile,
   profileContainsLiveCurrentSeasonData:profile.matches>0,
   precision:'TENNISMYLIFE_SOURCE_DATE_IS_NOT_VERIFIED_MATCH_START'});
 }catch(e){return json({ok:false,reason:'RESEARCH_PLAYER_PROFILE_UNAVAILABLE',
   detail:String(e.message||'DB_ERROR'),contractTradingAuthorized:false},503);}
}
