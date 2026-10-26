import test from "node:test";
import assert from "node:assert/strict";
import { cbbResearchOwner } from "../functions/lib/cbbResearchOwner.js";
import { persistCbbTeamProfiles } from "../functions/lib/cbbTeamProfiles.js";
import { refreshCbbDirectoryPhaseB } from "../functions/lib/cbbDirectoryPhaseB.js";
import { runCbbDirectoryPhaseB } from "../functions/lib/cbbDirectoryPhaseBRuntime.js";
import { onRequestGet } from "../functions/api/cbb-team-profiles.js";

const approved = {receipt_id:"cbb-test",sport:"cbb",status:"APPROVED",expires_at:null,revoked_at:null};
function fixture(row=approved) {
  const calls=[];
  const db=name=>({prepare(sql){calls.push({name,sql});return {bind(){return this;},
    async first(){return name==="core"?row:null;},async all(){return {results:[]};}};}});
  return {calls,env:{DB:db("primary"),CBB_DB:db("cbb"),CORE_DB:db("core"),
    SPORT_DB_MODE_CBB:"sport",SPORT_DB_STRICT_CBB:"true",SPORT_DB_LEDGER_READY_CBB:"true",
    SPORT_CUTOVER_RECEIPT_CBB:"cbb-test"}};
}
test("shadow preserves PRIMARY without consulting CORE or changing input context",async()=>{
  const {env,calls}=fixture();env.SPORT_DB_MODE_CBB="shadow";
  assert.equal((await cbbResearchOwner(env)).db,env.DB);assert.equal(calls.length,0);
});
test("approved CBB research resolves only CBB_DB using a fresh exact CORE query",async()=>{
  const {env,calls}=fixture();const stale=new Map();env.__fbisCutoverApprovals=stale;
  const owner=await cbbResearchOwner(env);
  assert.equal(owner.db,env.CBB_DB);assert.equal(owner.canAuthorizeWager,false);
  assert.deepEqual(calls.map(x=>x.name),["core"]);assert.equal(stale.size,0);
});
for(const [label,row] of Object.entries({absent:null,revoked:{...approved,status:"REVOKED"},
  revokedTimestamp:{...approved,revoked_at:"2020-01-01"},expired:{...approved,expires_at:"2020-01-01"},
  invalidExpiry:{...approved,expires_at:"invalid"},wrongSport:{...approved,sport:"nba"},
  wrongReceipt:{...approved,receipt_id:"wrong"}})) {
  test(`${label} CORE approval fails closed despite stale injected approval`,async()=>{
    const {env,calls}=fixture(row);env.__fbisCutoverApprovals=new Map([["cbb:cbb-test",approved]]);
    await assert.rejects(cbbResearchOwner(env),/CBB_CUTOVER_APPROVAL_REQUIRED/);
    assert.equal(calls.some(x=>x.name==="primary"||x.name==="cbb"),false);
  });
}
for(const key of ["CBB_DB","CORE_DB","SPORT_DB_STRICT_CBB","SPORT_DB_LEDGER_READY_CBB","SPORT_CUTOVER_RECEIPT_CBB"]) {
  test(`missing ${key} cannot fall back to PRIMARY`,async()=>{
    const {env,calls}=fixture();delete env[key];await assert.rejects(cbbResearchOwner(env),/CBB_/);
    assert.equal(calls.some(x=>x.name==="primary"),false);
  });
}
test("CORE outage rejects approval without a legacy-schema or PRIMARY retry",async()=>{
  const {env,calls}=fixture();env.CORE_DB={prepare(){throw Error("outage");}};
  await assert.rejects(cbbResearchOwner(env),/APPROVAL_UNAVAILABLE/);assert.equal(calls.length,0);
});
test("all guarded research consumers refuse missing activated owner before data or network access",async()=>{
  const {env,calls}=fixture();delete env.CBB_DB;
  assert.equal((await persistCbbTeamProfiles(env,[],{season:2027})).ok,false);
  assert.equal((await refreshCbbDirectoryPhaseB(env)).ok,false);
  await assert.rejects(runCbbDirectoryPhaseB(env),/BINDING_REQUIRED/);
  const request=new Request("https://test/api/cbb-team-profiles?teamId=cbb:duke&season=2027",
    {headers:{"x-harvest-secret":"test"}});
  const response=await onRequestGet({request,env:{...env,HARVEST_SECRET:"test"}});
  assert.equal(response.status,503);assert.equal(calls.length,0);
});

test('activated product resolver rejects missing CORE and malformed cached approval metadata',async()=>{
  const {productSportDbHandle}=await import('../functions/lib/databaseTopology.js');
  for(const row of [{...approved,expires_at:'invalid'},{...approved,revoked_at:'2020-01-01'},{...approved,sport:'nba'},{...approved,receipt_id:'different'}]){
    const {env}=fixture();env.__fbisCutoverApprovals=new Map([['cbb:cbb-test',row]]);assert.equal(productSportDbHandle(env,'cbb').db,null);
  }
  const {env}=fixture();delete env.CORE_DB;env.__fbisCutoverApprovals=new Map([['cbb:cbb-test',approved]]);assert.equal(productSportDbHandle(env,'cbb').db,null);
});
