/**
 * Strict SportsDataverse basketball play-by-play -> possession evidence.
 * CBB: ncaa_mbb_pbp has documented poss_team_* and poss_num.
 * NBA: action/team_id is NOT an authoritative possession owner. The caller
 * must supply an independently verified possession owner (e.g. reconstructed
 * from NBA Stats PBP / lineup evidence); missing ownership => hard failure.
 *
 * No synthetic FT possessions, period-end scores, or overtime imputation.
 */
import {validateBasketballPossessionGame} from "./basketballSdvPossessionSimulationResearch.js";
const id=x=>typeof x==="string"&&x.length>0;
const asNum=x=>x===null||x===undefined||x===""?null:
 Number.isInteger(Number(x))?Number(x):null;
const clock=x=>x===null||x===undefined?null:Number(x);
function owner(row,sport){
 if(sport==="cbb")return String(row.poss_team_espn_team_id||row.poss_team_ncaa_team_id||"");
 return String(row.verified_possession_owner_team_id||"");
}
/**
 * NBA Stats PBP contains offensive lineup player IDs but individual action
 * team_id may be defensive (block, foul, rebound) or neither. Confirm owner
 * only from FIVE independently matched offensive player-to-team memberships.
 * Missing/conflicting player-team evidence vetoes the whole possession.
 */
export function attachVerifiedNbaPossessionOwners(events,{
 homeTeamId,awayTeamId,playerTeamMap,rosterSourceFingerprint
}={}){
 if(!Array.isArray(events)||!events.length||
    !/^[0-9a-f]{64}$/i.test(rosterSourceFingerprint||"")||
    !playerTeamMap||typeof playerTeamMap!=="object")
  throw Error("NBA_ROSTER_OWNER_PROOF_MISSING");
 const groups=new Map();
 for(const raw of events){
  const period=asNum(raw.period??raw.period_number);
  if(period>4)continue;
  const number=asNum(raw.possession_number);
  if(period===null||number===null)throw Error("NBA_PBP_POSSESSION_NUMBER_MISSING");
  const key=period+"|"+number;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(raw);
 }
 const owners=new Map();
 for(const [key,rows] of groups){
  const possible=new Set();
  for(const row of rows){
   const ids=Array.from({length:5},(_,i)=>
    String(row["off_player_"+(i+1)]??"")).filter(x=>x&&x!=="0"&&x!=="null");
   if(ids.length!==5||new Set(ids).size!==5)continue;
   const teams=new Set(ids.map(x=>playerTeamMap[x]).filter(Boolean));
   if(teams.size!==1||ids.some(x=>!playerTeamMap[x]))continue;
   const [team]=teams;
   if(![homeTeamId,awayTeamId].includes(team))continue;
   possible.add(team);
  }
  if(possible.size!==1)throw Error("NBA_POSSESSION_OWNER_NOT_LINEUP_VERIFIED:"+key);
  owners.set(key,[...possible][0]);
 }
 return events.map(row=>{
  const period=asNum(row.period??row.period_number);
  if(period>4)return row;
  const k=period+"|"+asNum(row.possession_number);
  return {...row,verified_possession_owner_team_id:owners.get(k),
   possession_owner_lineup_fingerprint:rosterSourceFingerprint};
 });
}

export function normalizeSdvBasketballPbpPossessions({
 sport,gameId,tipoff,observedAt,sourceFingerprint,season,
 homeTeamId,awayTeamId,events,regulationEndScore
}={}){
 const maxPeriod=sport==="nba"?4:sport==="cbb"?2:0;
 if(!maxPeriod||!Array.isArray(events)||!events.length||
  !id(gameId)||!id(homeTeamId)||!id(awayTeamId)||
  !regulationEndScore||!Number.isInteger(regulationEndScore.home)||
  !Number.isInteger(regulationEndScore.away))
  throw Error("BASKETBALL_PBP_SOURCE_CONTRACT_MISSING");
 const groups=new Map(),seen=new Set();let overtimeSeen=false;
 for(const raw of events){
  const period=asNum(raw.period_number??raw.period);
  if(period!==null&&period>maxPeriod){overtimeSeen=true;continue}
  if(period===null||period<1)throw Error("BASKETBALL_PBP_INVALID_PERIOD");
  const poss=asNum(sport==="cbb"?raw.poss_num:raw.possession_number);
  const team=owner(raw,sport);
  if(poss===null||poss<0||![homeTeamId,awayTeamId].includes(team))
   throw Error("BASKETBALL_PBP_OWNER_UNVERIFIED");
  const sequence=asNum(raw.game_play_number??raw.order_index??raw.action_number??raw.id);
  if(sequence===null||sequence<0||seen.has(sequence))
   throw Error("BASKETBALL_PBP_ORDER_UNVERIFIED");
  seen.add(sequence);
  const h=asNum(raw.home_score),a=asNum(raw.away_score);
  if(h===null||a===null||h<0||a<0)
   throw Error("BASKETBALL_PBP_SCORE_MISSING");
  const key=period+"|"+poss+"|"+team;
  if(!groups.has(key))groups.set(key,{key,period,team,rows:[]});
  groups.get(key).rows.push({sequence,homeScore:h,awayScore:a});
 }
 if(!groups.size)throw Error("BASKETBALL_PBP_NO_REGULATION_POSSESSIONS");
 const ordered=[...groups.values()].map(g=>({...g,
  rows:g.rows.sort((a,b)=>a.sequence-b.sequence),
  earliest:Math.min(...g.rows.map(r=>r.sequence)),
  latest:Math.max(...g.rows.map(r=>r.sequence))}))
  .sort((a,b)=>a.earliest-b.earliest);
 let prev=-1,home=0,away=0,lastPeriod=1;
 const possessions=[];
 for(const group of ordered){
  if(group.earliest<=prev||group.period<lastPeriod)
   throw Error("BASKETBALL_PBP_GROUP_ORDER_INVALID");
  prev=group.latest;lastPeriod=group.period;
  const last=group.rows.at(-1);
  const dh=last.homeScore-home,da=last.awayScore-away;
  if(dh<0||da<0||dh>6||da>6)
   throw Error("BASKETBALL_PBP_SCORE_DISCONTINUITY");
  if(group.team===homeTeamId&&da!==0||group.team===awayTeamId&&dh!==0)
   throw Error("BASKETBALL_PBP_CROSS_TEAM_SCORE_UNASSIGNED");
  possessions.push({id:group.key,sequence:group.earliest,period:group.period,
   offense:group.team===homeTeamId?"home":"away",
   points:group.team===homeTeamId?dh:da});
  home=last.homeScore;away=last.awayScore;
 }
 if(home!==regulationEndScore.home||away!==regulationEndScore.away)
  throw Error("BASKETBALL_PBP_REGULATION_BOUNDARY_MISMATCH");
 const result={sport,gameId,season,tipoff,observedAt,
  sourceFingerprint,homeTeamId,awayTeamId,
  homeRegulationScore:home,awayRegulationScore:away,
  possessions,regulationOnly:true,canAuthorizeWager:false,
  overtimeExcluded:overtimeSeen,
  possessionOwnerProvenance:sport==="cbb"?"NCAA_MBB_POSSESSION_TEAM":
    "INDEPENDENT_VERIFIED_NBA_POSSESSION_OWNER"};
 return validateBasketballPossessionGame(result);
}
