/**
 * Soccer Phase 3F research-only league × market-family routing registry.
 * Derived exclusively from immutable Phase 3E evidence.
 *
 * This module NEVER changes authoritative/public model output.
 * PASS and PARTIAL_PASS may select v3.1 for prospective SHADOW comparison only.
 * Missing/stale evidence, FAIL, and INSUFFICIENT_EVIDENCE fail closed to v2.
 */

export const SOCCER_ROUTE_VERSION = "SOCCER-PHASE3F-ROUTING-v1";
export const SOCCER_ROUTE_EVIDENCE_SNAPSHOT = "phase3b-37456055406-1";
export const SOCCER_ROUTE_EVIDENCE_CODE_SHA = "9f65375491e99cac5497952eac5ad8326ae2e0a6";
export const SOCCER_INCUMBENT_MODEL = "SOCCER-FBIS-v2";
export const SOCCER_CHALLENGER_MODEL = "SOCCER-FBIS-v3.1";

export const SOCCER_ROUTE_CLASSIFICATION = Object.freeze({
  PASS: "PASS",
  PARTIAL_PASS: "PARTIAL_PASS",
  FAIL: "FAIL",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE",
});

export const SOCCER_ROUTE_APPROVAL = Object.freeze({
  SHADOW_ELIGIBLE: "SHADOW_ELIGIBLE",
  SHADOW_RESEARCH_ONLY: "SHADOW_RESEARCH_ONLY",
  INCUMBENT_ONLY: "INCUMBENT_ONLY",
  HOLD_INSUFFICIENT_EVIDENCE: "HOLD_INSUFFICIENT_EVIDENCE",
});

export const SOCCER_MARKET_FAMILIES = Object.freeze([
  "1X2",
  "GOALS",
  "BTTS",
  "TOTALS_O25",
  "ASIAN_HANDICAP",
]);

const SAMPLE_N = Object.freeze({
  "eng.1":1807,
  "eng.2":2236,
  "ger.1":367,
  "esp.1":388,
  "ita.1":383,
  "fra.1":387,
  "uefa.champions":185,
  "uefa.europa":93,
  "usa.1":383,
  "mex.1":419,
});

const MATRIX = Object.freeze({
  "eng.1": {
    "1X2":"FAIL","GOALS":"PASS","BTTS":"PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PARTIAL_PASS",
  },
  "eng.2": {
    "1X2":"PARTIAL_PASS","GOALS":"PASS","BTTS":"PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PASS",
  },
  "ger.1": {
    "1X2":"PARTIAL_PASS","GOALS":"PARTIAL_PASS","BTTS":"PARTIAL_PASS","TOTALS_O25":"PARTIAL_PASS","ASIAN_HANDICAP":"PARTIAL_PASS",
  },
  "esp.1": {
    "1X2":"PASS","GOALS":"PARTIAL_PASS","BTTS":"PASS","TOTALS_O25":"PARTIAL_PASS","ASIAN_HANDICAP":"PASS",
  },
  "ita.1": {
    "1X2":"PARTIAL_PASS","GOALS":"PASS","BTTS":"PARTIAL_PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PARTIAL_PASS",
  },
  "fra.1": {
    "1X2":"PARTIAL_PASS","GOALS":"PASS","BTTS":"PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PASS",
  },
  "uefa.champions": {
    "1X2":"PARTIAL_PASS","GOALS":"PASS","BTTS":"PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PARTIAL_PASS",
  },
  "uefa.europa": {
    "1X2":"INSUFFICIENT_EVIDENCE","GOALS":"INSUFFICIENT_EVIDENCE","BTTS":"INSUFFICIENT_EVIDENCE","TOTALS_O25":"INSUFFICIENT_EVIDENCE","ASIAN_HANDICAP":"INSUFFICIENT_EVIDENCE",
  },
  "usa.1": {
    "1X2":"PARTIAL_PASS","GOALS":"PASS","BTTS":"PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PASS",
  },
  "mex.1": {
    "1X2":"PARTIAL_PASS","GOALS":"PASS","BTTS":"PASS","TOTALS_O25":"PASS","ASIAN_HANDICAP":"PASS",
  },
});

