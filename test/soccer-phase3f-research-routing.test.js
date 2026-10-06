import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SOCCER_RESEARCH_ROUTES,
  SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
  SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  resolveSoccerResearchRoute,
  getSoccerResearchRoute,
} from "../functions/lib/soccerResearchRouting.js";
import { getModel } from "../functions/lib/canonical/modelRegistry.js";

test("Phase 3F encodes exactly 50 immutable league × market-family routes",()=>{
  assert.equal(SOCCER_RESEARCH_ROUTES.length,50);
  assert.equal(new Set(SOCCER_RESEARCH_ROUTES.map(r=>r.routeId)).size,50);
  for(const r of SOCCER_RESEARCH_ROUTES){
    assert.equal(r.evidenceSnapshot,SOCCER_ROUTE_EVIDENCE_SNAPSHOT);
    assert.equal(r.evidenceCodeSha,SOCCER_ROUTE_EVIDENCE_CODE_SHA);
    assert.equal(r.incumbentModel,"SOCCER-FBIS-v2");
    assert.equal(r.challengerModel,"SOCCER-FBIS-v3.1");
    assert.equal(r.researchOnly,true);
    assert.equal(r.canQualify,false);
    assert.equal(r.canAuthorize,false);
  }
});

test("Phase 3F exact routing matrix preserves evidence decisions",()=>{
  assert.equal(getSoccerResearchRoute("eng.1","1X2").validationClassification,"FAIL");
  assert.equal(getSoccerResearchRoute("eng.1","BTTS").validationClassification,"PASS");
  assert.equal(getSoccerResearchRoute("eng.2","1X2").validationClassification,"PARTIAL_PASS");
  assert.equal(getSoccerResearchRoute("esp.1","1X2").validationClassification,"PASS");
  assert.equal(getSoccerResearchRoute("ita.1","TOTALS_O25").validationClassification,"PASS");
  assert.equal(getSoccerResearchRoute("fra.1","ASIAN_HANDICAP").validationClassification,"PASS");
  assert.equal(getSoccerResearchRoute("uefa.champions","GOALS").validationClassification,"PASS");
  assert.equal(getSoccerResearchRoute("uefa.europa","BTTS").validationClassification,"INSUFFICIENT_EVIDENCE");
  assert.equal(getSoccerResearchRoute("usa.1","1X2").validationClassification,"PARTIAL_PASS");
  assert.equal(getSoccerResearchRoute("mex.1","BTTS").validationClassification,"PASS");
});

test("Phase 3F resolver is fail-closed and never changes authoritative model",()=>{
  const pass=resolveSoccerResearchRoute({
    competition:"esp.1",marketFamily:"1X2",
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  assert.equal(pass.ok,true);
  assert.equal(pass.lifecycle,"SHADOW");
  assert.equal(pass.authoritativeModel,"SOCCER-FBIS-v2");
  assert.equal(pass.researchModel,"SOCCER-FBIS-v3.1");
  assert.equal(pass.canQualify,false);
  assert.equal(pass.canAuthorize,false);

  const partial=resolveSoccerResearchRoute({
    competition:"eng.2",marketFamily:"1X2",
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  assert.equal(partial.ok,true);
  assert.equal(partial.authoritativeModel,"SOCCER-FBIS-v2");
  assert.equal(partial.researchModel,"SOCCER-FBIS-v3.1");

  const failed=resolveSoccerResearchRoute({
    competition:"eng.1",marketFamily:"1X2",
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  assert.equal(failed.ok,false);
  assert.equal(failed.reason,"advanced-layer-failed");
  assert.equal(failed.authoritativeModel,"SOCCER-FBIS-v2");
  assert.equal(failed.researchModel,"SOCCER-FBIS-v2");

  const insufficient=resolveSoccerResearchRoute({
    competition:"uefa.europa",marketFamily:"GOALS",
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  assert.equal(insufficient.ok,false);
  assert.equal(insufficient.reason,"insufficient-evidence");
  assert.equal(insufficient.researchModel,"SOCCER-FBIS-v2");

  const stale=resolveSoccerResearchRoute({
    competition:"esp.1",marketFamily:"1X2",
    evidenceSnapshot:"wrong-snapshot",
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  assert.equal(stale.ok,false);
  assert.equal(stale.reason,"stale-or-unverified-evidence");
  assert.equal(stale.researchModel,"SOCCER-FBIS-v2");

  const missing=resolveSoccerResearchRoute({
    competition:"bra.1",marketFamily:"1X2",
    evidenceSnapshot:SOCCER_ROUTE_EVIDENCE_SNAPSHOT,
    evidenceCodeSha:SOCCER_ROUTE_EVIDENCE_CODE_SHA,
  });
  assert.equal(missing.ok,false);
  assert.equal(missing.reason,"missing-route");
  assert.equal(missing.researchModel,"SOCCER-FBIS-v2");
});

test("Phase 3F canonical model registrations remain research-only",()=>{
  const v2=getModel("SOCCER-FBIS-v2");
  const v31=getModel("SOCCER-FBIS-v3.1");
  assert.ok(v2);
  assert.ok(v31);
  assert.equal(v2.maturity,"RESEARCH");
  assert.equal(v31.maturity,"RESEARCH");
  assert.equal(v2.canQualify,false);
  assert.equal(v2.canAuthorizeWager,false);
  assert.equal(v31.canQualify,false);
  assert.equal(v31.canAuthorizeWager,false);
  assert.equal(v31.marketInformed,false);
});

test("Phase 3F shadow ledger contract is inert, explicit, and research-only",async()=>{
  const migration=await readFile(new URL("../migrations/0079_soccer_phase3f_research_routing.sql",import.meta.url),"utf8");
  const projections=await readFile(new URL("../functions/api/projections.js",import.meta.url),"utf8");
  assert.match(migration,/CREATE TABLE IF NOT EXISTS soccer_research_routes/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS soccer_prospective_shadow/);
  assert.equal((migration.match(/SOCCER-PHASE3F-ROUTING-v1:/g)||[]).length,50);
  assert.match(migration,/v2_probability REAL/);
  assert.match(migration,/v31_probability REAL/);
  assert.match(migration,/market_no_vig_probability REAL/);
  assert.match(migration,/line_timestamp TEXT/);
  assert.match(migration,/close_no_vig_probability REAL/);
  assert.match(migration,/clv_probability REAL/);
  assert.match(migration,/simulated_profit_units REAL/);
  assert.match(migration,/simulated_roi REAL/);
  assert.match(migration,/CHECK\(research_only=1\)/);
  assert.match(migration,/CHECK\(can_qualify=0\)/);
  assert.match(migration,/CHECK\(can_authorize=0\)/);
  assert.match(migration,/HISTORICAL_MARKET_UNAVAILABLE/);
  assert.doesNotMatch(projections,/soccerResearchRouting/);
});
