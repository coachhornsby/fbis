import test from "node:test";
import assert from "node:assert/strict";
import { sportDbContext, nflSportDbContext } from "../functions/lib/nflSportDbContext.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const db={prepare(){}},nfl={prepare(){}},cfb={prepare(){}},nhl={prepare(){}};
test("legacy request context preserves independently approved NHL and CFB bindings",()=>{
 const receipt="cfb-receipt",env={
  DB:db,NFL_DB:nfl,CFB_DB:cfb,NHL_DB:nhl,CORE_DB:db,
  SPORT_DB_MODE_CFB:"sport",SPORT_DB_STRICT_CFB:"true",
  SPORT_CUTOVER_RECEIPT_CFB:receipt,SPORT_DB_LEDGER_READY_CFB:"true",
  SPORT_DB_MODE_NFL:"shadow",
  SPORT_DB_MODE_NHL:"shadow",
  __fbisCutoverApprovals:new Map([["cfb:"+receipt,{status:"APPROVED",receipt_id:receipt}]])
 };
 const nested={DB:db,...sportDbContext(env)};
 const alias={DB:db,...nflSportDbContext(env)};
 assert.equal(nested.CFB_DB,cfb);
 assert.equal(nested.NHL_DB,nhl);
 assert.equal(nested.SPORT_DB_LEDGER_READY_CFB,"true");
 assert.equal(alias.CFB_DB,cfb);
 assert.equal(productSportDbHandle(nested,"cfb").db,cfb);
 assert.equal(productSportDbHandle(nested,"nfl").db,db);
});
test("context does not create or promote any missing sport authority",()=>{
 const nested={DB:db,...sportDbContext({NFL_DB:nfl,CFB_DB:cfb,CORE_DB:db})};
 assert.equal(productSportDbHandle(nested,"cfb").db,db);
 assert.equal(productSportDbHandle(nested,"nfl").db,db);
 assert.equal(nested.SPORT_CUTOVER_RECEIPT_CFB,undefined);
});
