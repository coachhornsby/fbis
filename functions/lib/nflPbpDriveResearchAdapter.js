/**
 * Strict nflverse / nflfastR PBP -> verified possession candidate.
 * The archive producer must attest the source artifact SHA256 and collection time.
 * This adapter refuses to synthesize missing scoring or overtime context.
 * It does not fetch, store, or grant authority.
 *
 * Field definitions: nflfastR play_by_play dataset.
 */
import {resolveTeamExact} from "./teams.js";
import {normalizeVerifiedNflPossessions} from "./footballPossessionMatchupResearch.js";
const number=x=>x===null||x===undefined||x===""?null:Number(x);
const integer=x=>{const n=number(x);return Number.isInteger(n)?n:null};
const alias=Object.freeze({JAC:"JAX",STL:"LAR",SD:"LAC",OAK:"LV",LA:"LAR"});
const abbr=x=>{const s=String(x||"").trim().toUpperCase();return alias[s]||s};
const present=x=>typeof x==="string"&&x.trim().length>0;
function check(test,reason){if(!test)throw Error(reason)}
function lastScore(row,teamSide){
 const off=integer(row.posteam_score_post),def=integer(row.defteam_score_post);
 if(off===null||def===null)return null;
 const postHome=abbr(row.posteam)===abbr(row.home_team);
 return teamSide==="home"?(postHome?off:def):(postHome?def:off);
}
export function extractNflfastRPossessionGame({
 plays=[],kickoff,gradedAt,observedAt,sourceArtifactHash,
}={}){
 check(Array.isArray(plays)&&plays.length>=30&&plays.length<=350,"NFL_PBP_GAME_SIZE_INVALID");
 check(/^[a-f0-9]{64}$/i.test(String(sourceArtifactHash||"")),"NFL_RAW_ARTIFACT_SHA256_REQUIRED");
 const gameId=String(plays[0].game_id||"");
 const home=abbr(plays[0].home_team),away=abbr(plays[0].away_team);
 const homeId=resolveTeamExact("nfl",{abbr:home})?.id;
 const awayId=resolveTeamExact("nfl",{abbr:away})?.id;
 check(gameId&&homeId&&awayId&&homeId!==awayId,"NFL_PBP_CANONICAL_GAME_IDENTITY_MISSING");
 const allPlayIds=new Set();
 let scoreHome=null,scoreAway=null;
 const group=new Map();
 for(const p of plays){
  check(p.game_id===gameId&&abbr(p.home_team)===home&&abbr(p.away_team)===away,
   "NFL_PBP_GAME_IDENTITY_CONFLICT");
  const pid=String(p.play_id??"");
  check(pid&&!allPlayIds.has(pid),"NFL_PBP_DUPLICATE_PLAY_ID");
  allPlayIds.add(pid);
  if(integer(p.qtr)>4||String(p.game_half||"").toLowerCase()==="overtime")
   throw Error("NFL_PBP_OVERTIME_NOT_SUPPORTED");
  const gh=integer(p.home_score),ga=integer(p.away_score);
  check(gh!==null&&ga!==null,"NFL_PBP_OFFICIAL_FINAL_MISSING");
  if(scoreHome===null){scoreHome=gh;scoreAway=ga}
  else check(gh===scoreHome&&ga===scoreAway,"NFL_PBP_OFFICIAL_FINAL_CONFLICT");
  const d=integer(p.drive);
  const pos=abbr(p.posteam);
  if(d===null||!pos||!p.posteam)continue; // kicks can have no possession.
  check(d>=0&&d<80&&(pos===home||pos===away),"NFL_PBP_INVALID_DRIVE");
  if(!group.has(d))group.set(d,[]);
  group.get(d).push(p);
 }
 check(group.size>=16&&group.size<=44,"NFL_PBP_DRIVE_COVERAGE_INCOMPLETE");
 const drives=[];
 for(const [drive,rows] of [...group].sort((a,b)=>a[0]-b[0])){
  rows.sort((a,b)=>Number(a.play_id)-Number(b.play_id));
  const team=abbr(rows[0].posteam);
  check(rows.every(r=>abbr(r.posteam)===team),"NFL_PBP_POSSESSION_TEAM_CONFLICT");
  const first=rows[0],last=rows[rows.length-1];
  const startHome=integer(first.total_home_score),startAway=integer(first.total_away_score);
  const endHome=lastScore(last,"home"),endAway=lastScore(last,"away");
  const firstYard=integer(first.yardline_100),period=integer(first.qtr);
  check([startHome,startAway,endHome,endAway,firstYard,period].every(x=>x!==null),
   "NFL_PBP_DRIVE_SCORE_OR_START_CONTEXT_MISSING");
  drives.push({driveId:gameId+":"+drive,seq:drives.length+1,
   offenseTeamId:team===home?homeId:awayId,period,plays:rows.length,
   startYardsToGoal:firstYard,startHomeScore:startHome,startAwayScore:startAway,
   endHomeScore:endHome,endAwayScore:endAway});
 }
 return normalizeVerifiedNflPossessions({gameId,homeTeamId:homeId,awayTeamId:awayId,
  kickoff,gradedAt,observedAt,sourceArtifactHash,regulationOnly:true,
  wasOvertime:false,homeScore:scoreHome,awayScore:scoreAway,drives});
}
