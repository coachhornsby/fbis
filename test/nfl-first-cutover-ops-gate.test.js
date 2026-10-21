import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTopologyBindingGate, REQUIRED_PAGES_D1_BINDINGS, requiredSportModeVars } from "../functions/lib/topologyBindingGate.js";

function deployed() {
 const env={};
 for(const binding of REQUIRED_PAGES_D1_BINDINGS)env[binding.binding]={prepare(){}};
 for(const spec of requiredSportModeVars())env[spec.key]="shadow";
 return env;
}
test("approved strict NFL authority is compatible with 10 other shadow sports",()=>{
 const env=deployed();env.SPORT_DB_MODE_NFL="sport";env.SPORT_DB_STRICT_NFL="true";
 env.SPORT_CUTOVER_RECEIPT_NFL="nfl-test";
 env.__fbisCutoverApprovals=new Map([["nfl:nfl-test",{status:"APPROVED",receipt_id:"nfl-test"}]]);
 const gate=evaluateTopologyBindingGate(env,{surface:"pages"});
 assert.equal(gate.ok,true);
 assert.deepEqual(gate.approvedLive,["nfl"]);
 assert.equal(gate.anySportAuthoritative,true);
 assert.deepEqual(gate.modeFailures,[]);
 assert.equal(gate.canAuthorizeWager,false);
});
test("no CORE approval means configured NFL authority fails topology gate",()=>{
 const env=deployed();env.SPORT_DB_MODE_NFL="sport";env.SPORT_DB_STRICT_NFL="true";
 env.SPORT_CUTOVER_RECEIPT_NFL="missing";env.__fbisCutoverApprovals=new Map();
 const gate=evaluateTopologyBindingGate(env,{surface:"pages"});
 assert.equal(gate.ok,false);
 assert.ok(gate.modeFailures.some(x=>x.key==="SPORT_DB_MODE_NFL"));
});
test("a second premature sport cutover is rejected",()=>{
 const env=deployed();env.SPORT_DB_MODE_CFB="sport";
 const gate=evaluateTopologyBindingGate(env,{surface:"pages"});
 assert.equal(gate.ok,false);
});
