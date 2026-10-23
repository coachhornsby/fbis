import test from "node:test";
import assert from "node:assert/strict";
import {extractNflfastRPossessionGame} from "../functions/lib/nflPbpDriveResearchAdapter.js";
function fixture(){
 let home=0,away=0,playId=1;
 const plays=[];
 for(let drive=1;drive<=16;drive++){
  const posteam=drive%2?"HOU":"TEN";
  for(let n=0;n<2;n++){
   const beforeH=home,beforeA=away;
   if(n===1&&drive===1)home+=3;
   if(n===1&&drive===2)away+=7;
   const homeOff=posteam==="HOU";
   plays.push({game_id:"2026_01_TEN_HOU",home_team:"HOU",away_team:"TEN",
    home_score:3,away_score:7,play_id:playId++,drive,posteam,defteam:homeOff?"TEN":"HOU",
    qtr:1+Math.floor((drive-1)/4),game_half:drive<=8?"Half1":"Half2",
    yardline_100:73,total_home_score:beforeH,total_away_score:beforeA,
    posteam_score_post:homeOff?home:away,defteam_score_post:homeOff?away:home});
  }
 }
 return plays;
}
const meta={kickoff:"2026-09-01T17:00:00Z",gradedAt:"2026-09-01T21:00:00Z",
 observedAt:"2026-09-02T01:00:00Z",sourceArtifactHash:"b".repeat(64)};
test("nflfastR drive adapter derives official reconciled possession scores",()=>{
 const result=extractNflfastRPossessionGame({...meta,plays:fixture()});
 assert.equal(result.drives.length,16);
 assert.equal(result.homeScore,3);
 assert.equal(result.awayScore,7);
 assert.equal(result.drives[0].offensePoints,3);
 assert.equal(result.drives[1].offensePoints,7);
 assert.equal(result.officialScoreMatched,true);
 assert.equal(result.regulationOnly,true);
 assert.ok(result.homeTeamId.startsWith("nfl-"));
});
test("nflfastR adapter excludes OT, changed finals, and missing PBP score evidence",()=>{
 const o=fixture();o[8]={...o[8],qtr:5};
 assert.throws(()=>extractNflfastRPossessionGame({...meta,plays:o}),/NFL_PBP_OVERTIME_NOT_SUPPORTED/);
 const wrong=fixture();wrong[8]={...wrong[8],home_score:7};
 assert.throws(()=>extractNflfastRPossessionGame({...meta,plays:wrong}),/NFL_PBP_OFFICIAL_FINAL_CONFLICT/);
 const missing=fixture();missing[0]={...missing[0],total_home_score:null};
 assert.throws(()=>extractNflfastRPossessionGame({...meta,plays:missing}),/NFL_PBP_DRIVE_SCORE_OR_START_CONTEXT_MISSING/);
});
