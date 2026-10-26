import test from "node:test";
import assert from "node:assert/strict";
import {
 evaluateNflPersonnelResearch,loadNflPersonnelSlate,NFL_PERSONNEL_MODEL
} from "../functions/lib/nflPersonnelChallenger.js";
import {onRequestGet as getRankings} from "../functions/api/football-simulation-rankings.js";
import {onRequestGet as getPersonnel,onRequestPost as postPersonnel} from "../functions/api/nfl-personnel-research.js";

const hour=3600000;
function roster(team,countOut=0,now="2026-10-26T12:00:00Z"){
 const before=new Date(Date.parse(now)-hour).toISOString();
 const out=[];
 for(let i=0;i<6;i++)out.push({
  player_key:team+"_wr"+i,player_name:team+" WR "+i,team_key:team,
  position:"WR",depth_rank:i+1,last_known_snap_share:[.92,.83,.73,.60,.49,.25][i],
  health_state:i<countOut?"OUT":"AVAILABLE",
  state_source:"nfl-official",state_source_updated_at:before,updated_at:before,carried_state:0
 });
 for(let i=0;i<10;i++)out.push({
  player_key:team+"_p"+i,player_name:team+" player "+i,team_key:team,
  position:i===0?"QB":"LB",depth_rank:i+1,last_known_snap_share:.7,
  health_state:"AVAILABLE",state_source:"espn",state_source_updated_at:before,updated_at:before,carried_state:0
 });
 return out;
}
function base(overrides={}){
 return {
  gameId:"401000001",kickoff:"2026-10-27T20:00:00Z",
  capturedAt:"2026-10-26T12:00:00Z",baselineFrozenAt:"2026-10-26T10:00:00Z",
  baselineSnapshotId:"frozen-v12",projectedHome:26,projectedAway:24,
  homePlayers:roster("sf",5),awayPlayers:roster("atl",0),...overrides,
 };
}
test("five missing top receivers trigger independent WR-unit interaction with QB healthy",()=>{
 const p=evaluateNflPersonnelResearch(base());
 assert.equal(p.ok,true);
 assert.equal(p.modelId,NFL_PERSONNEL_MODEL);
 assert.equal(p.home.absentTop5,5);
 assert.equal(p.home.severeWrLoss,true);
 assert.ok(p.home.offensePenalty>=4);
 assert.equal(p.home.absences.filter(x=>x.position==="QB").length,0);
 assert.equal(p.researchEligible,true);
 assert.ok(p.adjusted.home<p.baseline.home);
 assert.ok(p.adjusted.margin<p.baseline.margin);
 assert.equal(p.baseline.home,26);
 assert.equal(p.canAuthorizeWager,false);
 assert.equal(p.changesProductionChampion,false);
 assert.equal(p.provenance.marketUsed,false);
});
test("only verified, fresh pregame injury status may reduce a projection",()=>{
 const p=roster("sf",5);
 p[0].state_source_updated_at="2026-10-28T12:00:00Z"; // future, must never be used
 const r=evaluateNflPersonnelResearch(base({homePlayers:p}));
 assert.equal(r.home.unverifiedOut,1);
 assert.equal(r.home.wrCovered,false);
 assert.equal(r.researchEligible,false);
 assert.equal(r.adjusted,null);
 assert.ok(r.warnings.includes("HOME_PERSONNEL_COVERAGE_INCOMPLETE"));
});
test("unverified or absent personnel data fails closed; no false injury-neutral forecast",()=>{
 const r=evaluateNflPersonnelResearch(base({homePlayers:[],awayPlayers:[]}));
 assert.equal(r.ok,true);
 assert.equal(r.researchEligible,false);
 assert.equal(r.adjusted,null);
 assert.ok(r.warnings.length>=2);
});
test("future source, post-kickoff captures, post-freeze leakage rejected",()=>{
 assert.equal(evaluateNflPersonnelResearch(base({capturedAt:"2026-10-28T01:00:00Z"})).ok,false);
 assert.equal(evaluateNflPersonnelResearch(base({baselineFrozenAt:"2026-10-26T13:00:00Z"})).ok,false);
});
test("questionable starting WR remains unresolved instead of treated as OUT",()=>{
 const x=roster("sf",0);x[0].health_state="QUESTIONABLE";
 const r=evaluateNflPersonnelResearch(base({homePlayers:x}));
 assert.equal(r.home.absentTop5,0);
 assert.equal(r.home.criticalUnresolved,true);
 assert.ok(r.warnings.includes("CRITICAL_LINEUP_UNRESOLVED"));
 assert.equal(r.home.offensePenalty,0);
});
test("sport DB is the only approved store for personnel and does not need PRIMARY",async()=>{
 const data=[...roster("sf",4),...roster("atl")];
 const db={prepare(sql){
  assert.match(sql,/FROM nfl_player_profiles/);
  return {bind(...keys){assert.deepEqual(keys.sort(),["atl","sf"]);
   return {all:async()=>({results:data})}}};
 }};
 const result=await loadNflPersonnelSlate(db,[{
  gameId:"401000001",kickoff:"2026-10-27T20:00:00Z",homeAbbr:"SF",awayAbbr:"ATL",
  sourceFrozenAt:"2026-10-26T10:00:00Z",projectedHome:26,projectedAway:24,
 }],"2026-10-26T12:00:00Z");
 assert.equal(result.size,1);
 assert.equal(result.get("401000001").home.severeWrLoss,true);
 await assert.rejects(loadNflPersonnelSlate(null,[{gameId:"x"}]),/NFL_DB_UNBOUND/);
});
test("public ranking preserves frozen NFL score while secondary 1,000-path research estimate moves",async()=>{
 const now=Date.now(),iso=ms=>new Date(ms).toISOString();
 const data=[...roster("sf",5,iso(now)),...roster("atl",0,iso(now))];
 const db={prepare(sql){
  if(sql.includes("prediction_snapshots"))return {bind(){return {all:async()=>({results:[{
   gameId:"401000001",snapshotId:"v12-1",kickoff:iso(now+24*hour),
   home:"49ers",homeAbbr:"SF",away:"Falcons",awayAbbr:"ATL",
   sourceFrozenAt:iso(now-2*hour),baselineVersion:"v1.2",
   projectedHome:26,projectedAway:24,
  }]})}}};
  if(sql.includes("nfl_player_profiles"))return {bind(){return{all:async()=>({results:data})}}};
  throw Error("UNAUTHORIZED_TABLE_READ");
 }};
 const response=await getRankings({request:new Request("https://fbis.test/api/football-simulation-rankings?sport=nfl"),env:{NFL_DB:db}});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.results.length,1);
 const card=body.results[0];
 assert.equal(card.source,"NFL_DB");
 assert.equal(card.modelVersion,"NFL-DRIVE-MC-SHADOW-v1");
 assert.equal(card.iterations,5000);
 assert.equal(card.personnelChallenger.modelId,NFL_PERSONNEL_MODEL);
 assert.equal(card.personnelChallenger.simulation.iterations,1000);
 assert.ok(card.personnelChallenger.adjusted.home<26);
 assert.equal(card.canAuthorizeWager,false);
 assert.equal(body.canAuthorizeWager,false);
});
test("prospective write requires operator credential; summary reports unvalidated",async()=>{
 const req=new Request("https://fbis.test/api/nfl-personnel-research?mode=capture",{method:"POST"});
 const rejected=await postPersonnel({request:req,env:{NFL_DB:{prepare(){throw Error("MUST_NOT_WRITE")}},HARVEST_SECRET:"private"}});
 assert.equal(rejected.status,403);
 const summary=await getPersonnel({request:new Request("https://fbis.test/api/nfl-personnel-research?mode=summary"),env:{
  NFL_DB:{prepare(){return {all:async()=>({results:[]})}}}
 }});
 assert.equal(summary.status,200);
 const report=await summary.json();
 assert.equal(report.all.n,0);
 assert.equal(report.all.baselineMarginMAE,null);
 assert.equal(report.canAuthorizeWager,false);
});

