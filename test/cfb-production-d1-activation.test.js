import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";
import { sportLedgerEnv, sportLedgerFanoutDbs } from "../functions/lib/sportLedgerRouting.js";
const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const [base, prod=""] = toml.split("[env.production.vars]");
const vars=prod.split("[[env.production.d1_databases]]")[0];
const DB={prepare(){}}, CFB_DB={prepare(){}}, NFL_DB={prepare(){}}, NHL_DB={prepare(){}};
test("CFB activates only in production config, preserves existing NFL",()=>{
 for(const sport of ["NFL","CFB"]) {
   assert.ok(base.includes('SPORT_DB_MODE_'+sport+' = "shadow"'));
   assert.ok(vars.includes('SPORT_DB_MODE_'+sport+' = "sport"'));
 }
 for(const sport of ["NHL","NBA","MLB","CBB","WNBA","SOCCER","TENNIS","NPB","KBO"]) {
   assert.ok(vars.includes('SPORT_DB_MODE_'+sport+' = "shadow"'));
 }
 assert.ok(vars.includes('SPORT_DB_LEDGER_READY_CFB = "true"'));
 assert.ok(vars.includes('SPORT_DB_STRICT_CFB = "true"'));
 assert.ok(vars.includes('SPORT_CUTOVER_RECEIPT_CFB = "cfb-20261021-production-v1"'));
});
test("independent CORE receipts route CFB and NFL but not NHL",()=>{
 const env={DB,CFB_DB,NFL_DB,NHL_DB,SPORT_DB_MODE_CFB:"sport",SPORT_DB_STRICT_CFB:"true",
 SPORT_DB_LEDGER_READY_CFB:"true",SPORT_CUTOVER_RECEIPT_CFB:"cfb-20261021-production-v1",
 SPORT_DB_MODE_NFL:"sport",SPORT_DB_STRICT_NFL:"true",SPORT_CUTOVER_RECEIPT_NFL:"nfl-20261021-production-v1",
 SPORT_DB_MODE_NHL:"shadow",
 __fbisCutoverApprovals:new Map([
 ["cfb:cfb-20261021-production-v1",{status:"APPROVED",receipt_id:"cfb-20261021-production-v1"}],
 ["nfl:nfl-20261021-production-v1",{status:"APPROVED",receipt_id:"nfl-20261021-production-v1"}]])};
 assert.equal(productSportDbHandle(env,"cfb").db,CFB_DB);
 assert.equal(productSportDbHandle(env,"nfl").db,NFL_DB);
 assert.equal(productSportDbHandle(env,"nhl").db,DB);
 assert.equal(sportLedgerEnv(env,"cfb").DB,CFB_DB);
 assert.deepEqual(sportLedgerFanoutDbs(env).map(x=>x.sport),["nfl","cfb"]);
 env.__fbisCutoverApprovals.delete("cfb:cfb-20261021-production-v1");
 assert.equal(productSportDbHandle(env,"cfb").db,null);
 assert.equal(sportLedgerEnv(env,"cfb").DB,null);
});
