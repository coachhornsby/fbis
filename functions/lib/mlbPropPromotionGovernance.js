export const MLB_PROP_PROMOTION_GATE_VERSION = "MLB-PROP-PROMOTION-v1";

export const MLB_PROP_PROMOTION_THRESHOLDS = Object.freeze({
  insufficientData: Object.freeze({
    minSettledN: 250,
    minWalkForwardN: 150,
    minDistinctDates: 17,
  }),
  calibrationCandidate: Object.freeze({
    minSettledN: 500,
    minWalkForwardN: 300,
    minDistinctDates: 30,
    minDirectionalWalkForwardN: 100,
    minPopulatedDistanceBuckets: 3,
    minDistanceBucketN: 40,
    monotonicTolerancePp: 3,
    minBucketRankCorrelation: 0.60,
    maxCalibratedBrier: 0.25,
    maxCalibratedEce: 0.06,
    maxAbsoluteBiasSdShare: 0.15,
    minMaeImprovementVsBestNonMarketBaseline: 0.01,
  }),
  promotionReady: Object.freeze({
    minSettledN: 1000,
    minWalkForwardN: 600,
    minDistinctDates: 45,
    minDirectionalWalkForwardN: 200,
    minPopulatedDistanceBuckets: 4,
    minDistanceBucketN: 60,
    monotonicTolerancePp: 2,
    minBucketRankCorrelation: 0.70,
    maxCalibratedBrier: 0.235,
    maxCalibratedEce: 0.04,
    maxAbsoluteBiasSdShare: 0.10,
    minMaeImprovementVsBestNonMarketBaseline: 0.03,
    minProspectiveDays: 14,
    maxMaterialSegmentRelativeMaeDegradation: 0.10,
  }),
});

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function hasDirectionFloor(e,min){
  const over=n(e?.directionalWalkForwardN?.OVER);
  const under=n(e?.directionalWalkForwardN?.UNDER);
  return over!=null && under!=null && over>=min && under>=min;
}
function bucketPass(e,minBuckets,minN){
  const rows=Array.isArray(e?.distanceBuckets)?e.distanceBuckets:[];
  return rows.filter(x=>n(x?.n)>=minN).length>=minBuckets;
}
function corePass(e,t,{prospective=false}={}){
  const settled=n(e?.settledN), wf=n(e?.walkForwardN), dates=n(e?.distinctDates);
  const corr=n(e?.bucketRankCorrelation), brier=n(e?.calibratedBrier), ece=n(e?.calibratedEce);
  const biasShare=n(e?.absoluteBiasSdShare), maeGain=n(e?.maeImprovementVsBestNonMarketBaseline);
  const properScoreGain=n(e?.properScoreImprovementVsBestNonMarketBaseline);
  if(settled==null||settled<t.minSettledN)return false;
  if(wf==null||wf<t.minWalkForwardN)return false;
  if(dates==null||dates<t.minDistinctDates)return false;
  if(!hasDirectionFloor(e,t.minDirectionalWalkForwardN))return false;
  if(!bucketPass(e,t.minPopulatedDistanceBuckets,t.minDistanceBucketN))return false;
  if(e?.edgeHitMonotonic!==true)return false;
  if(corr==null||corr<t.minBucketRankCorrelation)return false;
  if(brier==null||brier>t.maxCalibratedBrier)return false;
  if(ece==null||ece>t.maxCalibratedEce)return false;
  if(biasShare==null||biasShare>t.maxAbsoluteBiasSdShare)return false;
  const baselineGainOk=(maeGain!=null&&maeGain>=t.minMaeImprovementVsBestNonMarketBaseline) ||
    (e?.rareEventMarket===true && properScoreGain!=null && properScoreGain>=t.minMaeImprovementVsBestNonMarketBaseline);
  if(!baselineGainOk)return false;
  if(prospective){
    if(n(e?.prospectiveDays)<t.minProspectiveDays)return false;
    if(e?.temporalIntegrity!==true||e?.stateBeforeWeight!==true)return false;
    const seg=n(e?.maxMaterialSegmentRelativeMaeDegradation);
    if(seg==null||seg>t.maxMaterialSegmentRelativeMaeDegradation)return false;
  }
  return true;
}

export function classifyMlbPropPromotionEvidence(evidence={}){
  const low=MLB_PROP_PROMOTION_THRESHOLDS.insufficientData;
  if((n(evidence.settledN)??0)<low.minSettledN ||
     (n(evidence.walkForwardN)??0)<low.minWalkForwardN ||
     (n(evidence.distinctDates)??0)<low.minDistinctDates){
    return {classification:"INSUFFICIENT_DATA",promotionAllowed:false,autoPromotion:false};
  }
  const candidate=corePass(evidence,MLB_PROP_PROMOTION_THRESHOLDS.calibrationCandidate);
  if(!candidate)return {classification:"RESEARCH_CONTINUE",promotionAllowed:false,autoPromotion:false};
  const ready=corePass(evidence,MLB_PROP_PROMOTION_THRESHOLDS.promotionReady,{prospective:true});
  return {
    classification: ready ? "PROMOTION_READY" : "CALIBRATION_CANDIDATE",
    promotionAllowed:false,
    autoPromotion:false,
  };
}

export const MLB_PROP_PROMOTION_GOVERNANCE = Object.freeze({
  gateVersion: MLB_PROP_PROMOTION_GATE_VERSION,
  marketSpecific:true,
  rawProjectionDistanceCanPromote:false,
  sharedStarGovernanceUnchanged:true,
  gameModelChampionUnchanged:true,
  canQualifyDuringEvaluation:false,
  canAuthorizeWagerDuringEvaluation:false,
  autoPromotion:false,
  manualApprovalRequired:true,
  stateBeforeWeightRequired:true,
});
