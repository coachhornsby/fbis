import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productSportDbHandle } from "../functions/lib/databaseTopology.js";
import { sportLedgerEnv, sportLedgerFanoutDbs } from "../functions/lib/sportLedgerRouting.js";
const text=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
const [preview,prod=""]=text.split("[env.production.vars]");
const cfg=prod.split("[[env.production.d1_databases]]")[0];
test("NHL joins NFL and CFB as separately approved sport authority only in production",()=>{
 for(const sport of ["NHL","NFL","CFB"]){
  assert.ok(preview.includes('SPORT_DB_MODE_'+sport+' = "shadow"'));
  assert.ok(cfg.includes('SPORT_DB_MODE_'+sport+' = "sport"'));
 }
 for(const sport of ["NBA","CBB","MLB","SOCCER","TENNIS","WNBA","NPB","KBO"]){
  assert.ok(cfg.includes('SPORT_DB_MODE_'+sport+' = "shadow"'));
 }
 assert.ok(cfg.includes('NHL_SPORT_DB_MODE = "shadow"'));
 assert.ok(cfg.includes('SPORT_DB_STRICT_NHL = "true"'));
 assert.ok(cfg.includes('SPORT_DB_LEDGER_READY_NHL = "true"'));
 assert.ok(cfg.includes('SPORT_CUTOVER_RECEIPT_NHL = "nhl-20261022-production-v1"'));
});
test("NHL independent CORE approval moves only NHL IO; revocation fails closed",()=>{
 const DB={prepare(){}},NHL_DB={prepare(){}},NFL_DB={prepare(){}},CFB_DB={prepare(){}},receipt="nhl-20261022-production-v1";
 const env={DB,NHL_DB,NFL_DB,CFB_DB,
  SPORT_DB_MODE_NHL:"sport",SPORT_DB_STRICT_NHL:"true",
  SPORT_DB_LEDGER_READY_NHL:"true",SPORT_CUTOVER_RECEIPT_NHL:receipt,
  SPORT_DB_MODE_NFL:"sport",SPORT_DB_STRICT_NFL:"true",SPORT_CUTOVER_RECEIPT_NFL:"nfl-x",
  SPORT_DB_MODE_CFB:"sport",SPORT_DB_STRICT_CFB:"true",SPORT_DB_LEDGER_READY_CFB:"true",SPORT_CUTOVER_RECEIPT_CFB:"cfb-x",
  __fbisCutoverApprovals:new Map([
   ["nhl:"+receipt,{status:"APPROVED",receipt_id:receipt}],
   ["nfl:nfl-x",{status:"APPROVED",receipt_id:"nfl-x"}],
   ["cfb:cfb-x",{status:"APPROVED",receipt_id:"cfb-x"}]])};
 assert.equal(productSportDbHandle(env,"nhl").db,NHL_DB);
 assert.equal(sportLedgerEnv(env,"nhl").DB,NHL_DB);
 assert.equal(sportLedgerFanoutDbs(env).length,3);
 assert.equal(productSportDbHandle(env,"nhl").canAuthorizeWager,false);
 env.__fbisCutoverApprovals.delete("nhl:"+receipt);
 assert.equal(productSportDbHandle(env,"nhl").db,null);
 assert.equal(sportLedgerEnv(env,"nhl").DB,null);
 assert.throws(()=>sportLedgerFanoutDbs(env));
});