function approvalFor(classification){
  if(classification===SOCCER_ROUTE_CLASSIFICATION.PASS)return SOCCER_ROUTE_APPROVAL.SHADOW_ELIGIBLE;
  if(classification===SOCCER_ROUTE_CLASSIFICATION.PARTIAL_PASS)return SOCCER_ROUTE_APPROVAL.SHADOW_RESEARCH_ONLY;
  if(classification===SOCCER_ROUTE_CLASSIFICATION.FAIL)return SOCCER_ROUTE_APPROVAL.INCUMBENT_ONLY;
  return SOCCER_ROUTE_APPROVAL.HOLD_INSUFFICIENT_EVIDENCE;
}

function marketHistoryStatus(marketFamily){
  return marketFamily==="1X2" ? "FROZEN_NO_VIG_AVAILABLE_LIMITED" : "HISTORICAL_MARKET_UNAVAILABLE";
}

export const SOCCER_RESEARCH_ROUTES = Object.freeze(
  Object.entries(MATRIX).flatMap(([competition,markets])=>
    Object.entries(markets).map(([marketFamily,classification])=>Object.freeze({
      routeId:`${SOCCER_ROUTE_VERSION}:${competition}:${marketFamily}`,
      routeVersion:SOCCER_ROUTE_VERSION,
      competition,
      marketFamily,
      incumbentModel:SOCCER_INCUMBENT_MODEL,
      challengerModel:SOCCER_CHALLENGER_MODEL,
      evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
      evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
      evidenceSampleN:SAMPLE_N[competition],
      validationClassification:classification,
      approvalState:approvalFor(classification),
      historicalMarketStatus:marketHistoryStatus(marketFamily),
      researchOnly:true,
      canQualify:false,
      canAuthorize:false,
    }))
  )
);

const ROUTE_MAP = new Map(SOCCER_RESEARCH_ROUTES.map(r=>[`${r.competition}|${r.marketFamily}`,r]));

export function getSoccerResearchRoute(competition,marketFamily){
  return ROUTE_MAP.get(`${String(competition||"")}|${String(marketFamily||"").toUpperCase()}`) || null;
}

export function resolveSoccerResearchRoute({
  competition,
  marketFamily,
  evidenceSnapshot,
  evidenceCodeSha,
}={}){
  const route=getSoccerResearchRoute(competition,marketFamily);
  const fallback={
    ok:false,
    competition:String(competition||""),
    marketFamily:String(marketFamily||"").toUpperCase(),
    authoritativeModel:SOCCER_INCUMBENT_MODEL,
    researchModel:SOCCER_INCUMBENT_MODEL,
    lifecycle:"RESEARCH_ONLY",
    researchOnly:true,
    canQualify:false,
    canAuthorize:false,
  };
  if(!route)return{...fallback,reason:"missing-route"};
  if(
    evidenceSnapshot!==route.evidenceSnapshot ||
    evidenceCodeSha!==route.evidenceCodeSha
  ){
    return{...fallback,route,reason:"stale-or-unverified-evidence"};
  }
  if(route.validationClassification===SOCCER_ROUTE_CLASSIFICATION.FAIL){
    return{...fallback,route,reason:"advanced-layer-failed"};
  }
  if(route.validationClassification===SOCCER_ROUTE_CLASSIFICATION.INSUFFICIENT_EVIDENCE){
    return{...fallback,route,reason:"insufficient-evidence"};
  }
  return{
    ok:true,
    route,
    competition:route.competition,
    marketFamily:route.marketFamily,
    authoritativeModel:SOCCER_INCUMBENT_MODEL,
    researchModel:SOCCER_CHALLENGER_MODEL,
    lifecycle:"SHADOW",
    approvalState:route.approvalState,
    researchOnly:true,
    canQualify:false,
    canAuthorize:false,
    reason:route.validationClassification===SOCCER_ROUTE_CLASSIFICATION.PASS
      ?"pass-shadow-only"
      :"partial-pass-shadow-only",
  };
}

export function buildSoccerRoutingRegistryReport(){
  return{
    routeVersion:SOCCER_ROUTE_VERSION,
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
    routeCount:SOCCER_RESEARCH_ROUTES.length,
    incumbentModel:SOCCER_INCUMBENT_MODEL,
    challengerModel:SOCCER_CHALLENGER_MODEL,
    publicProjectionRoutingChanged:false,
    persistentStateUsed:false,
    researchOnly:true,
    canQualify:false,
    canAuthorize:false,
    routes:SOCCER_RESEARCH_ROUTES,
  };
}
