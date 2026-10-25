import test from "node:test";
import assert from "node:assert/strict";
import {classifyTier3WeeklyEvidence,auditCfbTier3ProjectionReadiness} from "../functions/lib/cfbTier3ProjectionReadiness.js";
test("unverified provider publication cannot feed production projections",()=>{
 const row={season:2026,week:8,total:56,matched:54,pregame:56,published:0,feature_columns:72};
 const r=classifyTier3WeeklyEvidence(row);
 assert.equal(r.researchEligible,true);
 assert.equal(r.productionFeatureEligible,false);
 assert.equal(r.gate,"PROVIDER_PUBLICATION_CUTOFF_UNVERIFIED");
});
test("all evidence must pass identity, publication and receipt gates",()=>{
 const row={season:2026,week:8,total:56,matched:56,pregame:56,published:56,feature_columns:72};
 assert.equal(classifyTier3WeeklyEvidence(row).productionFeatureEligible,true);
 assert.equal(classifyTier3WeeklyEvidence({...row,pregame:55}).productionFeatureEligible,false);
 assert.equal(classifyTier3WeeklyEvidence({...row,matched:55}).productionFeatureEligible,false);
});
test("private audit is cache-only and no licensed values escape",async()=>{
 const db={prepare(sql){assert.match(sql,/cfb_tier3_training_snapshots/);return{all:async()=>({results:[{season:2026,week:8,total:56,matched:54,pregame:56,published:0,feature_columns:72}]})}}};
 const result=await auditCfbTier3ProjectionReadiness({TIER3_DB:db});
 assert.equal(result.summary.rows,56);
 assert.equal(result.summary.productionReadyWeeks,0);
 assert.equal(result.providerCalls,0);
 assert.equal(result.projectionInputsChanged,false);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(JSON.stringify(result).includes("features_json"),false);
 await assert.rejects(auditCfbTier3ProjectionReadiness({}),/TIER3_DB_UNBOUND/);
});

test("immutable pregame receipt allows research shadow evidence without invented provider time",()=>{
 const x=classifyTier3WeeklyEvidence({season:2026,week:8,total:56,matched:54,pregame:53,receipt_pit:51,published:0,feature_columns:72});
 assert.equal(x.researchPregameEligibleGames,51);
 assert.equal(x.clockEvidence,"FBIS_RECEIPT_ONLY");
 assert.equal(x.productionFeatureEligible,false);
 const no=classifyTier3WeeklyEvidence({season:2026,week:6,total:57,matched:56,pregame:0,receipt_pit:0,published:0});
 assert.equal(no.researchPregameEligible,false);
 assert.equal(no.productionFeatureEligible,false);
});
