import test from "node:test";
import assert from "node:assert/strict";
import { copyNbaScopedSharedLedger, workingTablesForSport } from "../functions/lib/sportWorkingCopy.js";

const definitions = {
  odds_snapshots: [{name:"id",type:"INTEGER",pk:1},{name:"sport",type:"TEXT",pk:0},{name:"game_id",type:"TEXT",pk:0}],
  team_form: [{name:"sport",type:"TEXT",pk:1},{name:"season",type:"INTEGER",pk:2},{name:"team_key",type:"TEXT",pk:3}],
};
function mockDbs() {
  const writes = [], sourceSql = [];
  const rows = {
    odds_snapshots: [{id:3,sport:"nba",game_id:"nba-3"},{id:4,sport:"nfl",game_id:"nfl-4"}],
    team_form: [{sport:"nba",season:2026,team_key:"BOS"},{sport:"nfl",season:2026,team_key:"KC"}],
  };
  const primary = {prepare(sql) {
    sourceSql.push(sql);
    return {bind(...args){this.args=args;return this}, async all(){
      const table=sql.includes("odds_snapshots")?"odds_snapshots":"team_form";
      if(sql.startsWith("PRAGMA"))return {results:definitions[table]};
      return {results:rows[table].filter(x=>x.sport===this.args[0])};
    }};
  }};
  const shard={prepare(sql){return {bind(...args){this.args=args;return this},
    async first(){return null},async run(){writes.push({sql,args:this.args});return {meta:{changes:1}}}}}};
  return {primary,shard,writes,sourceSql};
}
test("NBA scope adds market observation and team form ledger to required cutover parity",()=>{
 const tables=workingTablesForSport("nba").map(x=>x.table);
 assert.ok(tables.includes("odds_snapshots"));
 assert.ok(tables.includes("team_form"));
 assert.ok(!workingTablesForSport("cfb").some(x=>x.table==="team_form"));
});
test("NBA shadow copier never imports rows for other sports",async()=>{
 for(const table of ["odds_snapshots","team_form"]){
  const {primary,shard,writes,sourceSql}=mockDbs();
  const result=await copyNbaScopedSharedLedger(primary,shard,table,{pageSize:5});
  assert.equal(result.ok,true);
  assert.equal(result.copied,1);
  assert.equal(result.exhausted,true);
  assert.ok(sourceSql.some(x=>x.includes("WHERE sport=?")));
  const insert=writes.find(x=>x.sql.startsWith("INSERT OR REPLACE"));
  assert.ok(insert);
  assert.ok(insert.args.includes("nba"));
  assert.ok(!insert.args.includes("nfl"));
 }
});
test("shadow copier rejects unapproved cross-sport table names",async()=>{
 const {primary,shard}=mockDbs();
 await assert.rejects(()=>copyNbaScopedSharedLedger(primary,shard,"games"),/NOT_APPROVED/);
});
