import test from "node:test";
import assert from "node:assert/strict";
import { listPublishedProjections } from "../functions/lib/publishedProjectionStore.js";

function makeDb(rows) {
 const queries=[];
 return {queries,prepare(sql) {
  let args=[];
  return {bind(...v){args=v;return this;},
   async all(){
    queries.push({sql,args});
    const filtered=rows.filter(row=>{
     if(sql.includes("sport <>") && row.sport==="nfl")return false;
     if(sql.includes("sport =") && row.sport!==args[0])return false;
     return true;
    });
    return {results:filtered};
   }};
 }};
}
const row=(sport,at)=>({sport,game_id:sport+"-1",game_date:"2026-10-22",
 start_time:null,model_version:"v1",payload_hash:sport,payload_json:"{}",published_at:at});
test("cross-sport publications aggregate approved NFL rows with other PRIMARY sports",async()=>{
 const DB=makeDb([row("nfl","2026-10-21T11:00:00Z"),row("cfb","2026-10-21T12:00:00Z")]);
 const NFL_DB=makeDb([row("nfl","2026-10-21T13:00:00Z")]);
 const receipt="fixture";
 const env={DB,NFL_DB,SPORT_DB_MODE_NFL:"sport",SPORT_CUTOVER_RECEIPT_NFL:receipt,
  __fbisCutoverApprovals:new Map([["nfl:"+receipt,{status:"APPROVED",sport:"nfl",receipt_id:receipt}]])};
 const rows=await listPublishedProjections(env,{limit:10});
 assert.deepEqual(rows.map(r=>r.sport),["nfl","cfb"]);
 assert.equal(DB.queries.length,1);assert.equal(NFL_DB.queries.length,1);
});
test("cross-sport publications stay on PRIMARY without approval",async()=>{
 const DB=makeDb([row("nfl","2026-10-21T11:00:00Z"),row("cfb","2026-10-21T12:00:00Z")]);
 const NFL_DB=makeDb([row("nfl","2026-10-21T13:00:00Z")]);
 const env={DB,NFL_DB,SPORT_DB_MODE_NFL:"sport",SPORT_CUTOVER_RECEIPT_NFL:"missing"};
 const rows=await listPublishedProjections(env);
 assert.equal(rows.length,2);assert.equal(NFL_DB.queries.length,0);
});
