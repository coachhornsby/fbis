import test from "node:test";
import assert from "node:assert/strict";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";
import { evaluateTopologyBindingGate, REQUIRED_PAGES_D1_BINDINGS, requiredSportModeVars } from "../functions/lib/topologyBindingGate.js";

const DB={prepare(){}}, CFB_DB={prepare(){}}, NFL_DB={prepare(){}};
function fixture() {
 const env={DB,CFB_DB,NFL_DB};
 for(const binding of REQUIRED_PAGES_D1_BINDINGS)env[binding.binding]??={prepare(){}};
 for(const mode of requiredSportModeVars())env[mode.key]="shadow";
 env.SPORT_DB_MODE_NFL="sport";
 env.SPORT_DB_STRICT_NFL="true";
 env.SPORT_CUTOVER_RECEIPT_NFL="nfl-receipt";
 env.__fbisCutoverApprovals=new Map([["nfl:nfl-receipt",{status:"APPROVED",receipt_id:"nfl-receipt"}]]);
 return env;
}
test("independently approved CFB follows exact CFB D1 while NFL stays authoritative",()=>{
 const env=fixture();
 env.SPORT_DB_MODE_CFB="sport";
 env.SPORT_DB_STRICT_CFB="true";
 env.SPORT_CUTOVER_RECEIPT_CFB="cfb-receipt";
 env.__fbisCutoverApprovals.set("cfb:cfb-receipt",{status:"APPROVED",receipt_id:"cfb-receipt"});
 const h=productSportDbHandle(env,"cfb");
 assert.equal(h.db,CFB_DB);
 assert.equal(h.binding,"CFB_DB");
 assert.equal(h.canAuthorizeWager,false);
 const gate=evaluateTopologyBindingGate(env,{surface:"pages"});
 assert.equal(gate.ok,true);
 assert.deepEqual(gate.approvedLive,["nfl","cfb"]);
});
test("unapproved strict CFB fails closed rather than writing stale PRIMARY",()=>{
 const env=fixture();
 env.SPORT_DB_MODE_CFB="sport";
 env.SPORT_DB_STRICT_CFB="true";
 env.SPORT_CUTOVER_RECEIPT_CFB="missing";
 const h=productSportDbHandle(env,"cfb");
 assert.equal(h.db,null);
 assert.equal(h.canAuthorizeWager,false);
 assert.equal(evaluateTopologyBindingGate(env,{surface:"pages"}).ok,false);
});
test("CFB and all other sports remain PRIMARY while shadow, regardless of NFL",()=>{
 const env=fixture();
 assert.equal(productSportDbHandle(env,"cfb").db,DB);
 assert.equal(productSportDbHandle(env,"nhl").db,DB);
 assert.equal(productSportDbHandle(env,"tennis").db,DB);
});
