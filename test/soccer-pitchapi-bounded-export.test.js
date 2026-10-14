import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/soccer-pitchapi-export.js";

function envSql() {
 const calls=[];
 return {calls,env:{HARVEST_SECRET:"test-credential",DB:{prepare(sql){return{bind(...args){
  calls.push({sql,args});
  return{all:async()=>({results:[{pitch_match_id:"m_1",home_xg:1.2,home_ppda:null}]})};
 }}}}}};
}
function request(q){return new Request("https://example.test/api/soccer-pitchapi-export?"+q,{headers:{"x-harvest-secret":"test-credential"}});}

test("PitchAPI model export is scalar-only, source-masked, and page-bounded",async()=>{
 const d=envSql(),r=await onRequestGet({request:request("league=ger.1&mode=model&limit=5000&offset=500"),env:d.env});
 const body=await r.json();
 assert.equal(r.status,200);assert.equal(body.ok,true);assert.equal(body.mode,"model");
 assert.equal(body.limit,250);assert.equal(body.offset,500);
 assert.deepEqual(d.calls[0].args,["ger.1","2021-01-01","9999-12-31",250,500]);
 assert.match(d.calls[0].sql,/CASE WHEN raw_advanced_json IS NULL THEN NULL ELSE home_ppda END AS home_ppda/);
 assert.doesNotMatch(d.calls[0].sql,/SELECT\s+\*/);
 assert.ok(!Object.hasOwn(body.rows[0],"raw_advanced_json"));
});
test("PitchAPI audit raw export remains separately capped and invalid offsets reject",async()=>{
 const d=envSql(),r=await onRequestGet({request:request("league=fra.1&mode=raw&limit=5000"),env:d.env});
 assert.equal((await r.json()).limit,40);
 assert.match(d.calls[0].sql,/SELECT \* FROM soccer_pitchapi_match_features/);
 const bad=await onRequestGet({request:request("league=ger.1&mode=model&offset=-1"),env:d.env});
 assert.equal(bad.status,400);
 const denied=await onRequestGet({request:new Request("https://example.test/api/soccer-pitchapi-export?league=ger.1"),env:d.env});
 assert.equal(denied.status,401);
});
