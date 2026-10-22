// Read-only, authenticated master profile coverage for exactly the frozen 1,074-player cohort.
// The current Elo feed is research-only. Private R2 object keys and rights evidence are never exposed.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const COHORT='tennis-elo-private-20261019-1074';
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return json({ok:false,reason:'DB_REQUIRED'},503);
 const u=new URL(request.url);const tour=u.searchParams.get('tour');
 if(tour&&!['atp','wta'].includes(tour))return json({ok:false,reason:'INVALID_TOUR'},400);
 const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||50)||50));
 const offset=Math.min(1074,Math.max(0,Number(u.searchParams.get('offset')||0)||0));
 try{
  const rows=(await env.DB.prepare(`SELECT m.tour,m.player_key AS playerKey,m.player_name AS name,
   m.fbis_player_id AS playerId,m.elo_rank AS rosterEloRank,m.identity_status AS identityStatus,
   p.official_source AS canonicalSource,
   r.official_id_status AS officialIdStatus,
   r.headshot_status AS officialHeadshotStatus,
   CASE WHEN i.fbis_player_id IS NOT NULL THEN 1 ELSE 0 END AS privatePortraitImported,
   e.report_date AS eloReportDate,e.elo_rank AS currentEloRank,
   e.overall_elo AS overallElo,e.hard_elo AS hardElo,e.clay_elo AS clayElo,e.grass_elo AS grassElo,
   (SELECT COUNT(*) FROM tennis_player_profiles_current h
    WHERE h.tour=m.tour AND h.player_key=m.player_key) AS availableSurfaceProfiles
   FROM tennis_private_portrait_cohort_members m
   LEFT JOIN tennis_players p ON p.fbis_player_id=m.fbis_player_id
   LEFT JOIN tennis_private_portrait_source_references r
      ON r.cohort_id=m.cohort_id AND r.tour=m.tour AND r.player_key=m.player_key
   LEFT JOIN tennis_private_portrait_imports i
      ON i.cohort_id=m.cohort_id AND i.tour=m.tour AND i.player_key=m.player_key
   LEFT JOIN tennis_abstract_elo_players e ON e.tour=m.tour AND e.player_key=m.player_key
      AND e.report_date=(SELECT MAX(runs.report_date) FROM tennis_abstract_elo_runs runs
        WHERE runs.tour=m.tour AND runs.research_only=1 AND runs.can_authorize_wager=0
          AND runs.report_date<=date('now'))
      AND e.source_hash=(SELECT runs.source_hash FROM tennis_abstract_elo_runs runs
        WHERE runs.tour=m.tour AND runs.report_date=e.report_date AND runs.research_only=1
          AND runs.can_authorize_wager=0 ORDER BY runs.retrieved_at DESC LIMIT 1)
   WHERE m.cohort_id=? AND (? IS NULL OR m.tour=?)
   ORDER BY m.tour,m.elo_rank LIMIT ? OFFSET ?`).bind(COHORT,tour,tour,limit,offset).all()).results||[];
  const masters=rows.map(r=>({...r,privatePortraitImported:!!r.privatePortraitImported,
    currentRatingsResearchOnly:true,projectionAuthority:false,
    missingFields:[
      !r.playerId?'CANONICAL_PLAYER_ID':null,
      r.officialIdStatus!=='LINKED_FROM_OFFICIAL_INGEST'?'OFFICIAL_PLAYER_ID':null,
      r.overallElo==null?'CURRENT_ELO':null,
      Number(r.availableSurfaceProfiles||0)<3?'SURFACE_HISTORICAL_PROFILES':null,
      !r.privatePortraitImported?'PRIVATE_PORTRAIT':null
    ].filter(Boolean)}));
  return json({ok:true,cohortId:COHORT,rosterTarget:1074,tour:tour||'all',offset,limit,
    returned:masters.length,players:masters,sourceAuthority:'RESEARCH_ONLY',
    missingProfileCountsInPage:masters.reduce((x,p)=>(p.missingFields.forEach(k=>x[k]=(x[k]||0)+1),x),{}),
    noModelPromotion:true,noWagerAuthority:true});
 }catch{return json({ok:false,reason:'MASTER_RECORD_SOURCE_UNAVAILABLE'},503)}
}
