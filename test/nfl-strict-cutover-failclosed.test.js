import test from "node:test";
import assert from "node:assert/strict";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";

const DB={prepare(){}};const NFL_DB={prepare(){}};
test("strict live NFL mode rejects a missing CORE receipt without PRIMARY fallback",()=>{
 const h=productSportDbHandle({DB,NFL_DB,SPORT_DB_MODE_NFL:"sport",
  SPORT_DB_STRICT_NFL:"true",SPORT_CUTOVER_RECEIPT_NFL:"receipt",__fbisCutoverApprovals:new Map()},"nfl");
 assert.equal(h.db,null);assert.equal(h.binding,"UNAVAILABLE");
 assert.equal(h.canAuthorizeWager,false);
});
test("strict live NFL mode rejects lost sport D1 binding rather than writing PRIMARY",()=>{
 const h=productSportDbHandle({DB,SPORT_DB_MODE_NFL:"sport",SPORT_DB_STRICT_NFL:"true",
  SPORT_CUTOVER_RECEIPT_NFL:"receipt"},"nfl");
 assert.equal(h.db,null);
});
test("strict NFL controls preserve ordinary PRIMARY shadow traffic",()=>{
 const h=productSportDbHandle({DB,NFL_DB,SPORT_DB_MODE_NFL:"shadow",SPORT_DB_STRICT_NFL:"true"},"nfl");
 assert.equal(h.db,DB);assert.equal(h.binding,"DB");
});
test("approved live NFL remains on its exact NFL D1 and never grants wagering",()=>{
 const h=productSportDbHandle({DB,NFL_DB,SPORT_DB_MODE_NFL:"sport",
  SPORT_DB_STRICT_NFL:"true",SPORT_CUTOVER_RECEIPT_NFL:"receipt",
  __fbisCutoverApprovals:new Map([["nfl:receipt",{status:"APPROVED",receipt_id:"receipt"}]])},"nfl");
 assert.equal(h.db,NFL_DB);assert.equal(h.binding,"NFL_DB");
 assert.equal(h.canAuthorizeWager,false);
});
