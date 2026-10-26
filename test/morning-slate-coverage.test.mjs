import test from "node:test";
import assert from "node:assert/strict";
import {chicagoDate,utcStamp,missingScheduledIds,checkCoverage,ENABLED_SPORTS,scheduleEventMatches,normalizedScheduleTeam} from "../scripts/morning-slate-coverage.mjs";

test("Chicago game date follows DST and UTC midnight boundaries",()=>{
  assert.equal(chicagoDate("2026-10-13T00:15:00Z"),"2026-10-12");
  assert.equal(chicagoDate("2026-11-02T01:00:00Z"),"2026-11-01");
  assert.equal(chicagoDate("nonsense"),null);
  assert.equal(utcStamp("2026-10-12",-1),"20261011");
  assert.equal(utcStamp("2026-10-12",1),"20261013");
});
test("missing ESPN scheduled games are fail-closed, not mistaken for model passes",()=>{
  const schedule=[{id:"1"},{id:"2"}];
  const b=[{id:"1",projection:{independent:true}}];
  const c=checkCoverage("nhl",b,schedule);
  assert.deepEqual(c.missingEventIds,["2"]);
  assert.equal(c.state,"INCOMPLETE");
  assert.equal(c.independentModels,1);
});
test("known games with unavailable projections remain tracked but unmodeled",()=>{
  const board=[{id:"1",projection:{independent:false}},{id:"2"}];
  const c=checkCoverage("nba",board,[{id:"1"},{id:"2"}]);
  assert.equal(c.state,"DEGRADED");
  assert.equal(c.unavailableModels,2);
  assert.equal(c.independentModels,0);
});
test("zero unsupported-sport games must not be labeled verified no slate",()=>{
  const c=checkCoverage("soccer",[],null);
  assert.equal(c.state,"BOARD_ONLY");
  assert.equal(c.sourceStatus,"SOURCE_UNVERIFIED");
  assert.equal(c.expectedGames,null);
});
test("duplicate provider event ids are flagged",()=>{
  const board=[{id:"7",projection:{independent:true}},{id:"7",projection:{independent:true}}];
  assert.deepEqual(checkCoverage("mlb",board,[{id:"7"}]).duplicateIds,["7"]);
  assert.deepEqual(missingScheduledIds([{id:"7"},{id:"8"},{id:"8"}],board),["8"]);
});
test("enabled sports include every scheduled export league",()=>{
  assert.equal(new Set(ENABLED_SPORTS).size,7);
  for(const sport of ["mlb","nfl","nhl","nba","tennis","cfb","cbb"]){
    assert.ok(ENABLED_SPORTS.includes(sport));
  }
});

test("ESPN MLB IDs match MLB Stats IDs by teams and kickoff, not provider identifiers",()=>{
  const espn={id:"401908023",away:"CLE",home:"TB",start:"2026-10-13T00:00:00Z"};
  const game={id:"849820",away:{abbr:"CLE"},home:{abbr:"TBR"},start:"2026-10-13T00:00:00Z"};
  assert.ok(scheduleEventMatches(espn,game,"mlb"));
  assert.deepEqual(missingScheduledIds([espn],[game],"mlb"),[]);
  assert.equal(normalizedScheduleTeam("TB","mlb"),"TBR");
  assert.equal(scheduleEventMatches({...espn,away:"NYY"},game,"mlb"),false);
  assert.equal(scheduleEventMatches({...espn,start:"2026-10-12T20:00:00Z"},game,"mlb"),false);
  assert.equal(scheduleEventMatches(espn,game,"nfl"),false);
});


test('seven-day guard does not label unsupported or empty schedules healthy',async()=>{
 const {auditSevenDaySlate}=await import('../scripts/morning-slate-coverage.mjs');
 const dates=[];
 const report=await auditSevenDaySlate({date:'2026-10-26',audit:async opts=>{
  dates.push(opts.date);assert.equal(opts.recovery,false);
  return {ok:true,date:opts.date,detail:[{sport:'tennis',sourceStatus:'SOURCE_UNVERIFIED'}],errors:[]};
 }});
 assert.equal(report.ok,false);assert.equal(report.unverified.length,7);
 assert.deepEqual(dates.sort(),['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
});


test("same event ID does not hide a changed kickoff or reversed sides",()=>{
 const scheduled=[{id:"1",home:"HOU",away:"DAL",start:"2026-10-26T20:00:00Z"}];
 const board=[{id:"1",home:{abbr:"DAL"},away:{abbr:"HOU"},start:"2026-10-26T21:00:00Z",projection:{independent:true}}];
 const report=checkCoverage("nfl",board,scheduled);
 assert.equal(report.state,"INCOMPLETE");
 assert.deepEqual(report.scheduleMismatches,[{eventId:"1",reasons:["HOME_TEAM_MISMATCH","AWAY_TEAM_MISMATCH","START_TIME_MISMATCH"]}]);
});
test("projection rejection reasons survive coverage reporting for every active sport",()=>{
 for(const sport of ENABLED_SPORTS){
  const report=checkCoverage(sport,[{id:"1",projection:{independent:false,reason:"FROZEN_RECEIPT_MISSING"}}],[{id:"1"}]);
  assert.equal(report.state,"DEGRADED");
  assert.deepEqual(report.missingProjectionEvents,[{eventId:"1",reason:"FROZEN_RECEIPT_MISSING"}]);
 }
 assert.equal(scheduleEventMatches({}, {}, "nfl"),false);
});


test("public projection and recovery endpoints accept the full seven-day horizon",async()=>{
 const {readFile}=await import("node:fs/promises");
 for(const file of ["functions/api/projections.js","functions/api/slate.js"]){
  const source=await readFile(new URL("../"+file,import.meta.url),"utf8");
  assert.match(source,/maxPast: 2, maxFuture: 7/);
 }
 const {resolveSlateDate,todayCT,shiftDateCT}=await import("../functions/lib/slateEngine.js");
 for(let i=0;i<7;i++)assert.equal(resolveSlateDate(shiftDateCT(todayCT(),i),{maxPast:2,maxFuture:7}).ok,true);
});

test('verified league aliases do not create false team reversals',()=>{
 for(const sport of ['nba','nfl']){
  const r=checkCoverage(sport,[{id:'1',home:{abbr:'WAS'},away:{abbr:'PHI'},projection:{independent:true}}],[{id:'1',home:'WSH',away:'PHI'}]);
  assert.equal(r.state,'COMPLETE');
 }
 assert.equal(normalizedScheduleTeam('JXST','cfb'),'JVST');
 assert.equal(normalizedScheduleTeam('JXST','nba'),'JXST');
});
