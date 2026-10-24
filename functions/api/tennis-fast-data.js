/** Real canonical D1 adapter for the free-source Tennis research interface.
 * Reads only persisted verified result rows; does not simulate feed coverage.
 */
import {load_tennis_results,tennis_fast_matchup} from '../lib/tennisFastData.js';
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export async function readTennisFastCanonical(db,{tour,asOf,maxRows=5000}={}){
 if(!db?.prepare||!['atp','wta'].includes(tour)||!Number.isFinite(Date.parse(asOf||'')))
  throw Error('DB_TOUR_OR_CUTOFF_INVALID');
 const q=await db.prepare(`SELECT COUNT(*) AS n,MAX(match_time) AS latest_match,
 MAX(observed_at) AS latest_observation FROM tennis_official_matches
 WHERE tour=? AND source=? AND completion_state='FINAL'
 AND result_reason='OFFICIAL_COMPLETED_SETS' AND observed_at<=? AND match_time<=?`)
 .bind(tour,tour.toUpperCase()+'_OFFICIAL',asOf,asOf).first();
 const count=Number(q?.n||0);
 if(count>maxRows)throw Error('VERIFIED_MATCHES_EXCEED_BOUNDED_READ');
 const data=await db.prepare(`SELECT match_id,tour,source,completion_state,result_reason,
 source_winner_id,raw_artifact_key,player1_id,player2_id,winner_id,
 match_time,observed_at,surface FROM tennis_official_matches
 WHERE tour=? AND source=? AND completion_state='FINAL'
 AND result_reason='OFFICIAL_COMPLETED_SETS' AND observed_at<=? AND match_time<=?
 ORDER BY match_time,match_id LIMIT ?`)
 .bind(tour,tour.toUpperCase()+'_OFFICIAL',asOf,asOf,maxRows).all();
 const rows=load_tennis_results(data.results||[],{tour,asOf});
 if(rows.length!==count)throw Error('CANONICAL_MATCH_EVIDENCE_INCOMPLETE');
 return {tour,asOf,rows,coverage:{canonicalVerified:count,
 latestMatch:q?.latest_match||null,latestObservation:q?.latest_observation||null,
 hasCurrentMatchEvidence:!!q?.latest_match&&
  Date.parse(asOf)-Date.parse(q.latest_match)<=7*86400000,
 completenessVerified:false,statCompletenessVerified:false}};
}
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 const u=new URL(request.url),tour=u.searchParams.get('tour')||'atp',
 p1=u.searchParams.get('player1'),p2=u.searchParams.get('player2'),
 surface=u.searchParams.get('surface'),asOf=new Date().toISOString();
 try{
  const out=await readTennisFastCanonical(env.DB,{tour,asOf});
  if(p1||p2){
   if(!p1||!p2)return json({ok:false,reason:'BOTH_PLAYER_IDS_REQUIRED'},400);
   const matchup=tennis_fast_matchup(out.rows,{tour,asOf,player1:p1,player2:p2,surface});
   return json({ok:true,...out.coverage,matchup,canAuthorizeWager:false});
  }
  return json({ok:true,tour,asOf,...out.coverage,
   message:'Verified result coverage only; current-season match-stat completeness unverified',
   canAuthorizeWager:false});
 }catch(e){return json({ok:false,reason:String(e.message||'SOURCE_COVERAGE_UNAVAILABLE'),
  canAuthorizeWager:false},503)}
}
