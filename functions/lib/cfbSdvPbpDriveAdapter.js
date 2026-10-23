/** SDV ESPN CFB play-by-play -> reconciled, regulation-only drive history.
 * This adapter uses the real drive.id and scoreboard from each play, not guessed
 * possessions. It rejects scoring that cannot be reconciled to a drive.
 */
import {resolveTeamExact} from "./teams.js";
import {sha256Hex} from "./sha256Hex.js";
const integer=x=>x===null||x===undefined||x===""?null:Number.isInteger(Number(x))?Number(x):null;
const validTime=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
function check(x,error){if(!x)throw Error(error)}
function idFor(r,id,name){
 return resolveTeamExact("cfb",{espnId:id})?.id||
   resolveTeamExact("cfb",{name})?.id||null;
}
export function extractSdvCfbDriveGame({
 gameId,kickoff,gradedAt,observedAt,sourceRows=[],sourceAsset=null
}={}){
 check(String(gameId||"")&&validTime(kickoff)&&validTime(gradedAt)&&
   validTime(observedAt)&&Date.parse(kickoff)<Date.parse(gradedAt)&&
   Date.parse(gradedAt)<=Date.parse(observedAt),"CFB_SDV_INVALID_TIMELINE");
 check(Array.isArray(sourceRows)&&sourceRows.length>=30&&sourceRows.length<=420,
  "CFB_SDV_INCOMPLETE_PBP");
 const first=sourceRows[0],homeTeamId=idFor(first,first.homeTeamId,first.homeTeamName);
 const awayTeamId=idFor(first,first.awayTeamId,first.awayTeamName);
 check(homeTeamId&&awayTeamId&&homeTeamId!==awayTeamId,"CFB_SDV_IDENTITY_UNRESOLVED");
 const finalHome=integer(first.homeFinalScore),finalAway=integer(first.awayFinalScore);
 check(finalHome!==null&&finalAway!==null&&first.status_type_completed===true,
  "CFB_SDV_OFFICIAL_RESULT_REQUIRED");
 const rows=[...sourceRows].sort((a,b)=>(integer(a.game_play_number)??Infinity)-
                                        (integer(b.game_play_number)??Infinity));
 const grouped=new Map(),seen=new Set();let prevH=0,prevA=0,previousDrive=null;
 for(const r of rows){
  check(String(r.game_id)===String(gameId)&&String(r.homeTeamId)===String(first.homeTeamId)&&
    String(r.awayTeamId)===String(first.awayTeamId),"CFB_SDV_GAME_INCONSISTENT");
  const seq=integer(r.game_play_number);
  if(seq===null)continue; // Non-play ESPN markers have no ordered game play number.
  check(!seen.has(seq),"CFB_SDV_DUPLICATE_PLAY");
  seen.add(seq);
  const p=integer(r["period.number"]);
  check(p!==null&&p>=1&&p<=4,"CFB_SDV_OVERTIME_NOT_SUPPORTED");
  const h=integer(r.homeScore),a=integer(r.awayScore);
  check(h!==null&&a!==null&&h>=prevH&&a>=prevA,"CFB_SDV_SCORE_MISSING_OR_REGRESSED");
  const d=String(r["drive.id"]||"").trim();
  if(!d){
   check(h===prevH&&a===prevA,"CFB_SDV_UNASSIGNED_SCORE");
   continue;
  }
  if(previousDrive!==d && grouped.has(d))
   throw Error("CFB_SDV_NONCONTIGUOUS_DRIVE");
  if(!grouped.has(d))grouped.set(d,{id:d,rows:[],startH:prevH,startA:prevA});
  grouped.get(d).rows.push(r);
  previousDrive=d;prevH=h;prevA=a;
 }
 check(prevH===finalHome&&prevA===finalAway,"CFB_SDV_FINAL_NOT_RECONCILED");
 check(grouped.size>=12&&grouped.size<=70,"CFB_SDV_DRIVE_COMPLETENESS");
 let h=0,a=0,homeDrives=0,awayDrives=0;
 const drives=[];
 for(const [driveId,g] of grouped){
  const firstRow=g.rows[0],last=g.rows[g.rows.length-1];
  check(g.startH===h&&g.startA===a,"CFB_SDV_DRIVE_SCORE_DISCONTINUITY");
  const postH=integer(last.homeScore),postA=integer(last.awayScore);
  const ytg=integer(firstRow["start.yardsToEndzone"]);
  const period=integer(firstRow["drive.start.period.number"])??integer(firstRow["period.number"]);
  const offense=idFor(firstRow,firstRow["start.team.id"],null);
  const homeOff=offense===homeTeamId;
  check(offense&&(offense===homeTeamId||offense===awayTeamId)&&
    ytg!==null&&ytg>=0&&ytg<=100&&period!==null&&period>=1&&period<=4,
    "CFB_SDV_DRIVE_CONTEXT_MISSING");
  const op=homeOff?postH-h:postA-a,dp=homeOff?postA-a:postH-h;
  check(op>=0&&op<=8&&dp>=0&&dp<=8&&!(op>0&&dp>0),
    "CFB_SDV_DRIVE_POINTS_UNSUPPORTED");
  const plays=g.rows.length;
  check(plays>=1&&plays<=35,"CFB_SDV_DRIVE_PLAYS_INVALID");
  drives.push({driveId:String(driveId),seq:drives.length+1,offense:homeOff?"home":"away",
    period,plays,startYardsToGoal:ytg,startMargin:homeOff?h-a:a-h,
    offensePoints:op,defensePoints:dp});
  h=postH;a=postA;
  if(homeOff)homeDrives++;else awayDrives++;
 }
 check(h===finalHome&&a===finalAway&&homeDrives>=4&&awayDrives>=4,
  "CFB_SDV_DRIVE_FINAL_OR_TEAM_COVERAGE");
 const sourceFingerprint=sha256Hex(JSON.stringify({gameId,sourceRows,sourceAsset}));
 return {gameId:String(gameId),homeTeamId,awayTeamId,kickoff,gradedAt,observedAt,
  source:"SDV_ESPN_CFB_PBP_DRIVES",sourceAsset,sourceFingerprint,
  evidenceClass:"POSTGAME_RECONSTRUCTED",prospective:false,
  officialScoreMatched:true,regulationOnly:true,homeScore:finalHome,awayScore:finalAway,drives};
}
