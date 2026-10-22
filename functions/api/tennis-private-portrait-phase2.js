// Operator-authenticated status for the locked 1,074-player ATP/WTA Phase 2 roster.
// Metadata only. No provider image bytes, no public pages, no rights activation.
import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
const reply=(b,status=200)=>new Response(JSON.stringify(b),{status,headers:{
 'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequestGet({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return reply(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare)return reply({ok:false,reason:'DB_REQUIRED'},503);
 const u=new URL(request.url),limit=Math.min(100,Math.max(0,Number(u.searchParams.get('limit')||0)||0));
 try{
  const byTour=(await env.DB.prepare(`SELECT m.tour,COUNT(*) roster,
     SUM(CASE WHEN m.identity_status='MATCHED' AND p.fbis_player_id IS NOT NULL THEN 1 ELSE 0 END) canonical_matched,
     SUM(CASE WHEN p.official_source='TENNIS_ABSTRACT_ROSTER_RESEARCH' THEN 1 ELSE 0 END) research_only_canonical,
     SUM(CASE WHEN r.official_id_status='LINKED_FROM_OFFICIAL_INGEST' THEN 1 ELSE 0 END) official_id_linked,
     SUM(CASE WHEN r.profile_status='OFFICIAL_ID_BASED_CANDIDATE' THEN 1 ELSE 0 END) official_profile_candidates,
     SUM(CASE WHEN r.headshot_status='THIRD_PARTY_URL_CANDIDATE' THEN 1 ELSE 0 END) third_party_image_candidates,
     SUM(CASE WHEN r.headshot_status='OFFICIAL_SITE_TEMPLATE_CANDIDATE' THEN 1 ELSE 0 END) official_image_candidates,
     SUM(CASE WHEN r.headshot_status='OFFICIAL_IMAGE_SOURCE_VERIFIED' THEN 1 ELSE 0 END) verified_official_image_sources,
     SUM(CASE WHEN r.private_image_imported<>0 OR r.public_display_allowed<>0 THEN 1 ELSE 0 END) unsafe_refs
   FROM tennis_private_portrait_cohort_members m
   LEFT JOIN tennis_players p ON p.fbis_player_id=m.fbis_player_id
   LEFT JOIN tennis_private_portrait_source_references r ON r.cohort_id=m.cohort_id
     AND r.tour=m.tour AND r.player_key=m.player_key
   WHERE m.cohort_id='tennis-elo-private-20261019-1074'
   GROUP BY m.tour ORDER BY m.tour`).all()).results||[];
  const samples=limit?(await env.DB.prepare(`SELECT r.tour,m.player_name AS playerName,
     r.official_id_status AS officialIdStatus,r.profile_status AS profileStatus,
     r.headshot_status AS imageStatus,p.official_source AS canonicalSource
   FROM tennis_private_portrait_source_references r
   JOIN tennis_private_portrait_cohort_members m ON m.cohort_id=r.cohort_id
     AND m.tour=r.tour AND m.player_key=r.player_key
   JOIN tennis_players p ON p.fbis_player_id=r.fbis_player_id
   WHERE r.official_id_status='NOT_VERIFIED'
   ORDER BY m.tour,m.elo_rank LIMIT ?`).bind(limit).all()).results||[]:[];
  const totals={roster:0,canonicalMatched:0,researchOnlyCanonical:0,officialIdsLinked:0,
    officialProfileCandidates:0,thirdPartyImageCandidates:0,officialImageCandidates:0,verifiedOfficialImageSources:0};
  for(const row of byTour){
    totals.roster+=Number(row.roster||0);totals.canonicalMatched+=Number(row.canonical_matched||0);
    totals.researchOnlyCanonical+=Number(row.research_only_canonical||0);
    totals.officialIdsLinked+=Number(row.official_id_linked||0);
    totals.officialProfileCandidates+=Number(row.official_profile_candidates||0);
    totals.thirdPartyImageCandidates+=Number(row.third_party_image_candidates||0);
    totals.officialImageCandidates+=Number(row.official_image_candidates||0);
    totals.verifiedOfficialImageSources+=Number(row.verified_official_image_sources||0);
  }
  const ok=byTour.length===2&&byTour.every(row=>Number(row.roster)===(row.tour==='atp'?559:515)
    &&Number(row.roster)===Number(row.canonical_matched)&&Number(row.unsafe_refs)===0)
    &&totals.roster===1074&&totals.canonicalMatched===1074;
  return reply({ok,cohortId:'tennis-elo-private-20261019-1074',totals,byTour,
    unresolvedOfficialIdentities:totals.roster-totals.officialIdsLinked,
    unknownHeadshotSources:totals.roster-totals.verifiedOfficialImageSources,
    verifiedUseRights:false,privateWebsiteVerified:false,officialImagesImported:0,
    restriction:'PRIVATE_ONLY_UNTIL_ACCESS_AND_RIGHTS_VERIFIED',
    missingOfficialIdentitySample:samples},ok?200:409);
 }catch{return reply({ok:false,reason:'PHASE2_SCHEMA_OR_DATA_UNAVAILABLE'},503);}
}