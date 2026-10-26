import test from "node:test";
import assert from "node:assert/strict";
import {csvGames,matchEvent,outcome,collect} from "../scripts/cfb-game-evidence-archive.mjs";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const game={id:"123",season:"2026",week:"9",home_team:"Kent State",away_team:"Sacramento State",start_date:"2026-10-31 02:30:00"};
const event={id:"999",date:"2026-10-31T02:30:00Z",status:{type:{completed:true}},competitions:[{competitors:[
 {homeAway:"home",team:{displayName:"Kent State"},score:"24"},
 {homeAway:"away",team:{displayName:"Sacramento State"},score:"17"}]}]};
test("match requires unambiguous oriented teams and reasonable kickoff",()=>{
 assert.equal(matchEvent(game,[event])?.id,"999");
 assert.equal(matchEvent(game,[event,event]),null);
 assert.equal(matchEvent({...game,home_team:"Other"},[event]),null);
});
test("secondary results never constitute official results or complete plays",()=>{
 const x=outcome(event,{drives:{previous:[{plays:[{id:"p1"}]}]}});
 assert.equal(x.finalReported,true);assert.equal(x.homeScore,24);
 assert.equal(x.officialVerified,false);assert.equal(x.pbpComplete,false);
});
test("csv pregame rows preserve identity and reject duplicate ids",()=>{
 const csv="id,start_date,season,week,home_team,away_team\n123,2026-10-31 02:30:00,2026,9,Kent State,Sacramento State";
 assert.equal(csvGames(csv).length,1);
 assert.throws(()=>csvGames(csv+"\n"+csv.split("\n")[1]),/DUPLICATE/);
});
test("archive writes fail-closed receipts with no fabricated official score",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"cfb-archive-"));
 const fetcher=async url=>({ok:true,json:async()=>url.includes("scoreboard")?{events:[event]}:{drives:{previous:[]}}});
 try{
 const result=await collect([game],{outDir:dir,fetcher});
 assert.equal(result[0].reportedFinal,true);
 assert.equal(result[0].officialFinalVerified,false);
 assert.equal(result[0].modelGradeEligible,false);
 assert.equal(JSON.parse(readFileSync(join(dir,"manifest.json"),"utf8")).officialVerified,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
