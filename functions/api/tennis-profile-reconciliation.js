// Operator-only, source-backed reconciliation candidates. Never auto-link by name.
// EXISTS avoids source-ID one-to-many join inflation; every cohort athlete counted once.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const COHORT='tennis-elo-private-20261019-1074';
const send=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return send({ok:false,reason:'DB_REQUIRED'},503);
 const params=new URL(request.url).searchParams;
 const limit=Math.max(1,Math.min(200,Number(params.get('limit')||75)||75));
 const offset=Math.max(0,Math.min(2000,Math.floor(Number(params.get('offset')||0)||0)));
 try{
  const base=`FROM tennis_private_portrait_cohort_members m
   LEFT JOIN tennis_private_portrait_source_references r
    ON r.cohort_id=m.cohort_id AND r.tour=m.tour AND r.player_key=m.player_key
   WHERE m.cohort_id=?`;
  const profileExists=(surface)=>`EXISTS(SELECT 1 FROM tennis_player_profiles_current p
    WHERE p.tour=m.tour AND p.player_key=m.player_key AND p.surface='${surface}')`;
  const sourceIdProfile=`EXISTS(SELECT 1 FROM tennis_player_source_ids s
     JOIN tennis_player_profiles_current p ON p.tour=m.tour
       AND p.player_id=s.source_player_id
     WHERE s.fbis_player_id=m.fbis_player_id
       AND s.provider=CASE WHEN m.tour='atp' THEN 'ATP_OFFICIAL' ELSE 'WTA_OFFICIAL' END)`;
  const agg=(await env.DB.prepare(`SELECT m.tour,COUNT(*) roster,
   SUM(CASE WHEN r.official_id_status='LINKED_FROM_OFFICIAL_INGEST' THEN 0 ELSE 1 END) missingOfficialId,
   SUM(CASE WHEN ${profileExists('hard')} THEN 1 ELSE 0 END) hard,
   SUM(CASE WHEN ${profileExists('clay')} THEN 1 ELSE 0 END) clay,
   SUM(CASE WHEN ${profileExists('grass')} THEN 1 ELSE 0 END) grass,
   SUM(CASE WHEN NOT (${profileExists('hard')} AND ${profileExists('clay')} AND ${profileExists('grass')}) THEN 1 ELSE 0 END) incomplete,
   SUM(CASE WHEN NOT ${profileExists('hard')} AND ${sourceIdProfile} THEN 1 ELSE 0 END) sourceIdProfileCandidates
   ${base} GROUP BY m.tour ORDER BY m.tour`).bind(COHORT).all()).results||[];
  const missing=(await env.DB.prepare(`SELECT m.tour,m.elo_rank AS eloRank,m.player_name AS playerName,
    m.player_key AS playerKey,m.fbis_player_id AS playerId,
    r.official_id_status AS officialIdStatus,
    CASE WHEN ${profileExists('hard')} THEN 0 ELSE 1 END missingHard,
    CASE WHEN ${profileExists('clay')} THEN 0 ELSE 1 END missingClay,
    CASE WHEN ${profileExists('grass')} THEN 0 ELSE 1 END missingGrass,
    CASE WHEN ${sourceIdProfile} THEN 1 ELSE 0 END sourceIdProfileCandidate
    ${base} AND (NOT (${profileExists('hard')} AND ${profileExists('clay')} AND ${profileExists('grass')})
      OR r.official_id_status IS NULL OR r.official_id_status<>'LINKED_FROM_OFFICIAL_INGEST')
    ORDER BY m.tour,m.elo_rank LIMIT ? OFFSET ?`).bind(COHORT,limit,offset).all()).results||[];
  const ok=agg.length===2&&agg.every(x=>Number(x.roster)===(x.tour==='atp'?559:515));
  return send({ok,cohortId:COHORT,byTour:agg,missingPlayers:missing,limit,offset,
    candidatesRequireReview:true,identityUpdatesPerformed:0,profilesManufactured:0,
    researchOnly:true,canAuthorizeWager:false,
    note:'An official source-ID match is a candidate, not enough to copy a profile or confer projection eligibility.'},ok?200:409);
 }catch{return send({ok:false,reason:'RECONCILIATION_QUERY_UNAVAILABLE'},503)}
}
