import test from "node:test";
import assert from "node:assert/strict";
import { nflSportDbContext } from "../functions/lib/nflSportDbContext.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const db={prepare(){}}, sport={prepare(){}};
test("nested NFL slate env carries approval receipt, binding and CORE hydration",()=>{
 const receipt="fixture";
 const outer={NFL_DB:sport,CORE_DB:db,DB:db,SPORT_DB_MODE_NFL:"sport",
  SPORT_CUTOVER_RECEIPT_NFL:receipt,
  __fbisCutoverApprovals:new Map([["nfl:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
 const nested={DB:db,...nflSportDbContext(outer)};
 const route=productSportDbHandle(nested,"nfl");
 assert.equal(route.binding,"NFL_DB");
 assert.equal(route.productIoUsesSportDb,true);
 assert.equal(route.canAuthorizeWager,false);
});
test("passing sport binding without a CORE grant never authorizes routing",()=>{
 const nested={DB:db,...nflSportDbContext({NFL_DB:sport,SPORT_DB_MODE_NFL:"sport",
 SPORT_CUTOVER_RECEIPT_NFL:"missing"})};
 assert.equal(productSportDbHandle(nested,"nfl").binding,"DB");
});
