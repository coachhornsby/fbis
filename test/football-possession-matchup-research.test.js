import test from "node:test";
import assert from "node:assert/strict";
import {
 normalizeVerifiedNflPossessions,selectMatchupDriveHistory,simulateMatchupDriveShadow
} from "../functions/lib/footballPossessionMatchupResearch.js";
import {runCfbMatchupResearchFromVerifiedDb} from "../functions/lib/cfbDriveMatchupResearch.js";
const now="2026-10-23T17:00:00Z",kickoff="2026-10-30T17:00:00Z";
function historicalGame(i,sport="cfb"){
 const homeTeamId="TEAM_A",awayTeamId="TEAM_B";
 const drives=Array.from({length:20},(_,n)=>({
  driveId:"d"+i+"_"+n,seq:n+1,offense:n%2?"away":"home",
  period:Math.min(4,1+Math.floor(n/5)),plays:5,startYardsToGoal:75,
  startMargin:0,offensePoints:n%5===0?7:n%5===1?3:0,defensePoints:0
 }));
 return {gameId:"old"+i,homeTeamId,awayTeamId,kickoff:"2026-09-01T16:00:00Z",
  gradedAt:"2026-09-01T20:00:00Z",observedAt:"2026-09-02T05:00:00Z",
  source:sport==="cfb"?"CFBD_DRIVES":"NFL_PBP_VERIFIED_POSSESSIONS",
  sourceFingerprint:("f"+i).padEnd(64,"a"),drives,regulationOnly:true,
  officialScoreMatched:true,homeScore:27,awayScore:17,projectedHome:24,projectedAway:21};
}
function sample(){
 return Array.from({length:30},(_,i)=>historicalGame(i));
}
const input={sport:"cfb",gameId:"next",snapshotId:"snap1",frozenAt:now,
 kickoff,homeTeamId:"TEAM_A",awayTeamId:"TEAM_B",
 projectedHome:28,projectedAway:21,iterations:100,trainingGames:sample()};
test("CFB empirical matchup challenger is reproducible and keeps betting gated",()=>{
 const a=simulateMatchupDriveShadow(input),b=simulateMatchupDriveShadow(input);
 assert.equal(a.iterations,100);
 assert.equal(a.distributions.home_score.mean,b.distributions.home_score.mean);
 assert.equal(a.distributions.away_regulation_lead.n,100);
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.canQualify,false);
 assert.ok(Math.abs(a.distributions.home_regulation_lead.mean+
  a.distributions.away_regulation_lead.mean+a.distributions.regulation_tie.mean-1)<1e-8);
 assert.equal(a.coverage.TEAM_A.offenseDrives,300);
 assert.equal(a.coverage.TEAM_B.defenseDrives,300);
});
test("CFB matchup fit rejects future sources and team sparsity rather than pooled fallback",()=>{
 const xs=sample();
 xs[0].observedAt="2026-11-01T05:00:00Z";
 const found=selectMatchupDriveHistory(xs,{sport:"cfb",targetGameId:"next",
  frozenAt:now,homeTeamId:"TEAM_A",awayTeamId:"TEAM_B"});
 assert.equal(found.excluded.FUTURE_OR_MISSING_SOURCE_TIME,1);
 assert.throws(()=>simulateMatchupDriveShadow({...input,homeTeamId:"TEAM_C"}),
  /INSUFFICIENT_MATCHUP_TEAM_DRIVE_HISTORY/);
});
test("NFL possesses official source and period requirements",()=>{
 const drives=[];let h=0,a=0;
 for(let i=0;i<16;i++){
  const beforeH=h,beforeA=a,home=i%2===0;
  if(i===0)h+=3;if(i===1)a+=7;
  drives.push({driveId:"d"+i,seq:i+1,offenseTeamId:home?"TEAM_A":"TEAM_B",
   period:1+Math.floor(i/4),plays:5,startYardsToGoal:70,
   startHomeScore:beforeH,startAwayScore:beforeA,endHomeScore:h,endAwayScore:a});
 }
 const opts={gameId:"n1",homeTeamId:"TEAM_A",awayTeamId:"TEAM_B",
  kickoff:"2026-09-01T16:00:00Z",gradedAt:"2026-09-01T20:00:00Z",
  observedAt:"2026-09-02T05:00:00Z",homeScore:3,awayScore:7,
  sourceArtifactHash:"a".repeat(64),regulationOnly:true,wasOvertime:false,drives};
 const normalized=normalizeVerifiedNflPossessions(opts);
 assert.equal(normalized.drives.length,16);
 assert.equal(normalized.source,"NFL_PBP_VERIFIED_POSSESSIONS");
 assert.throws(()=>normalizeVerifiedNflPossessions({...opts,wasOvertime:true}),
  /NFL_REGULATION_SCOPE_NOT_VERIFIED/);
 assert.throws(()=>normalizeVerifiedNflPossessions({...opts,drives:drives.slice(1)}),
  /NFL_DRIVE_COMPLETENESS_INVALID/);
 assert.throws(()=>normalizeVerifiedNflPossessions({...opts,homeScore:14}),
  /NFL_OFFICIAL_SCORE_OR_SIDE_COVERAGE_MISMATCH/);
});
test("CFB DB bridge uses frozen source and official canonical team IDs",async()=>{
 const training=sample().map((g,i)=>({
  gameId:g.gameId,source:g.source,sourceFingerprint:g.sourceFingerprint,
  observedAt:g.observedAt,kickoff:g.kickoff,gradedAt:g.gradedAt,
  projectedHome:g.projectedHome,projectedAway:g.projectedAway,
  homeScore:g.homeScore,awayScore:g.awayScore,
  drivesJson:JSON.stringify(g.drives),verified:1,periodScope:"REGULATION_ONLY",
  homeName:"Alabama",awayName:"Texas A&M"
 }));
 let calls=0;
 const db={prepare(sql){
  calls++;
  if(sql.includes("prediction_snapshots")){
   assert.match(sql,/s.frozen_at<g.start/);
   return {bind(id,asOf,asOf2){
    assert.equal(id,"target");assert.equal(asOf,now);assert.equal(asOf2,now);
    return {first:async()=>({
     snapshotId:"snap",sourceFrozenAt:now,projectedHome:30,projectedAway:23,
     gameId:"target",kickoff,homeName:"Alabama",awayName:"Texas A&M"
    })}}};
  }
  assert.match(sql,/cfb_drive_verified_games/);
  assert.match(sql,/verified_against_game=1/);
  return {bind(time){assert.equal(time,now);return {all:async()=>({results:training})}}};
 }};
 const r=await runCfbMatchupResearchFromVerifiedDb({CFB_DB:db},{gameId:"target",now});
 assert.equal(calls,2);
 assert.equal(r.ok,true);
 assert.equal(r.iterations,1000);
 assert.equal(r.sourceDb,"CFB_DB");
 assert.equal(r.canAuthorizeWager,false);
 assert.ok(r.homeTeamId.startsWith("cfb-"));
});
