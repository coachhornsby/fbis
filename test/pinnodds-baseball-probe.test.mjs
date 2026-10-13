import test from "node:test";
import assert from "node:assert/strict";
import {classifyBaseballLeague,probePinnoddsBaseball} from "../workers/pinnodds-baseball-probe.mjs";

const headers=new Headers({"x-data-status":"fresh","x-data-age-ms":"101"});
const ok=body=>({ok:true,status:200,headers,json:async()=>body});
test("league categorization covers MLB, NPB, KBO and other baseball",()=>{
 for(const [name,exp] of [
  ["USA - MLB","MLB"],["Japan - NPB","NPB"],["South Korea - KBO","KBO"],
  ["USA - Minor League Baseball","MiLB"],["Mexico - LMB","OTHER_BASEBALL"]]){
  assert.equal(classifyBaseballLeague(name),exp);
 }
});
test("exactly two GETs with special markets, no secret in result and no authority",async()=>{
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,method:opts.method,key:opts.headers["x-portal-apikey"]});
  return ok({sport_id:6,events:[
   {event_id:1,league_name:"USA - MLB",home:"Dodgers",away:"Mets",starts:"2026-10-13T22:00:00Z",
    home_pitcher:"Pitcher A",periods:{num_0:{description:"Game",money_line:{home:1.8,away:2.1},
      spreads:{"-1.5":{hdp:-1.5,home:2.2,away:1.7,max:100}},totals:{"8.5":{points:8.5,over:1.93,under:1.92,max:300}}}}},
   {event_id:2,league_name:"USA - MLB",parent_id:1,special:"Pitcher A Strikeouts",
    special_category:"Player Props",special_units:"Strikeouts",special_markets:{num_0:[{
     type:"totals",max_risk:90,prices:[{name:"Over",participant_id:987,points:5.5,price:1.9},{name:"Under",points:5.5,price:1.93}]}]}},
   {event_id:3,league_name:"Japan - NPB",home:"Hawks",away:"Tigers",starts:"2026-10-13T09:00:00Z",periods:{num_0:{money_line:{home:1.9,away:1.9}}}},
   {event_id:4,league_name:"South Korea - KBO",home:"LG",away:"Doosan",periods:{num_0:{money_line:{home:1.5,away:2.4}}}}
  ]});
 };
 const result=await probePinnoddsBaseball({apiKey:"synthetic-private-key",fetchImpl});
 assert.equal(result.ok,true);
 assert.equal(result.requestsMade,2);
 assert.ok(calls.every(x=>x.method==="GET"&&x.url.includes("sport_id=6&include_specials=1")||x.url.includes("sport_id=6&event_type=live&include_specials=1")));
 assert.equal(result.results[0].leagueBreakdown.MLB.playerProps,1);
 const mlb=result.results[0].leagues.find(l=>l.scope==="MLB");
 assert.deepEqual(mlb.propStatKinds,[{kind:"STRIKEOUTS",count:1}]);
 assert.equal(mlb.pricedPlayerProps,1);
 assert.deepEqual(mlb.propUnits,[{unit:"Strikeouts",count:1}]);
 assert.equal(result.results[0].leagueBreakdown.NPB.events,1);
 assert.equal(result.results[0].leagueBreakdown.KBO.events,1);
 assert.equal(result.results[0].samplePlayerProps[0].sampleOutcomes[0].points,5.5);
 assert.equal(result.results[0].leagues.find(l=>l.scope==="MLB").starterFields[0],"home_pitcher");
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(JSON.stringify(result).includes("synthetic-private-key"),false);
});
test("403 and 429 fail closed immediately to preserve quota",async()=>{
 for(const status of [403,429]){
  let n=0;
  const result=await probePinnoddsBaseball({apiKey:"dummy",fetchImpl:async()=>{n++;return{ok:false,status,headers:new Headers()}}});
  assert.equal(n,1);
  assert.equal(result.ok,false);
  assert.equal(result.results[0].reason,status===429?"RATE_LIMITED":"AUTH_OR_PLAN_DENIED");
 }
});
test("missing credential makes no upstream requests",async()=>{
 const r=await probePinnoddsBaseball({fetchImpl:async()=>{throw Error("should not call")}});
 assert.equal(r.requestsMade,0);
 assert.equal(r.ok,false);
});
