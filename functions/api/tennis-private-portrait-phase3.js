// Authenticated evidence-only Phase 3 checkpoint for the frozen ATP/WTA cohort.
// No image fetching, publication, approval, or wagering authority.
import { authorizeHarvest, unauthorizedBody } from '../lib/auth.js';
const COHORT = 'tennis-elo-private-20261019-1074';
const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{
  'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'
}});
export async function onRequestGet({request,env}) {
  const auth=authorizeHarvest(request,env);
  if(!auth.ok) return json(unauthorizedBody(auth.reason),403);
  if(!env?.DB?.prepare) return json({ok:false,reason:'DB_REQUIRED'},503);
  const url=new URL(request.url);
  const limit=Math.min(200,Math.max(0,Number.parseInt(url.searchParams.get('limit')||'100',10)||0));
  try {
    const rows=(await env.DB.prepare(`SELECT m.tour, COUNT(*) AS roster,
      SUM(CASE WHEN m.identity_status='MATCHED' AND p.fbis_player_id IS NOT NULL THEN 1 ELSE 0 END) AS canonical_matched,
      SUM(CASE WHEN r.official_id_status='LINKED_FROM_OFFICIAL_INGEST' THEN 1 ELSE 0 END) AS official_id_linked,
      SUM(CASE WHEN r.headshot_status='OFFICIAL_IMAGE_SOURCE_VERIFIED'
         AND length(trim(COALESCE(r.headshot_evidence_ref,'')))>0 THEN 1 ELSE 0 END) AS official_url_verified,
      SUM(CASE WHEN r.headshot_candidate_url IS NOT NULL THEN 1 ELSE 0 END) AS url_candidates,
      SUM(CASE WHEN i.fbis_player_id IS NOT NULL THEN 1 ELSE 0 END) AS private_asset_records,
      SUM(CASE WHEN i.fbis_player_id IS NOT NULL THEN 1 ELSE 0 END) AS approved_private_records,
      SUM(CASE WHEN i.public_display_allowed<>0 OR i.storage_scope<>'PRIVATE_ONLY' THEN 1 ELSE 0 END) AS public_scope_violations
      FROM tennis_private_portrait_cohort_members m
      LEFT JOIN tennis_players p ON p.fbis_player_id=m.fbis_player_id AND p.tour=m.tour
      LEFT JOIN tennis_private_portrait_source_references r
        ON r.cohort_id=m.cohort_id AND r.tour=m.tour AND r.player_key=m.player_key
      LEFT JOIN tennis_private_portrait_imports i ON i.cohort_id=m.cohort_id AND i.tour=m.tour AND i.player_key=m.player_key
      WHERE m.cohort_id=? GROUP BY m.tour ORDER BY m.tour`).bind(COHORT).all()).results||[];
    const policy=(await env.DB.prepare(`SELECT tour,rights_verification,access_verification,activation_state,
      CASE WHEN length(trim(COALESCE(rights_evidence_ref,'')))>0 THEN 1 ELSE 0 END evidence_present
      FROM tennis_private_portrait_policy WHERE cohort_id=? ORDER BY tour`).bind(COHORT).all()).results||[];
    const missing=limit?(await env.DB.prepare(`SELECT m.tour,m.player_name AS playerName,
      m.fbis_player_id AS playerId, m.identity_status AS identityStatus,
      COALESCE(r.official_id_status,'NOT_VERIFIED') AS officialIdStatus,
      COALESCE(r.headshot_status,'NO_OFFICIAL_IMAGE_VERIFIED') AS headshotStatus,
      CASE WHEN i.fbis_player_id IS NOT NULL THEN 1 ELSE 0 END AS hasPrivateAssetRecord
      FROM tennis_private_portrait_cohort_members m
      LEFT JOIN tennis_private_portrait_source_references r
        ON r.cohort_id=m.cohort_id AND r.tour=m.tour AND r.player_key=m.player_key
      LEFT JOIN tennis_private_portrait_imports i ON i.cohort_id=m.cohort_id AND i.tour=m.tour AND i.player_key=m.player_key
      WHERE m.cohort_id=? AND (i.fbis_player_id IS NULL
        OR r.headshot_status IS NULL OR r.headshot_status<>'OFFICIAL_IMAGE_SOURCE_VERIFIED')
      ORDER BY m.tour,m.elo_rank LIMIT ?`).bind(COHORT,limit).all()).results||[]:[];
    const n=(row,key)=>Number(row?.[key]||0);
    const totals={roster:0,canonicalMatched:0,officialIdsLinked:0,urlCandidates:0,
      officialUrlsVerified:0,privateAssetRecords:0,approvedPrivateRecords:0,publicScopeViolations:0};
    for(const r of rows) {
      totals.roster+=n(r,'roster'); totals.canonicalMatched+=n(r,'canonical_matched');
      totals.officialIdsLinked+=n(r,'official_id_linked'); totals.urlCandidates+=n(r,'url_candidates');
      totals.officialUrlsVerified+=n(r,'official_url_verified');
      totals.privateAssetRecords+=n(r,'private_asset_records');
      totals.approvedPrivateRecords+=n(r,'approved_private_records');
      totals.publicScopeViolations+=n(r,'public_scope_violations');
    }
    const rosterValid=rows.length===2&&rows.every(r=>n(r,'roster')===(r.tour==='atp'?559:515))
      &&totals.roster===1074&&totals.canonicalMatched===1074;
    const policyReady=policy.length===2&&policy.every(p=>
      p.rights_verification==='DOCUMENTED_PRIVATE_USE'&&p.access_verification==='VERIFIED_PRIVATE_ACCESS'
      &&p.activation_state==='PRIVATE_IMPORT_ALLOWED'&&n(p,'evidence_present')===1);
    const findings=[];
    if(!rosterValid)findings.push('ROSTER_OR_CANONICAL_IDENTITY_INCOMPLETE');
    if(!policyReady)findings.push('PRIVATE_USE_RIGHTS_OR_ACCESS_NOT_VERIFIED');
    if(totals.officialUrlsVerified<Math.ceil(1074*.90))findings.push('OFFICIAL_URL_COVERAGE_BELOW_90_PERCENT');
    if(totals.publicScopeViolations) findings.push('PUBLIC_SCOPE_VIOLATION');
    return json({ok:rosterValid&&totals.publicScopeViolations===0,cohortId:COHORT,
      reportType:'PRIVATE_PORTRAIT_PHASE3_READBACK',byTour:rows,policy,totals,
      targets:{roster:1074,minVerifiedOfficialUrls:967,privateDisplayOnly:true,publicDisplayPortraits:0},
      missing:{canonicalIdentities:1074-totals.canonicalMatched,officialIdentities:1074-totals.officialIdsLinked,
        verifiedOfficialUrls:1074-totals.officialUrlsVerified,privateAssetRecords:1074-totals.privateAssetRecords},
      missingPlayersSample:missing,missingPlayersTruncated:limit>0&&missing.length===limit,
      readyForRestrictedImports:rosterValid&&policyReady&&totals.publicScopeViolations===0,
      evidenceLimits:['Asset records do not prove R2 object existence or checksum integrity.',
        'Official URL verification does not establish copying permission.',
        'No private website-access attestation is performed by this endpoint.',
        'Missing-player results are bounded; aggregate counts cover the full cohort.'],
      findings,canAuthorizeWager:false},rosterValid&&totals.publicScopeViolations===0?200:409);
  } catch {
    return json({ok:false,reason:'PHASE3_SCHEMA_OR_DATA_UNAVAILABLE'},503);
  }
}
