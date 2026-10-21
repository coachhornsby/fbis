import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { insertCfbPregameFeatureVector, insertCfbPlayerRoleSnapshot } from "../functions/lib/collegeStore.js";

function db(label) {
 const writes=[];
 return {writes, prepare(sql) {return {bind(...params) {this.params=params;return this;},
 async run(){writes.push({label,sql,params:this.params});return {meta:{changes:1}};}};}};
}
const PRIMARY=db("PRIMARY"), CFB_DB=db("CFB_DB");
function auth() {
 return {DB:PRIMARY,CFB_DB,SPORT_DB_MODE_CFB:"sport",
 SPORT_DB_STRICT_CFB:"true",SPORT_CUTOVER_RECEIPT_CFB:"fixture",
 __fbisCutoverApprovals:new Map([["cfb:fixture",{receipt_id:"fixture",sport:"cfb",status:"APPROVED"}]])};
}
test("CFB PIT and player-role tables write only to independently approved sport D1",async()=>{
 const env=auth();
 const pit=await insertCfbPregameFeatureVector(env,{id:"pit-fixture",gameId:"1",season:2026,week:8});
 const role=await insertCfbPlayerRoleSnapshot(env,{id:"role-fixture",gameId:"1",season:2026,week:8});
 assert.equal(pit.ok,true);assert.equal(role.ok,true);
 assert.equal(PRIMARY.writes.length,0);
 assert.equal(CFB_DB.writes.length,2);
 assert.match(CFB_DB.writes[0].sql,/INSERT OR IGNORE INTO cfb_pregame_feature_vectors/);
 assert.match(CFB_DB.writes[1].sql,/INSERT OR IGNORE INTO cfb_player_role_snapshots/);
});
test("strict CFB mode with no CORE approval refuses PRIMARY fallback",async()=>{
 const env=auth();env.__fbisCutoverApprovals.clear();
 const out=await insertCfbPregameFeatureVector(env,{id:"denied",gameId:"1"});
 assert.equal(out.ok,false);
 assert.equal(PRIMARY.writes.length,0);
});
test("shadow CFB mode retains PRIMARY while the dedicated D1 remains unchanged",async()=>{
 const env=auth();env.SPORT_DB_MODE_CFB="shadow";
 const prev=CFB_DB.writes.length;
 const out=await insertCfbPregameFeatureVector(env,{id:"shadow",gameId:"1"});
 assert.equal(out.ok,true);
 assert.equal(CFB_DB.writes.length,prev);
});
test("read-only CFB PIT and data-ops consumers distinguish sport-owned and shared data",()=>{
 const pit=readFileSync(new URL("../functions/api/cfb-pit-scoreboard.js",import.meta.url),"utf8");
 const ops=readFileSync(new URL("../functions/api/cfb-data-ops.js",import.meta.url),"utf8");
 const archive=readFileSync(new URL("../functions/lib/cfbCoreArchive.js",import.meta.url),"utf8");
 assert.match(pit,/const db=productSportDbHandle\(context.env,"cfb"\)\.db/);
 assert.match(ops,/productSportDbHandle\(env,"cfb"\)\.db\.prepare/);
 assert.match(ops,/env\.DB\.prepare\(/);
 assert.match(archive,/const db = productSportDbHandle\(env, "cfb"\)\.db/);
});
