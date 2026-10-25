/**
 * CFBD Tier3 audit: research utilization vs point-in-time model permission.
 * Private database only. Aggregate diagnostics contain no licensed features.
 */
export function classifyTier3WeeklyEvidence(row) {
 const total=Number(row.total)||0,matched=Number(row.matched)||0;
 const pregame=Number(row.pregame)||0,published=Number(row.published)||0;
 const receiptPIT=Number(row.receipt_pit)||0;
 const usable=total>0&&matched>0;
 return {
  season:Number(row.season),week:Number(row.week),rows:total,
  identityMatched:matched,unresolved:total-matched,
  receiptsBeforeKickoff:pregame,providerPublicationVerified:published,
  receiptAndIdentityVerified:receiptPIT,
  researchPregameEligible:receiptPIT>0,
  researchPregameEligibleGames:receiptPIT,
  clockEvidence:published===total&&total>0?"PROVIDER_PUBLICATION":receiptPIT>0?"FBIS_RECEIPT_ONLY":"NO_VERIFIED_PREGAME_CLOCK",
  featureColumns:Number(row.feature_columns)||0,
  researchEligible:usable,
  productionFeatureEligible:usable&&matched===total&&published===total&&pregame===total,
  gate:!total?"NO_SOURCE":!matched?"NO_CANONICAL_IDENTITIES":
   published<total?"PROVIDER_PUBLICATION_CUTOFF_UNVERIFIED":
   pregame<total?"PREGAME_RECEIPT_MISSING":
   matched<total?"UNRESOLVED_GAME_IDENTITIES":"SOURCE_TIMING_ELIGIBLE",
 };
}
export async function auditCfbTier3ProjectionReadiness(env) {
 const db=env?.TIER3_DB;
 if(!db?.prepare)throw Error("TIER3_DB_UNBOUND");
 const sql=`SELECT g.season,g.week,COUNT(*) total,
 SUM(CASE WHEN (g.identity_status='matched_unique_active_fbs' OR
   (g.identity_status='matched' AND g.home_canonical_id GLOB 'cfb-[0-9]*'
      AND g.away_canonical_id GLOB 'cfb-[0-9]*' AND
      g.home_canonical_id<>g.away_canonical_id)) THEN 1 ELSE 0 END) matched,
 SUM(CASE WHEN s.received_at<g.kickoff_literal THEN 1 ELSE 0 END) pregame,
 SUM(CASE WHEN s.received_at<g.kickoff_literal AND
  (g.identity_status='matched_unique_active_fbs' OR
   (g.identity_status='matched' AND g.home_canonical_id GLOB 'cfb-[0-9]*' AND
    g.away_canonical_id GLOB 'cfb-[0-9]*' AND
    g.home_canonical_id<>g.away_canonical_id)) THEN 1 ELSE 0 END) receipt_pit,
 SUM(CASE WHEN s.provider_published_at IS NOT NULL AND
  s.provider_published_at<g.kickoff_literal THEN 1 ELSE 0 END) published,
 MAX(s.feature_count) feature_columns
 FROM cfb_tier3_training_games g
 JOIN cfb_tier3_training_snapshots s USING(snapshot_id)
 WHERE g.season>=2025 AND g.season<=2026
 AND g.authority='research_only' AND s.status='research_only'
 AND s.can_influence_projection=0 AND s.can_authorize_wager=0
 GROUP BY g.season,g.week ORDER BY g.season DESC,g.week DESC LIMIT 50`;
 const r=await db.prepare(sql).all();
 if(!Array.isArray(r?.results))throw Error("TIER3_AUDIT_UNAVAILABLE");
 const weeks=r.results.map(classifyTier3WeeklyEvidence);
 return {ok:true,source:"CFBD_PRIVATE_TIER3",sourceDb:"TIER3_DB",
  weekly:weeks,summary:{weeks:weeks.length,
   rows:weeks.reduce((n,w)=>n+w.rows,0),
   researchMatched:weeks.reduce((n,w)=>n+w.identityMatched,0),
   publicationVerified:weeks.reduce((n,w)=>n+w.providerPublicationVerified,0),
   receiptPITGames:weeks.reduce((n,w)=>n+w.researchPregameEligibleGames,0),
   productionReadyWeeks:weeks.filter(w=>w.productionFeatureEligible).length},
  nextResearchAction:"RUN_PAIRED_FROZEN_FEATURE_FAMILY_ABLATIONS",
  projectionInputsChanged:false,automaticPromotion:false,providerCalls:0,
  canAuthorizeWager:false};
}
