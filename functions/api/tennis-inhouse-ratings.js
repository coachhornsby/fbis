/** Read-only PIT in-house research ratings from canonical official outcomes. */
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {calculateInhouseTennisElo,inhouseEloMatchProbability} from '../lib/tennisInhouseElo.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function buildTennisInhouseRatings(db,{now=new Date(),maxRows=5000}={}){
 if(!db?.prepare||!Number.isFinite(+now))throw Error('INVALID_DB_OR_TIME');
 const count=await db.prepare(`SELECT COUNT(*) n FROM tennis_official_matches
 WHERE source IN ('WTA_OFFICIAL','ATP_OFFICIAL') AND completion_state='FINAL'
 AND result_reason='OFFICIAL_COMPLETED_SETS'
 AND julianday(observed_at)<=julianday(?)`).bind(now.toISOString()).first();
 if(Number(count?.n)>maxRows)throw Error('RATING_HISTORY_EXCEEDS_BOUNDED_READ');
 const read=await db.prepare(`SELECT match_id,tour,source,completion_state,result_reason,
 source_winner_id,raw_artifact_key,player1_id,player2_id,winner_id,
 match_time,observed_at,surface FROM tennis_official_matches
 WHERE source IN ('WTA_OFFICIAL','ATP_OFFICIAL') AND completion_state='FINAL'
 AND result_reason='OFFICIAL_COMPLETED_SETS'
 AND julianday(observed_at)<=julianday(?)
 ORDER BY julianday(match_time),match_id LIMIT ?`).bind(now.toISOString(),maxRows).all();
 const ratings=calculateInhouseTennisElo(read.results||[],{asOf:now});
 return {...ratings,sourceRows:Number(count?.n||0),coverageComplete:true,
  productionWriteCount:0,rightsStatus:'SOURCE_TERMS_REVIEW_REQUIRED'};
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 try{
  const url=new URL(request.url),state=await buildTennisInhouseRatings(env.DB);
  const tour=url.searchParams.get('tour'),p1=url.searchParams.get('player1'),
    p2=url.searchParams.get('player2'),surface=url.searchParams.get('surface');
  if(p1||p2){
   if(!p1||!p2||!['wta','atp'].includes(tour))return json({ok:false,reason:'PLAYER_PAIR_AND_TOUR_REQUIRED'},400);
   return json({ok:true,asOf:state.asOf,sourceRows:state.sourceRows,
    match:inhouseEloMatchProbability(state,{tour,player1:p1,player2:p2,surface}),
    source:state.source,rightsStatus:state.rightsStatus,
    canQualify:false,canAuthorizeWager:false});
  }
  return json({ok:true,asOf:state.asOf,sourceRows:state.sourceRows,
    accepted:state.accepted,skipped:state.skipped,ratingsCount:state.ratings.length,
    coverageComplete:true,source:state.source,rightsStatus:state.rightsStatus,
    canQualify:false,canAuthorizeWager:false});
 }catch(e){return json({ok:false,reason:String(e?.message||'RESEARCH_RATINGS_UNAVAILABLE'),
  canAuthorizeWager:false},503)}
}
