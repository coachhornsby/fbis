import test from "node:test";
import assert from "node:assert/strict";
import { recoverMissingNbaResearchPage } from "../functions/lib/nbaPostCutoverRecovery.js";

const approval={receipt_id:"nba-unit-research",sport:"nba",status:"APPROVED",approved_at:"2026-10-23T12:00:00Z",revoked_at:null,expires_at:null};
function dataEnv({grant=true,mode="sport"}={}){
 const info=[{name:"id",pk:1},{name:"payload",pk:0}];
 const sourceRows=[
  {__fbis_recovery_rowid:1,id:"nba-legacy-only",payload:"old-data"},
  {__fbis_recovery_rowid:2,id:"nba-existing",payload:"outdated-primary"},
 ];
 const data=new Map([["nba-existing",{id:"nba-existing",payload:"newer-destination"}]]);
 const queries={primary:[],nba:[]};
 const primary={prepare(sql){queries.primary.push(sql);return {
  bind(...args){this.args=args;return this},
  async all(){if(sql.startsWith("PRAGMA"))return {results:info};
    if(sql.startsWith("SELECT rowid"))return {results:sourceRows.filter(x=>x.__fbis_recovery_rowid>this.args[0]).slice(0,this.args[2])};
    throw Error("unhandled PRIMARY SQL "+sql);
  },
  async first(){if(sql.includes("MAX(rowid)"))return {n:2};throw Error("unhandled PRIMARY first");}
 }}};
 const nba={prepare(sql){queries.nba.push(sql);return {
   bind(...args){this.args=args;return this},
   async all(){
    if(sql.startsWith("PRAGMA"))return {results:info};
    if(sql.startsWith('SELECT "id" FROM'))return {results:this.args.filter(x=>data.has(x)).map(id=>({id}))};
    if(sql.startsWith("SELECT * FROM"))return {results:this.args.filter(x=>data.has(x)).map(id=>data.get(id))};
    throw Error("unhandled NBA SQL "+sql);
   },
   async run(){
    if(!sql.startsWith("INSERT OR IGNORE INTO"))throw Error("UNSAFE WRITE:"+sql);
    const [id,payload]=this.args;
    if(!data.has(id))data.set(id,{id,payload});
    return {success:true,meta:{changes:1}};
   }
 }}};
 const core={prepare(){return {bind(){return this},async all(){return {results:grant?[approval]:[]}}}}};
 return {env:{DB:primary,NBA_DB:nba,CORE_DB:core,SPORT_DB_MODE_NBA:mode,
  SPORT_DB_STRICT_NBA:"true",SPORT_DB_LEDGER_READY_NBA:"true",
  SPORT_CUTOVER_RECEIPT_NBA:approval.receipt_id},data,queries};
}
test("missing-only recovery inserts verified source row and never changes existing newer NBA_DB value",async()=>{
 const x=dataEnv();
 const p=await recoverMissingNbaResearchPage(x.env,{table:"nba_team_profiles",pageSize:20});
 assert.equal(p.ok,true);
 assert.equal(p.inserted,1);
 assert.equal(p.alreadyInNbaDb,1);
 assert.equal(p.exhausted,true);
 assert.deepEqual(x.data.get("nba-existing"),{id:"nba-existing",payload:"newer-destination"});
 assert.deepEqual(x.data.get("nba-legacy-only"),{id:"nba-legacy-only",payload:"old-data"});
 assert.equal(p.sourceRowsDeleted,0);
 assert.equal(p.existingRowsOverwritten,0);
 assert.ok(!x.queries.primary.some(q=>/DELETE|INSERT|UPDATE|DROP/i.test(q)));
 assert.ok(!x.queries.nba.some(q=>/DELETE|UPDATE|DROP/i.test(q)));
 const repeated=await recoverMissingNbaResearchPage(x.env,{table:"nba_team_profiles",pageSize:20});
 assert.equal(repeated.ok,true);
 assert.equal(repeated.inserted,0);
});
test("research recovery refuses shadow mode, revoked CORE receipt and non-NBA table",async()=>{
 for(const state of [{mode:"shadow"},{grant:false}]){
  const x=dataEnv(state);
  const r=await recoverMissingNbaResearchPage(x.env,{table:"nba_team_profiles"});
  assert.equal(r.ok,false);
  assert.deepEqual(x.queries.primary,[]);
  assert.deepEqual(x.queries.nba,[]);
 }
 const x=dataEnv();
 const r=await recoverMissingNbaResearchPage(x.env,{table:"games"});
 assert.equal(r.ok,false);
 assert.deepEqual(x.queries.primary,[]);
});
test("dry-run counts missing rows but does not alter the NBA database",async()=>{
 const x=dataEnv();
 const r=await recoverMissingNbaResearchPage(x.env,{table:"nba_team_profiles",dryRun:true});
 assert.equal(r.ok,true);
 assert.equal(r.wouldInsert,1);
 assert.equal(r.inserted,0);
 assert.equal(x.data.has("nba-legacy-only"),false);
});
