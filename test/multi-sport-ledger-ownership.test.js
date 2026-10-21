import test from "node:test";
import assert from "node:assert/strict";
import { sportLedgerEnv, sportLedgerFanoutDbs } from "../functions/lib/sportLedgerRouting.js";
import { queryGames, persistGame } from "../functions/lib/store.js";

function fake(rows=[]) {
  const calls=[];
  return {calls,prepare(sql){
    let binds=[];
    return {bind(...p){binds=p;return this;},
      async all(){
        calls.push({sql,binds});
        const sport=binds.find(x=>["cfb","nfl","all"].includes(x));
        return {results:sport&&sport!=="all"?rows.filter(x=>x.sport===sport):rows};
      },
      async run(){calls.push({sql,binds});return {meta:{changes:1}};},
      async first(){return {n:rows.length};}
    };
  }};
}
function env() {
  const DB=fake([{id:"nfl-primary",sport:"nfl",date:"2026-10-21",start:"2026-10-21T12:00Z"},
    {id:"cfb-primary",sport:"cfb",date:"2026-10-21",start:"2026-10-21T13:00Z"},
    {id:"nba-primary",sport:"nba",date:"2026-10-21",start:"2026-10-21T14:00Z"}]);
  const NFL_DB=fake([{id:"nfl-shard",sport:"nfl",date:"2026-10-21",start:"2026-10-21T15:00Z"}]);
  const CFB_DB=fake([{id:"cfb-shard",sport:"cfb",date:"2026-10-21",start:"2026-10-21T16:00Z"}]);
  const e={DB,NFL_DB,CFB_DB,SPORT_DB_MODE_NFL:"sport",
    SPORT_DB_STRICT_NFL:"true",SPORT_CUTOVER_RECEIPT_NFL:"nfl-receipt",
    SPORT_DB_MODE_CFB:"shadow",
    __fbisCutoverApprovals:new Map([["nfl:nfl-receipt",{status:"APPROVED",receipt_id:"nfl-receipt"}]])};
  return e;
}
test("NFL authority remains unchanged and shadow CFB remains PRIMARY",()=>{
  const e=env();
  assert.equal(sportLedgerEnv(e,"nfl").DB,e.NFL_DB);
  assert.equal(sportLedgerEnv(e,"cfb").DB,e.DB);
  assert.deepEqual(sportLedgerFanoutDbs(e).map(x=>x.sport),["nfl"]);
});
test("unqualified CFB ledger is refused even with valid CORE approval",async()=>{
  const e=env();
  e.SPORT_DB_MODE_CFB="sport";
  e.SPORT_DB_STRICT_CFB="true";
  e.SPORT_CUTOVER_RECEIPT_CFB="cfb-receipt";
  e.__fbisCutoverApprovals.set("cfb:cfb-receipt",{status:"APPROVED",receipt_id:"cfb-receipt"});
  assert.equal(sportLedgerEnv(e,"cfb").DB,null);
  assert.throws(()=>sportLedgerFanoutDbs(e),/SPORT_LEDGER_NOT_QUALIFIED/);
  const result=await queryGames(e,{sport:"all",date:"2026-10-21"});
  assert.equal(result.ok,false);
});
test("separately qualified CFB joins NFL cross-sport games without stale PRIMARY duplicates",async()=>{
  const e=env();
  e.SPORT_DB_MODE_CFB="sport";
  e.SPORT_DB_STRICT_CFB="true";
  e.SPORT_CUTOVER_RECEIPT_CFB="cfb-receipt";
  e.SPORT_DB_LEDGER_READY_CFB="true";
  e.__fbisCutoverApprovals.set("cfb:cfb-receipt",{status:"APPROVED",receipt_id:"cfb-receipt"});
  assert.equal(sportLedgerEnv(e,"cfb").DB,e.CFB_DB);
  const r=await queryGames(e,{sport:"all",date:"2026-10-21"});
  assert.equal(r.ok,true);
  assert.deepEqual(new Set(r.rows.map(x=>x.id)),new Set(["nfl-shard","cfb-shard","nba-primary"]));
  assert.equal(r.rows.some(x=>x.id==="cfb-primary"),false);
  assert.equal(r.rows.some(x=>x.id==="nfl-primary"),false);
  assert.equal(e.CFB_DB.calls.length,1);
});
