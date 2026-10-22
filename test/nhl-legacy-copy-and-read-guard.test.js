import test from "node:test";
import assert from "node:assert/strict";
import { copyNhlPilotTables } from "../functions/lib/nhlSportDb.js";
import { nhlDurableDatabase } from "../functions/lib/nhlSportShard.js";

const primary={prepare(){throw Error("STALE_PRIMARY_TOUCHED");}};
const sport={prepare(){throw Error("SHARD_TOUCHED");}};
test("NHL partial-row legacy copy is blocked before any D1 statement in sport mode",async()=>{
 const result=await copyNhlPilotTables({DB:primary,NHL_DB:sport,SPORT_DB_MODE_NHL:"sport"});
 assert.equal(result.ok,false);
 assert.equal(result.reason,"SHADOW_SYNC_REFUSED_SPORT_MODE");
});
test("legacy durable read requires CORE-approved NHL authority when sport is active",async()=>{
 const receipt="fixture-nhl-approval";
 const env={DB:primary,NHL_DB:sport,SPORT_DB_MODE_NHL:"sport",
 SPORT_DB_STRICT_NHL:"true",SPORT_CUTOVER_RECEIPT_NHL:receipt,
 __fbisCutoverApprovals:new Map([["nhl:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
 const approved=await nhlDurableDatabase(env);
 assert.equal(approved.db,sport);
 assert.equal(approved.database,"NHL_DB");
 assert.equal(approved.canAuthorizeWager,false);
 env.__fbisCutoverApprovals.clear();
 const revoked=await nhlDurableDatabase(env);
 assert.equal(revoked.db,null);
 assert.equal(revoked.database,"UNAVAILABLE");
 assert.equal(revoked.liveReadsRerouted,false);
});
