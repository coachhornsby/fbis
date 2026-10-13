import test from "node:test";
import assert from "node:assert/strict";
import {classifyBaseballPeriod,parseBaseballPeriods,auditPinnoddsMlbPeriods} from "../workers/pinnodds-mlb-period-audit.mjs";
test("first-half is F5, but Half 3 MUST NOT be mislabeled F3",()=>{
 assert.equal(classifyBaseballPeriod(1,"Half 1"),"F5_BY_FIRST_HALF_RULE");
 assert.equal(classifyBaseballPeriod(1,"1st Half"),"F5_BY_FIRST_HALF_RULE");
 assert.equal(classifyBaseballPeriod(3,"Half 3"),"UNVERIFIED_PERIOD");
 assert.equal(classifyBaseballPeriod(3,"First 3 Innings"),"F3_CONFIRMED_LABEL");
 assert.equal(classifyBaseballPeriod(0,"Game"),"FULL_GAME");
});
test("period extracts actual F5 paired prices, separate run line/total, open flags, unpriced F3",()=>{
 const e={periods:{
  num_0:{number:0,description:"Game",money_line:{home:1.88,away:2.06}},
  num_1:{number:1,description:"Half 1",money_line:{home:1.91,away:1.91},spreads:{"-0.5":{hdp:-0.5,home:1.97,away:1.84,max:120}},
   totals:{"4.5":{points:4.5,over:2.01,under:1.82,max:110}},meta:{open_money_line:true,open_totals:true}},
  num_3:{number:3,description:"Half 3",money_line:{},spreads:{},totals:{},meta:{open_money_line:false}}
 }};
 const p=parseBaseballPeriods(e);assert.equal(p.length,3);
 assert.equal(p[1].classification,"F5_BY_FIRST_HALF_RULE");
 assert.equal(p[1].quoted.moneyline,true);
 assert.equal(p[1].quoted.runLines,1);
 assert.equal(p[1].quoted.totals,1);
 assert.equal(p[1].totals[0].line,4.5);
 assert.equal(p[1].spreads[0].maxRisk,120);
 assert.equal(p[1].executableVerified,false);
 assert.equal(p[2].classification,"UNVERIFIED_PERIOD");
 assert.equal(p[2].quoteStatus,"NO_PAIRED_PRICES");
});
test("one full baseball fixture snapshot and 3 limited detail requests, no secret logging or trading",async()=>{
 const key="mock-key-private",calls=[];
 const fixture=(id)=>({event_id:id,league_name:"MLB",home:"Home"+id,away:"Away"+id,
  starts:"2026-10-13T22:00:00Z",periods:{num_0:{number:0,description:"Game"},
  num_1:{number:1,description:"1st Half"}}});
 const fetchImpl=async(url,init)=>{
  calls.push({url,method:init.method,key:init.headers["x-portal-apikey"]});
  let body;
  if(url.includes("fixtures"))body={events:[fixture(1),fixture(2),fixture(3),fixture(4),
   {event_id:8,league_name:"NPB",home:"Other",away:"Other"}]};
  else {
    const id=Number(new URL(url).searchParams.get("event_id"));
    body={events:[{...fixture(id),periods:{num_0:{description:"Game",money_line:{home:1.8,away:2}},
      num_1:{description:"Half 1",money_line:{home:1.9,away:1.9},totals:{"4.5":{points:4.5,over:1.8,under:2.1}}},
      num_3:{description:"Half 3"}}}]};
  }
  return {ok:true,status:200,headers:new Headers({"x-data-status":"fresh"}),json:async()=>body};
 };
 const result=await auditPinnoddsMlbPeriods({apiKey:key,fetchImpl});
 assert.equal(result.ok,true);
 assert.equal(result.requestsMade,4);
 assert.equal(result.requestedEvents,3);
 assert.equal(result.f5PeriodCount,3);
 assert.equal(result.f3ExplicitlyLabeledCount,0);
 assert.deepEqual(result.priced.F5,{moneyline:3,runLines:0,totals:3});
 assert.equal(result.unknownPeriodCount,3);
 assert.equal(result.canAuthorizeWager,false);
 assert.equal(JSON.stringify(result).includes(key),false);
 assert.ok(calls.every(x=>x.method==="GET"));
});
test("429 never causes extra quota calls",async()=>{
 let n=0;
 const res=await auditPinnoddsMlbPeriods({apiKey:"test",fetchImpl:async()=>{n++;return {ok:false,status:429,headers:new Headers()}}});
 assert.equal(res.ok,false);assert.equal(n,1);
});
