import test from "node:test";
import assert from "node:assert/strict";
import {refreshAtpPlayerResearch} from "../functions/lib/tennisAtpRankingsRefresh.js";

const rows=Array.from({length:25},(_,i)=>({current:i+1,points:2500-i*10,athlete:{
 id:String(i+1000),displayName:"Test Player "+i,citizenshipCountry:i===0?"ARG":"USA"
}}));
const feed=async url=>({ok:true,json:async()=>({rankings:[{ranks:url.includes("/atp/")?rows:[]}]})});
function db(){
 const commands=[],batches=[];
 return {commands,batches,
  prepare(sql){return {bind(...args){
   if(sql.includes("SELECT fbis_player_id,normalized_name"))return {async all(){return {results:args.map(name=>({
    fbis_player_id:"tennis:atp:research:"+name,normalized_name:name,official_source:"FBIS_SUPPLEMENTAL_RESEARCH"
   }))}}};
   return {sql,args};
  }}},
  async batch(batch){batches.push(batch);commands.push(...batch);return batch.map(()=>({success:true}));},
 };
}
test("ATP source list persists canonical research fields, history observations and provenance",async()=>{
 const database=db();const saved=[];
 const receipt=await refreshAtpPlayerResearch(database,{put:async(k,v)=>saved.push({key:k,value:JSON.parse(v)})},{
  now:new Date("2026-10-20T16:30:00Z"),fetchImpl:feed,
 });
 assert.equal(receipt.feedCount,25);
 assert.equal(receipt.canonicalUpdated,25);
 assert.equal(receipt.officialSourcePromoted,false);
 assert.equal(database.commands.length,50);
 assert.equal(database.commands.filter(c=>c.sql.includes("INSERT OR IGNORE")).length,25);
 assert.equal(database.commands.filter(c=>c.sql.includes("UPDATE tennis_players")).length,25);
 assert.equal(database.commands.find(c=>c.sql.includes("UPDATE tennis_players")).args[2],"AR");
 assert.match(database.commands[0].args[10],/observation_date_not_official_effective_date/);
 assert.equal(saved.length,1);
 assert.equal(saved[0].value.players.length,25);
});
test("empty ATP source never erases existing player records",async()=>{
 const database=db();
 await assert.rejects(refreshAtpPlayerResearch(database,null,{
  fetchImpl:async()=>({ok:true,json:async()=>({rankings:[]})})
 }),/ATP_RANKINGS_SOURCE_INSUFFICIENT/);
 assert.equal(database.commands.length,0);
});
