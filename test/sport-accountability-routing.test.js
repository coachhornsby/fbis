import test from "node:test";
import assert from "node:assert/strict";
import { readAccountabilitySnapshots } from "../functions/api/simulation-intelligence.js";

test("all-sport scoreboard queries every sport through its own canonical D1 route",async()=>{
 const called=[];
 const read=async (_env,{sport,since,until})=>{
  called.push([sport,since,until]);
  return {ok:true,rows:[{sport,gameId:"game"}]};
 };
 const result=await readAccountabilitySnapshots({},{
   sport:"all",since:"2026-10-01",until:"2026-10-21",
 },read);
 assert.equal(result.rows.length,11);
 assert.equal(result.failedSports.length,0);
 assert.equal(new Set(called.map(x=>x[0])).size,11);
 assert.ok(called.every(x=>x[1]==="2026-10-01"));
});
test("a degraded sport is explicitly returned without hiding healthy siblings",async()=>{
 const result=await readAccountabilitySnapshots({},{
   sport:"all",since:"2026-10-01",until:"2026-10-21",
 },async(_env,{sport})=>sport==="nfl"?{ok:false,reason:"DB_UNBOUND",rows:[]}:{ok:true,rows:[{sport}]});
 assert.equal(result.rows.length,10);
 assert.deepEqual(result.failedSports,["nfl"]);
});
test("sport-scoped requests do not fan out",async()=>{
 const called=[];
 const result=await readAccountabilitySnapshots({},{
   sport:"tennis",since:"2026-10-01",until:"2026-10-21",
 },async(_env,{sport})=>{called.push(sport);return {ok:true,rows:[]}});
 assert.deepEqual(called,["tennis"]);
 assert.deepEqual(result.failedSports,[]);
});
