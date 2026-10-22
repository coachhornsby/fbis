// Authenticated, read-only coverage audit across the exact frozen Tennis cohort.
// Profiles and Elo estimates remain research-only; no missing stat is synthesized.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const send=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const cohort='tennis-elo-private-20261019-1074';
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return send(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return send({ok:false,reason:'DB_REQUIRED'},503);
 const u=new URL(request.url);
 const limit=Math.min(200,Math.max(0,parseInt(u.searchParams.get('limit')||'75',10)||0));
 try{
  const rows=(await env.DB.prepare(`SELECT m.tour,
   COUNT(*) roster,
   SUM(CASE WHEN r.official_id_status='LINKED_FROM_OFFICIAL_INGEST' THEN 1 ELSE 0 END) officialIds,
   SUM(CASE WHEN h.player_key IS NOT NULL THEN 1 ELSE 0 END) hardProfiles,
   SUM(CASE WHEN c.player_key IS NOT NULL THEN 1 ELSE 0 END) clayProfiles,
   SUM(CASE WHEN g.player_key IS NOT NULL THEN 1 ELSE 0 END) grassProfiles,
   SUM(CASE WHEN h.player_key IS NOT NULL AND c.player_key IS NOT NULL
     AND g.player_key IS NOT NULL THEN 1 ELSE 0 END) allSurfaces
   FROM tennis_private_portrait_cohort_members m
   LEFT JOIN tennis_private_portrait_source_references r ON r.cohort_id=m.cohort_id
     AND r.tour=m.tour AND r.player_key=m.player_key
   LEFT JOIN tennis_player_profiles_current h ON h.tour=m.tour AND h.player_key=m.player_key AND h.surface='hard'
   LEFT JOIN tennis_player_profiles_current c ON c.tour=m.tour AND c.player_key=m.player_key AND c.surface='clay'
   LEFT JOIN tennis_player_profiles_current g ON g.tour=m.tour AND g.player_key=m.player_key AND g.surface='grass'
   WHERE m.cohort_id=? GROUP BY m.tour ORDER BY m.tour`).bind(cohort).all()).results||[];
  const missing=limit?(await env.DB.prepare(`SELECT m.tour,m.elo_rank AS eloRank,
    m.player_name AS playerName,m.fbis_player_id AS playerId,
    CASE WHEN h.player_key IS NULL THEN 1 ELSE 0 END missingHard,
    CASE WHEN c.player_key IS NULL THEN 1 ELSE 0 END missingClay,
    CASE WHEN g.player_key IS NULL THEN 1 ELSE 0 END missingGrass
    FROM tennis_private_portrait_cohort_members m
    LEFT JOIN tennis_player_profiles_current h ON h.tour=m.tour AND h.player_key=m.player_key AND h.surface='hard'
    LEFT JOIN tennis_player_profiles_current c ON c.tour=m.tour AND c.player_key=m.player_key AND c.surface='clay'
    LEFT JOIN tennis_player_profiles_current g ON g.tour=m.tour AND g.player_key=m.player_key AND g.surface='grass'
    WHERE m.cohort_id=? AND (h.player_key IS NULL OR c.player_key IS NULL OR g.player_key IS NULL)
    ORDER BY m.tour,m.elo_rank LIMIT ?`).bind(cohort,limit).all()).results||[]:[];
  const roster=rows.reduce((s,r)=>s+Number(r.roster||0),0);
  const valid=rows.length===2&&rows.every(r=>Number(r.roster)===(r.tour==='atp'?559:515));
  return send({ok:valid,asOf:new Date().toISOString(),cohortId:cohort,rosterTarget:1074,
   counts:rows.map(r=>({...r,missingOfficialIds:Number(r.roster)-Number(r.officialIds),
     missingHard:Number(r.roster)-Number(r.hardProfiles),
     missingClay:Number(r.roster)-Number(r.clayProfiles),
     missingGrass:Number(r.roster)-Number(r.grassProfiles),
     incompleteAnySurface:Number(r.roster)-Number(r.allSurfaces)})),
   roster,missingSample:missing,missingTruncated:limit>0&&missing.length===limit,
   dataScope:'SOURCE_BACKED_RESEARCH_ONLY',canAuthorizeWager:false,
   limitations:['A profile row is not proof that all required model features are valid.',
    'Unobserved profiles are not filled with Elo estimates or statistical priors.',
    'Source licensing and prematch cutoffs remain independently enforced.']},valid?200:409);
 }catch{return send({ok:false,reason:'PROFILE_COVERAGE_QUERY_UNAVAILABLE'},503)}
}
