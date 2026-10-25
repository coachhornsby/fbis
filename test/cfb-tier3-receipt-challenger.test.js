import test from "node:test";
import assert from "node:assert/strict";
import {computeTier3ReceiptChallenger,auditTier3ReceiptChallenger} from "../functions/lib/cfbTier3ReceiptChallenger.js";
const row={
 gameId:"401858273",season:2026,week:8,snapshotSeason:2026,snapshotWeek:8,
 kickoff:"2026-10-24T19:00:00Z",receivedAt:"2026-10-20T06:31:52Z",
 identityStatus:"matched",homeCanonicalId:"cfb-59",awayCanonicalId:"cfb-103",
 authority:"research_only",snapshotStatus:"research_only",canInfluenceProjection:0,canAuthorizeWager:0,
 features:{home_adjusted_passing_epa:.2,away_adjusted_passing_epa:.1,
 home_adjusted_passing_epa_allowed:-.03,away_adjusted_passing_epa_allowed:.05,
 home_adjusted_rushing_epa:.08,away_adjusted_rushing_epa:.07,
 home_adjusted_rushing_epa_allowed:.01,away_adjusted_rushing_epa_allowed:.02}
};
const champ={home:28,away:24,frozenAt:"2026-10-23T12:00:00Z"};
test("receipt-clock challenger is research-only and preserves the champion total",()=>{
 const a=computeTier3ReceiptChallenger(row,champ);
 assert.equal(a.eligible,true);
 assert.equal(a.challenger.total,52);
 assert.equal(a.champion.total,52);
 assert.equal(a.projectionInputsChanged,false);
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.prospectiveGradeEligible,false);
});
test("rejects after-kickoff and ambiguous identity, source authority, absent EPA and absent champion",()=>{
 for(const patch of [{receivedAt:"2026-10-24T18:58:00Z"},{identityStatus:"partial_match"},
 {awayCanonicalId:null},{snapshotWeek:7},{canAuthorizeWager:1},{features:{}}])
  assert.equal(computeTier3ReceiptChallenger({...row,...patch},champ).eligible,false);
 assert.equal(computeTier3ReceiptChallenger(row,null).eligible,false);
});
test("bounded cross-database research never persists or calls providers",async()=>{
 let writes=0;
 const tier={prepare(){return{bind(){return{all:async()=>({results:[{...row,featuresJson:JSON.stringify(row.features)}]})}}}}};
 const cfb={prepare(){return{bind(){return{first:async()=>champ}}}}};
 const out=await auditTier3ReceiptChallenger({TIER3_DB:tier,CFB_DB:cfb},{season:2026,week:8});
 assert.equal(out.researchEligible,1);
 assert.equal(out.providerRequests,0);
 assert.equal(out.canAuthorizeWager,false);
 assert.equal(writes,0);
 await assert.rejects(auditTier3ReceiptChallenger({}),/DEDICATED_DATABASE_BINDING_MISSING/);
});
