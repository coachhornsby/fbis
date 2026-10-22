import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sportDbContext } from "../functions/lib/nflSportDbContext.js";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";
import { sportLedgerEnv } from "../functions/lib/sportLedgerRouting.js";

const collect=readFileSync(new URL("../functions/api/collect.js",import.meta.url),"utf8");
test("scheduled collect passes all approved sport bindings and CORE grant through collectBoards",()=>{
 assert.match(collect,/import \{ sportDbContext \} from "\.\.\/lib\/nflSportDbContext\.js";/);
 assert.match(collect,/const payload = await collectBoards\([\s\S]*?\.\.\.sportDbContext\(context\.env\),\s*DB: context\.env\.DB,/);
});
test("scheduled NHL frozen game/snapshot writers reach NHL_DB with current CORE approval",()=>{
 const DB={prepare(){}},NHL_DB={prepare(){}},NFL_DB={prepare(){}},CFB_DB={prepare(){}};
 const receipt="nhl-authorized";
 const current={DB,NHL_DB,NFL_DB,CFB_DB,CORE_DB:{prepare(){}},SPORT_DB_MODE_NHL:"sport",
  SPORT_DB_STRICT_NHL:"true",SPORT_DB_LEDGER_READY_NHL:"true",SPORT_CUTOVER_RECEIPT_NHL:receipt,
  __fbisCutoverApprovals:new Map([["nhl:"+receipt,{status:"APPROVED",receipt_id:receipt}]])};
 const collected={...sportDbContext(current),DB:current.DB};
 assert.equal(productSportDbHandle(collected,"nhl").db,NHL_DB);
 assert.equal(sportLedgerEnv(collected,"nhl").DB,NHL_DB);
 collected.__fbisCutoverApprovals.clear();
 assert.equal(productSportDbHandle(collected,"nhl").db,null);
 assert.equal(sportLedgerEnv(collected,"nhl").DB,null);
});
test("other sports remain PRIMARY without their own approved receipt",()=>{
 const DB={prepare(){}},NHL_DB={prepare(){}},NBA_DB={prepare(){}};
 const collected={DB,...sportDbContext({NHL_DB,NBA_DB,SPORT_DB_MODE_NHL:"shadow",SPORT_DB_MODE_NBA:"shadow"})};
 assert.equal(sportLedgerEnv(collected,"nhl").DB,DB);
 assert.equal(sportLedgerEnv(collected,"nba").DB,DB);
});