test("fresh roster presence permits an explicitly provisional lineup without claiming official active status",()=>{
 const a=roster("dal",0),b=roster("phi",0);
 for(const p of [...a,...b]){p.state_source="roster-presence";p.health_state="AVAILABLE";}
 const input=base({homePlayers:a,awayPlayers:b});
 const r=evaluateNflPersonnelResearch(input);
 assert.equal(r.researchEligible,true);
 assert.equal(r.adjusted.margin,r.baseline.margin);
 assert.equal(r.home.verifiedRows,0);
 assert.ok(r.home.expectedRosterRows>0);
 assert.ok(r.warnings.includes("EXPECTED_ROSTER_NOT_GAME_DAY_CONFIRMED"));
 assert.equal(r.canAuthorizeWager,false);
 assert.equal(r.projectionsProvisional,true);
});
test("a roster-presence OUT never creates a fake confirmed absence; verified OUT does",()=>{
 const a=roster("dal",0),b=roster("phi",0);
 for(const p of [...a,...b])p.state_source="roster-presence";
 a[0].health_state="OUT"; // a stale or synthetic roster OUT cannot trigger scoring
 const none=evaluateNflPersonnelResearch(base({homePlayers:a,awayPlayers:b}));
 assert.equal(none.researchEligible,false); // top-depth unverified absent forces no numerical output
 assert.equal(none.adjusted,null);
 assert.equal(none.home.unverifiedOut,1);
 // A report-backed WR injury is counted and the remaining expected roster is provisional.
 const confirm=roster("dal",0);
 for(const p of confirm)p.state_source="roster-presence";
 confirm[0].health_state="OUT";
 confirm[0].state_source="nfl-official";
 const positive=evaluateNflPersonnelResearch(base({homePlayers:confirm,awayPlayers:b}));
 assert.equal(positive.researchEligible,true);
 assert.equal(positive.home.absentTop5,1);
 assert.ok(positive.adjusted.home<positive.baseline.home);
 assert.ok(positive.warnings.includes("EXPECTED_ROSTER_NOT_GAME_DAY_CONFIRMED"));
});
