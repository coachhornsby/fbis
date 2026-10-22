import test from "node:test";
import assert from "node:assert/strict";
import {
 normalizeCfbdDriveGame,selectCfbDriveTraining,simulateCfbDriveShadowV2,
 CFB_DRIVE_SIM_ID
} from "../functions/lib/cfbDriveSimulationV2.js";
import {freezeCfbDriveShadow,gradeCfbDriveShadow,cfbDriveResearchStatus} from "../functions/lib/cfbDriveSimulationStore.js";
import {onRequestPost} from "../functions/api/cfb-simulation.js";

function game(index,{observedAt="2026-09-16T10:00:00Z"}={}){
 const gid=String(401000000+index);const drives=[];
 let home=0,away=0;
 for(let n=1;n<=24;n++){
  const isHomeOffense=n%2===0;
  const off=isHomeOffense?home:away,def=isHomeOffense?away:home;
  const offensePoints=n%5===0?7:n%3===0?3:0;
  const defensePoints=n%17===0?7:0;
  if(isHomeOffense){home+=offensePoints;away+=defensePoints}
  else{away+=offensePoints;home+=defensePoints}
  drives.push({gameId:Number(gid),id:gid+"-"+n,driveNumber:n,
    isHomeOffense,startPeriod:1+Math.floor((n-1)/6),
    endPeriod:1+Math.floor((n-1)/6),
    startYardsToGoal:45+n%45,plays:5+n%4,
    startOffenseScore:off,startDefenseScore:def,
    endOffenseScore:off+offensePoints,endDefenseScore:def+defensePoints,
    driveResult:offensePoints>=6?"TD":offensePoints===3?"FG":"Punt"});
 }
 return normalizeCfbdDriveGame({gameId:gid,drives,homeScore:home,awayScore:away,
   kickoff:"2026-09-14T18:00:00Z",gradedAt:"2026-09-15T04:00:00Z",
   observedAt,projectedHome:26+index%7,projectedAway:21+index%6});
}
const target={gameId:"409999999",snapshotId:"cfb-test-snap",
 frozenAt:"2026-10-22T15:00:00Z",kickoff:"2026-10-24T16:00:00Z",
 projectedHome:29.4,projectedAway:23.2};
test("CFBD scores/possessions reconcile with complete game before inclusion",()=>{
 const good=game(1);
 assert.equal(good.drives.length,24);
 assert.equal(good.source,"CFBD_DRIVES");
 assert.equal(good.officialScoreMatched,true);
 assert.equal(good.regulationOnly,true);
 assert.equal(good.sourceFingerprint.length,64);
 const broken=Array.from({length:12},(_,n)=>({
   gameId:401000005,id:"x"+n,driveNumber:n+1,isHomeOffense:n%2===0,
   startPeriod:1,endPeriod:1,startYardsToGoal:60,plays:5,
   startOffenseScore:0,startDefenseScore:0,endOffenseScore:0,endDefenseScore:0,
 }));
 assert.throws(()=>normalizeCfbdDriveGame({gameId:"401000005",drives:broken,
   homeScore:3,awayScore:0,kickoff:"2026-09-14T18:00:00Z",
   gradedAt:"2026-09-15T04:00:00Z",observedAt:"2026-09-16T10:00:00Z",
   projectedHome:24,projectedAway:21}),/DRIVE_FINAL_SCORE_MISMATCH/);
 assert.throws(()=>normalizeCfbdDriveGame({gameId:"401000005",
   drives:[...broken.slice(0,10),{...broken[10],startPeriod:5},broken[11]],
   homeScore:0,awayScore:0,kickoff:"2026-09-14T18:00:00Z",
   gradedAt:"2026-09-15T04:00:00Z",observedAt:"2026-09-16T10:00:00Z",
   projectedHome:24,projectedAway:21}),/UNSUPPORTED_CFB_OVERTIME/);
});
test("drive source must be observed and graded strictly before target freeze",()=>{
 const games=Array.from({length:25},(_,i)=>game(i));
 const late=game(30,{observedAt:"2026-10-23T10:00:00Z"});
 const actual=selectCfbDriveTraining([...games,late],{
    targetGameId:target.gameId,frozenAt:target.frozenAt});
 assert.equal(actual.games.length,25);
 assert.equal(actual.driveCount,600);
 assert.equal(actual.reasons.FUTURE_TRAINING_DATA,1);
 assert.equal(actual.eligible,true);
 const bad=selectCfbDriveTraining(games.map(x=>({...x,observedAt:"2026-10-23T10:00:00Z"})),{
   targetGameId:target.gameId,frozenAt:target.frozenAt});
 assert.equal(bad.eligible,false);
});
test("drive-level game-state simulator produces reproducible genuine possession-derived outcomes",()=>{
 const trainingGames=Array.from({length:25},(_,i)=>game(i));
 const a=simulateCfbDriveShadowV2({...target,trainingGames,iterations:100,});
 const b=simulateCfbDriveShadowV2({...target,trainingGames,iterations:100});
 assert.deepEqual(a,b);
 assert.equal(a.modelId,CFB_DRIVE_SIM_ID);
 assert.equal(a.distributions.total.n,100);
 assert.equal(a.distributions.home_drives.mean,12);
 assert.equal(a.distributions.away_drives.mean,12);
 assert.equal(a.trainingDrives,600);
 assert.equal(a.ncaOvertimeMode,"NOT_MODELED");
 assert.equal(a.canAuthorizeWager,false);
 assert.equal(a.changesProductionChampion,false);
});
test("incomplete, underpowered and temporally contaminated training fail closed",()=>{
 const games=Array.from({length:19},(_,i)=>game(i));
 assert.throws(()=>simulateCfbDriveShadowV2({...target,trainingGames:games,iterations:100}),/INSUFFICIENT_VERIFIED/);
 assert.throws(()=>simulateCfbDriveShadowV2({...target,trainingGames:[],iterations:100}),/INSUFFICIENT_VERIFIED/);
 assert.throws(()=>simulateCfbDriveShadowV2({...target,frozenAt:target.kickoff,trainingGames:games,iterations:100}),/NOT_FROZEN/);
});
test("v2 CFB operator commands require authentication and cannot fallback to primary",async()=>{
 for(const operation of [freezeCfbDriveShadow,gradeCfbDriveShadow,cfbDriveResearchStatus]){
   await assert.rejects(operation({DB:{prepare(){throw Error("PRIMARY_USED")}}},{gameId:"401000000"}),/CFB_DB_UNBOUND/);
 }
 const env={HARVEST_SECRET:"research-test-only"};
 const post=async authenticated=>onRequestPost({env,request:new Request("https://fbis.test/api/cfb-simulation",{
    method:"POST",headers:authenticated?{"x-harvest-secret":"research-test-only"}:{},
    body:JSON.stringify({action:"drive-freeze",gameId:"401000000"})
 })});
 assert.equal((await post(false)).status,401);
 assert.equal((await post(true)).status,503);
});
