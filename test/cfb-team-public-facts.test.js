import test from "node:test";
import assert from "node:assert/strict";
import {parseCfbTeamSchedule,parseCfbApRanking,loadCfbPublicTeamFacts} from "../functions/lib/cfbTeamPublicFacts.js";
const team="275";
const event=(id,completed,home=true,neutral=false)=>({
 id:String(id),date:"2026-10-10T19:30:00Z",week:{number:7},
 status:{type:{name:completed?"STATUS_FINAL":"STATUS_SCHEDULED",completed}},
 competitions:[{neutralSite:neutral,competitors:[
 {team:{id:home?team:"10",displayName:home?"Wisconsin Badgers":"Opponent",abbreviation:home?"WIS":"OPP"},homeAway:"home",score:completed?"24":undefined},
 {team:{id:home?"10":team,displayName:home?"Opponent":"Wisconsin Badgers",abbreviation:home?"OPP":"WIS"},homeAway:"away",score:completed?"17":undefined}
 ]}]
});
test("Wisconsin official final scores and W/L are derived from team ID, not display name",()=>{
 const games=parseCfbTeamSchedule({season:{year:2026},events:[event(1,true,true),event(2,true,false),event(3,false)]},team,2026);
 assert.equal(games.length,3);assert.deepEqual(games.map(x=>x.result),["W","L",null]);
 assert.deepEqual(games.map(x=>x.pointsFor),[24,17,null]);
 assert.deepEqual(games.map(x=>x.location),["HOME","AWAY","HOME"]);
 assert.equal(games[2].verifiedResult,false);
});
test("Non-final numeric scores cannot generate a result; neutral venue, unrelated team and duplicate IDs",()=>{
 const pending=event(2,false,true,true);pending.competitions[0].competitors[0].score="30";
 const games=parseCfbTeamSchedule({events:[event(1,true),event(1,true),pending,event(3,true)]},team,2026);
 assert.equal(games.length,3);assert.equal(games[1].location,"NEUTRAL");assert.equal(games[1].result,null);
 assert.equal(parseCfbTeamSchedule({events:[event(1,true)]},"999",2026).length,0);
});
test("AP ranking is specifically AP, never coaches or FBIS, with unranked explicit",()=>{
 const polls={rankings:[{type:"coaches",ranks:[{team:{id:team},current:1}]},
 {type:"ap",occurrence:{number:7},ranks:[{team:{id:team},current:16}]}],latestWeek:{startDate:"2026-10-11"}};
 assert.equal(parseCfbApRanking(polls,team,2026).rank,16);
 assert.equal(parseCfbApRanking(polls,"999",2026).rank,null);
 assert.equal(parseCfbApRanking({rankings:[]},team,2026).state,"POLL_UNAVAILABLE");
});
test("Provider errors do not present saved/guessed results or rank as current",async()=>{
 const fake=async()=>({ok:false,status:503});
 const result=await loadCfbPublicTeamFacts(team,2026,fake);
 assert.equal(result.schedule.state,"SOURCE_UNAVAILABLE");assert.equal(result.schedule.count,0);
 assert.equal(result.apRanking.rank,null);assert.equal(result.apRanking.state,"SOURCE_UNAVAILABLE");
});

test("ESPN object scores from completed games create final W/L",()=>{
 const fixture=event(22,true,true);
 fixture.competitions[0].competitors[0].score={value:31,displayValue:"31"};
 fixture.competitions[0].competitors[1].score={value:24,displayValue:"24"};
 const result=parseCfbTeamSchedule({events:[fixture]},team,2026)[0];
 assert.equal(result.completed,true);assert.equal(result.pointsFor,31);
 assert.equal(result.pointsAgainst,24);assert.equal(result.result,"W");
 assert.equal(result.verifiedResult,true);
});
