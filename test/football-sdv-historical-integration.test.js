import test from "node:test";
import assert from "node:assert/strict";
import {extractSdvCfbDriveGame} from "../functions/lib/cfbSdvPbpDriveAdapter.js";
import {validateSdvGame} from "../functions/api/football-sdv-ingest.js";
import {selectMatchupDriveHistory} from "../functions/lib/footballPossessionMatchupResearch.js";
const kickoff="2025-09-01T19:00:00Z",observedAt="2026-10-23T18:30:00Z";
const gameId="401234567";
function fixture(){
 let h=0,a=0,n=0;
 const rows=[];
 for(let i=0;i<18;i++){
  const off=i%2===0?333:2;
  const score=i%6===0?7:i%6===1?3:0;
  for(let j=0;j<3;j++){
   if(j===2){if(off===333)h+=score;else a+=score}
   rows.push({game_id:gameId,game_play_number:++n,"drive.id":"d"+i,
    "start.team.id":off,homeTeamId:333,awayTeamId:2,
    homeTeamName:"Alabama",awayTeamName:"Auburn",homeFinalScore:21,
    awayFinalScore:9,homeScore:h,awayScore:a,"period.number":1+Math.floor(i/5),
    "drive.start.period.number":1+Math.floor(i/5),
    "start.yardsToEndzone":75,"drive.offensivePlays":3,
    status_type_completed:true});
  }
 }
 return rows;
}
const raw=()=>({gameId,kickoff,observedAt,gradedAt:observedAt,
 sourceAsset:"https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_cfb_pbp/play_by_play_2025.parquet",sourceRows:fixture()});
test("CFB ESPN SDV PBP reconciliation checks official score, origin, and overtime",()=>{
 const r=extractSdvCfbDriveGame(raw());
 assert.equal(r.drives.length,18);
 assert.equal(r.homeTeamId,"cfb-333");
 assert.equal(r.awayTeamId,"cfb-2");
 assert.equal(r.drives[0].offensePoints,7);
 assert.equal(r.evidenceClass,"POSTGAME_RECONSTRUCTED");
 assert.equal(r.prospective,false);
 assert.throws(()=>extractSdvCfbDriveGame({...raw(),sourceRows:fixture().map((r,i)=>i===1?{...r,"period.number":5}:r)}),
 /CFB_SDV_OVERTIME_NOT_SUPPORTED/);
 assert.throws(()=>extractSdvCfbDriveGame({...raw(),sourceRows:fixture().map((r,i)=>i===50?{...r,homeScore:50}:r)}),
 /CFB_SDV_SCORE_MISSING_OR_REGRESSED|CFB_SDV_FINAL_NOT_RECONCILED/);
});
test("SDV D1 upload refuses historical evidence pretending to be prospective",()=>{
 const r=extractSdvCfbDriveGame(raw());
 r.sport="cfb";r.season=2025;
 assert.equal(validateSdvGame(r,"cfb"),r);
 assert.throws(()=>validateSdvGame({...r,prospective:true},"cfb"),/INVALID_SDV_ARCHIVE/);
 assert.throws(()=>validateSdvGame({...r,homeScore:999},"cfb"),/INVALID_SDV_SCORE/);
});
test("Reconstructed historical mode never bypasses future-game chronology",()=>{
 const r=extractSdvCfbDriveGame(raw());
 const options={sport:"cfb",targetGameId:"new",frozenAt:"2025-09-10T00:00:00Z",
  homeTeamId:"cfb-333",awayTeamId:"cfb-2",minTeamGames:1,minTeamDrives:1};
 const strict=selectMatchupDriveHistory([r],options);
 assert.equal(strict.trainingGames,0);
 const retro=selectMatchupDriveHistory([r],{...options,historicalReconstruction:true});
 assert.equal(retro.trainingGames,1);
 assert.equal(retro.evidenceMode,"POSTGAME_RECONSTRUCTED_BACKTEST");
 const tooEarly=selectMatchupDriveHistory([r],{...options,historicalReconstruction:true,frozenAt:"2025-08-31T00:00:00Z"});
 assert.equal(tooEarly.trainingGames,0);
});
