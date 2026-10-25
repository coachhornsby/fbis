/**
 * CFB Tier3 receipt-time matchup challenger v0.1.
 * Private read-only simulation; unvalidated features never affect production.
 */
const numeric=v=>v===null||v===undefined||v===""?null:Number.isFinite(Number(v))?Number(v):null;
const clock=v=>typeof v==="string"?Date.parse(v):NaN;
const bound=(v,limit)=>Math.max(-limit,Math.min(limit,v));
export function computeTier3ReceiptChallenger(row,champion) {
 const kickoff=clock(row?.kickoff),received=clock(row?.receivedAt);
 if(!Number.isFinite(kickoff)||!Number.isFinite(received)||received>=kickoff-600000)
  return {eligible:false,reason:"NOT_FROZEN_TEN_MINUTES_BEFORE_KICKOFF"};
 if(!["matched_unique_active_fbs","matched"].includes(row.identityStatus)||
    !/^cfb-\d+$/.test(row.homeCanonicalId||"")||
    !/^cfb-\d+$/.test(row.awayCanonicalId||"")||
    row.homeCanonicalId===row.awayCanonicalId)
  return {eligible:false,reason:"CANONICAL_IDENTITY_UNVERIFIED"};
 if(row.snapshotSeason!==row.season||row.snapshotWeek!==row.week||
    row.authority!=="research_only"||row.snapshotStatus!=="research_only"||
    row.canInfluenceProjection!==0||row.canAuthorizeWager!==0)
  return {eligible:false,reason:"SNAPSHOT_CONTRACT_INVALID"};
 const cHome=numeric(champion?.home),cAway=numeric(champion?.away);
 if(cHome===null||cAway===null||!Number.isFinite(clock(champion?.frozenAt))||
    clock(champion.frozenAt)>=kickoff)
  return {eligible:false,reason:"NO_FROZEN_CHAMPION"};
 const f=row.features||{};
 const keys=["home_adjusted_passing_epa","away_adjusted_passing_epa",
  "home_adjusted_passing_epa_allowed","away_adjusted_passing_epa_allowed",
  "home_adjusted_rushing_epa","away_adjusted_rushing_epa",
  "home_adjusted_rushing_epa_allowed","away_adjusted_rushing_epa_allowed"];
 const values=keys.map(k=>numeric(f[k]));
 if(values.some(v=>v===null||Math.abs(v)>5))return {eligible:false,reason:"TIER3_EPA_INCOMPLETE"};
 const [hp,ap,hpd,apd,hr,ar,hrd,ard]=values;
 const pass=(hp-apd)-(ap-hpd);
 const rush=(hr-ard)-(ar-hrd);
 // Research-only fixed sensitivity, capped to reduce unstable scores.
 const passMargin=bound(pass*4,4),rushMargin=bound(rush*3,3);
 const marginShift=bound(passMargin+rushMargin,6);
 const baseMargin=cHome-cAway,baseTotal=cHome+cAway;
 return {eligible:true,modelId:"CFB-TIER3-RECEIPT-EPA-SHADOW-v0.1",
  sourceClock:"FBIS_RECEIPT_ONLY",sourcePublishedAtVerified:false,
  featureFamilies:{passing:passMargin,rushing:rushMargin},
  champion:{home:cHome,away:cAway,margin:baseMargin,total:baseTotal},
  challenger:{home:cHome+marginShift/2,away:cAway-marginShift/2,
   margin:baseMargin+marginShift,total:baseTotal},
  adjustmentCapped:true,receiptAt:row.receivedAt,kickoff:row.kickoff,
  prospectiveGradeEligible:false,calibrated:false,
  projectionInputsChanged:false,canAuthorizeWager:false};
}
export async function auditTier3ReceiptChallenger(env,{season=2026,week=8,limit=80}={}) {
 if(!env?.TIER3_DB?.prepare||!env?.CFB_DB?.prepare)throw Error("DEDICATED_DATABASE_BINDING_MISSING");
 if(!Number.isInteger(season)||season<2025||season>2030||
    !Number.isInteger(week)||week<1||week>17||
    !Number.isInteger(limit)||limit<1||limit>100)throw Error("INVALID_CHALLENGER_SCOPE");
 const source=await env.TIER3_DB.prepare(
  `SELECT g.game_id gameId,g.season,g.week,g.identity_status identityStatus,
  g.home_canonical_id homeCanonicalId,g.away_canonical_id awayCanonicalId,
  g.authority,s.season snapshotSeason,s.week snapshotWeek,
  s.status snapshotStatus,s.can_influence_projection canInfluenceProjection,
  s.can_authorize_wager canAuthorizeWager,s.received_at receivedAt,
  g.kickoff_literal kickoff,g.features_json featuresJson
  FROM cfb_tier3_training_games g
  JOIN cfb_tier3_training_snapshots s USING(snapshot_id)
  WHERE g.season=? AND g.week=? ORDER BY s.received_at ASC,g.game_id ASC LIMIT ?`
 ).bind(season,week,limit).all();
 if(!Array.isArray(source?.results))throw Error("TIER3_QUERY_FAILED");
 const rows=[],rejections={};
 for(const r of source.results){
  let features;try{features=JSON.parse(r.featuresJson)}catch{features={}}
  const baseline=await env.CFB_DB.prepare(
   `SELECT s.proj_home home,s.proj_away away,s.frozen_at frozenAt
    FROM prediction_snapshots s WHERE s.game_id=? AND s.sport='cfb'
    AND s.model_version='CFB-FBIS-v2' AND s.projection_kind='FBIS'
    AND s.frozen_at<? AND s.proj_home IS NOT NULL AND s.proj_away IS NOT NULL
    ORDER BY s.frozen_at ASC,s.id ASC LIMIT 1`
  ).bind(r.gameId,r.kickoff).first();
  const result=computeTier3ReceiptChallenger({...r,features},baseline);
  if(!result.eligible){rejections[result.reason]=(rejections[result.reason]||0)+1;continue}
  rows.push({gameId:r.gameId,...result});
 }
 return {ok:true,season,week,sourceRows:source.results.length,
  researchEligible:rows.length,rejected:rejections,
  games:rows,source:"PRIVATE_TIER3_RECEIPT",
  modelId:"CFB-TIER3-RECEIPT-EPA-SHADOW-v0.1",
  historicalOutcomeGrade:null,pairedImprovement:null,
  providerRequests:0,projectionInputsChanged:false,automaticPromotion:false,
  canAuthorizeWager:false};
}
