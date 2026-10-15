import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {chicagoDate,cfbDailyFinals,cfbDailyWeeks,cfbDailyBoxRows}
 from "../functions/lib/cfbDailyPostgame.js";

const game=(id,patch={})=>({
 id,season:2026,week:7,seasonType:"regular",
 startDate:"2026-10-11T04:30:00Z", // Sat Oct 10, 11:30pm Central
 completed:true,homeClassification:"fbs",awayClassification:"fbs",
 homePoints:27,awayPoints:24,...patch
});
test("date selector uses Chicago kickoff, final status and two scored FBS teams",()=>{
 assert.equal(chicagoDate("2026-10-11T04:30:00Z"),"2026-10-10");
 const data=[
  game(100),game(101,{startDate:"2026-10-11T07:00:00Z"}),
  game(102,{completed:false}),game(103,{awayPoints:null}),
  game(104,{awayClassification:"fcs"}),
  game(105,{homeClassification:"fcs"}),
  game(106,{id:"not-canonical"}),
 ];
 const finals=cfbDailyFinals(data,"2026-10-10");
 assert.deepEqual(finals.map(g=>g.id),[100]);
 assert.deepEqual(cfbDailyFinals(data,"2026-10-11").map(g=>g.id),[101]);
});
test("weekly boxscores use max two bounded batches, exact prior-day event IDs",()=>{
 const finals=[game(100),game(101,{week:8}),game(102,{week:8})];
 assert.deepEqual(cfbDailyWeeks(finals,2026),[
  {year:2026,week:7,seasonType:"regular",classification:"fbs"},
  {year:2026,week:8,seasonType:"regular",classification:"fbs"}
 ]);
 const rows=[
  {id:100,teams:[{team:"Home"},{team:"Away"}]},
  {id:100,teams:[{team:"Home"},{team:"Away"}]},
  {id:200,teams:[{team:"Other"},{team:"Other"}]},
  {id:101,teams:[{team:"Only one"}]},
  {id:102,teams:[{team:"Home"},{team:"Away"}]},
 ];
 assert.deepEqual(cfbDailyBoxRows(rows,finals).map(r=>r.id),[100,102]);
 assert.deepEqual(cfbDailyWeeks([],2026),[]);
});
test("only one scheduled CFBD CFB job; general harvest never fires paid CFBD calls",()=>{
 const college=readFileSync(new URL("../.github/workflows/college.yml",import.meta.url),"utf8");
 const schedule=college.slice(college.indexOf('elif [ "$EVENT_NAME" = "schedule" ]'),college.indexOf('else\n            call "$JOB"'));
 assert.equal((schedule.match(/call cfb-postgame-harvest/g)||[]).length,1);
 assert.doesNotMatch(schedule,/call cfb-current-refresh|call cfb-pregame-freeze/);
 const collector=readFileSync(new URL("../functions/lib/projLedger.js",import.meta.url),"utf8");
 assert.match(collector,/cfbdCacheOnly:true/);
 assert.match(collector,/preferCfbd: false/);
 const source=readFileSync(new URL("../functions/lib/collegeJobsCore.js",import.meta.url),"utf8");
 assert.match(source,/archiveFullPayload:true/);
 assert.match(source,/cfbDailyFinals\(res.data,date\)/);
 assert.match(source,/cfbDailyBoxRows\(box.data,finals\)/);
});
