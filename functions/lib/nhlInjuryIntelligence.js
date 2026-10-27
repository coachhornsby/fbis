// Presentation-only availability. Roster membership and scratches are not injuries.
import { nhlGoalieTeamKey } from './nhlGoalieStarterEvidence.js';
export const NHL_INJURY_SOURCE_HEALTH = Object.freeze({
 official: {state:'UNVERIFIED',reason:'NO_STRUCTURED_OFFICIAL_INJURY_FEED_VERIFIED'},
 espn: {state:'BLOCKED_PERMISSION',reason:'AUTOMATED_EXTRACTION_PERMISSION_REQUIRED',url:'https://disneytermsofuse.com/english/'},
});
const time=v=>Number.isFinite(Date.parse(v||''))?Date.parse(v):null;
export function buildNhlInjuryReport(rows=[],team,{nowMs=Date.now(),gameId=null,gameStart=null,storeAvailable=true}={}){
 const key=nhlGoalieTeamKey(team),start=time(gameStart),latest=new Map();
 for(const row of rows){
  if(row.sport!=='nhl'||nhlGoalieTeamKey(row.team_key)!==key)continue;
  if(row.game_id&&String(row.game_id)!==String(gameId))continue;
  const observed=time(row.observed_at),updated=time(row.source_updated_at);
  // Source clock never silently falls back to collection time.
  if(observed==null||observed>nowMs||updated==null||updated>observed||
    (start!=null&&observed>=start))continue;
  let meta;try{meta=JSON.parse(row.raw_json||'{}');}catch{continue;}
  if(meta.verificationStatus!=='VERIFIED'||!row.source_url||!row.player_id)continue;
  const id=String(row.player_id),prior=latest.get(id);
  if(!prior||observed>time(prior.observed_at))latest.set(id,{...row,meta});
 }
 const players=[...latest.values()].filter(r=>!['ACTIVE','AVAILABLE','FULL'].includes(r.status)).map(r=>({
  canonicalPlayerId:r.player_id,providerPlayerId:r.meta.providerPlayerId||null,name:r.player_name,
  position:r.position,status:r.status,injury:r.injury_detail||null,
  expectedReturn:r.meta.expectedReturn||null,practice:r.practice_status||null,
  source:r.source,sourceUrl:r.source_url,sourceUpdatedAt:r.source_updated_at,collectedAt:r.observed_at,
  verificationStatus:'VERIFIED',stale:nowMs-time(r.observed_at)>6*3600000||nowMs-time(r.source_updated_at)>36*3600000,
 }));
 return {team:key,state:!storeAvailable?'SOURCE_UNAVAILABLE':!players.length?'UNVERIFIED':players.every(p=>p.stale)?'STALE':'REPORTED',
  reason:!storeAvailable?'AVAILABILITY_STORE_UNAVAILABLE':!players.length?'NO_VERIFIED_INJURY_OBSERVATIONS':null,
  players,coverageComplete:false,noReportedInjuriesVerified:false};
}
