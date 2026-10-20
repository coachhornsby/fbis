/**
 * SportsDataverse ESPN NBA boxscore research shadow.
 * The public SDV release is a historical dataset, not a rights-cleared live
 * boxscore feed or automatically qualified FBIS player-projection source.
 */
export const SDV_NBA_PREFIX='nba/sdv/player-history-shadow/v1/';
const MAX_PLAYERS=1500, MAX_GAMES=5;
const bounds={minutes:75,points:100,rebounds:60,assists:40,three_pointers_made:25};
const numeric=(x,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=max;
const isoDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function verifySdvNbaHistorySnapshot(payload,{expectedDay=null}={}){
 if(!payload||payload.version!==1||payload.source!=='SDV_ESPN_NBA_PLAYER_BOXSCORES'||
    payload.mode!=='SHADOW_RESEARCH_ONLY'||payload.seasonType!=='NBA_REGULAR_SEASON_ONLY'||
    payload.canQualify!==false||payload.canAuthorizeWager!==false||
    !isoDay(payload.asOfDayExclusive)||expectedDay&&payload.asOfDayExclusive!==expectedDay||
    !Number.isFinite(Date.parse(payload.generatedAt))||
    typeof payload.provenance!=='string'||!payload.provenance.startsWith('https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/espn_nba_player_boxscores')||
    !Array.isArray(payload.entries)||payload.entries.length<1||payload.entries.length>MAX_PLAYERS||
    payload.playerCount!==payload.entries.length)
  return {ok:false,reason:'SOURCE_PROVENANCE_OR_SNAPSHOT_CONTRACT_INVALID'};
 const identities=new Set();let logs=0;
 for(const entry of payload.entries){
  const id=entry?.espnPlayerId;
  if(typeof id!=='string'||!/^\d{3,10}$/.test(id)||identities.has(id)||
     !Array.isArray(entry.games)||entry.games.length<1||entry.games.length>MAX_GAMES)
   return {ok:false,reason:'PLAYER_ID_OR_GAME_COUNT_INVALID'};
  identities.add(id);
  const unique=new Set();let prev='9999-12-31';
  for(const game of entry.games){
   if(typeof game?.gameId!=='string'||!/^\d{7,14}$/.test(game.gameId)||unique.has(game.gameId)||
      !isoDay(game.date)||game.date>=payload.asOfDayExclusive||game.date>prev||
      game.seasonType!==2||!Number.isInteger(game.season)||game.season<2010||game.season>2100||
      !numeric(game.minutes,bounds.minutes)||game.minutes<=0||
      Object.entries(bounds).some(([key,max])=>!numeric(game[key],max)))
    return {ok:false,reason:'FROZEN_STAT_ROW_INVALID'};
   unique.add(game.gameId);prev=game.date;logs++;
  }
 }
 return {ok:true,players:identities.size,gameLogs:logs,asOfDay:payload.asOfDayExclusive};
}
export async function storeSdvNbaHistoryShadow(env,payload,{now=new Date()}={}){
 if(!env?.ARCHIVE?.put||!env?.DB?.prepare)return {ok:false,code:'SDV_STORAGE_UNBOUND'};
 const check=verifySdvNbaHistorySnapshot(payload);
 if(!check.ok)return {ok:false,code:check.reason};
 if(Math.abs(now.getTime()-Date.parse(payload.generatedAt))>6*3600000)
  return {ok:false,code:'SOURCE_GENERATION_CLOCK_INVALID'};
 // At capture only allow independently verified ESPN athlete IDs from FBIS
 // roster evidence. Do NOT promote historical team/name fields into identity.
 let players;
 try{players=(await env.DB.prepare("SELECT DISTINCT player_id FROM nba_player_state_profiles WHERE julianday(as_of)>=julianday(?) LIMIT 1700").bind(new Date(now.getTime()-14*86400000).toISOString()).all()).results||[]}
 catch{return {ok:false,code:'CANONICAL_ROSTER_UNAVAILABLE'}};
 const known=new Set(players.map(p=>String(p.player_id)));
 const matched=payload.entries.filter(p=>known.has(p.espnPlayerId));
 if(!matched.length)return {ok:false,code:'NO_CANONICAL_ATHLETE_MATCHES'};
 const artifact={...payload,entries:matched,playerCount:matched.length,ingestedAt:now.toISOString(),
  canonicalRosterMatched:matched.length,unmatchedExcluded:payload.entries.length-matched.length,
  authority:'SHADOW_HISTORY_ONLY',projectionStatus:'CALIBRATION_AND_RIGHTS_REVIEW_REQUIRED',
  canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(SDV_NBA_PREFIX+'snapshot.json',JSON.stringify(artifact),{httpMetadata:{contentType:'application/json'}});
 return {ok:true,source:payload.source,players:matched.length,gameLogs:matched.reduce((n,p)=>n+p.games.length,0),
  unmatchedExcluded:artifact.unmatchedExcluded,asOfDay:check.asOfDay,
  authority:artifact.authority,canQualify:false,canAuthorizeWager:false};
}
export async function readSdvNbaShadowStatus(env){
 if(!env?.ARCHIVE?.get)return {status:'STORAGE_UNAVAILABLE'};
 try{const o=await env.ARCHIVE.get(SDV_NBA_PREFIX+'snapshot.json');if(!o)return {status:'NOT_CAPTURED'};
  const payload=await o.json();return {status:'SHADOW_RESEARCH_ONLY',source:payload.source,
   asOfDay:payload.asOfDayExclusive,ingestedAt:payload.ingestedAt,players:payload.playerCount,
   gameLogs:(payload.entries||[]).reduce((n,p)=>n+p.games.length,0),
   canQualify:false,canAuthorizeWager:false};
 }catch{return {status:'READ_FAILED'}}
}
