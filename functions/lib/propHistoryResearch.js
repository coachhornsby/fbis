import { finitePropNumber as n } from './exchangePlayerProps.js';
import { loadNflVerseFeatures } from './nflVerseFeed.js';
import { valueForEspnEvent } from './playerPropHistory.js';
export function historySummary(input,{line=null,asOf=new Date().toISOString(),season=null}={}) {
 const seen=new Set();const cutoff=Date.parse(asOf);
 const priorWeek=g=>g?.temporalBasis==='PRIOR_SEASON_WEEKLY_SNAPSHOT'&&g.status==='FINAL'&&Number.isInteger(g.season)&&g.season<new Date(asOf).getUTCFullYear()&&(g.season<new Date(asOf).getUTCFullYear()-1||new Date(asOf).getUTCMonth()>=2)&&Number.isInteger(g.week)&&g.week>=1&&g.week<=22;
 const games=input.filter(g=>g&&n(g.value)!=null&&(priorWeek(g)||Date.parse(g.date)<cutoff&&(String(g.date).slice(0,10)<String(asOf).slice(0,10)||['FINAL','OFF'].includes(g.status)))&&!['DNP','CANCELLED','CANCELED','UNVERIFIED'].includes(g.status))
  .sort((a,b)=>Number.isInteger(a.season)&&Number.isInteger(b.season)&&Number.isInteger(a.week)&&Number.isInteger(b.week)?(b.season-a.season)*100+b.week-a.week:Date.parse(b.date)-Date.parse(a.date)).filter(g=>{const id=g.eventId||`${g.date}:${g.opponent}`;if(seen.has(id))return false;seen.add(id);return true;});
 const mean=a=>a.length?a.reduce((s,x)=>s+x.value,0)/a.length:null;
 const median=a=>{if(!a.length)return null;const v=a.map(x=>x.value).sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
 const stats=a=>{const avg=mean(a);return {games:a.length,average:avg,median:median(a),minimum:a.length?Math.min(...a.map(g=>g.value)):null,maximum:a.length?Math.max(...a.map(g=>g.value)):null,sd:a.length>1?Math.sqrt(a.reduce((s,g)=>s+(g.value-avg)**2,0)/(a.length-1)):null,
  over:line==null?null:a.filter(g=>g.value>line).length,under:line==null?null:a.filter(g=>g.value<line).length,pushes:line==null?null:a.filter(g=>g.value===line).length};};
 const seasonGames=season==null?games:games.filter(g=>String(g.season)===String(season));
 const opponents=[...new Set(games.map(g=>g.opponent).filter(Boolean))];
 return {games,last5:games.slice(0,5),last10:games.slice(0,10),recent5:stats(games.slice(0,5)),recent10:stats(games.slice(0,10)),
  season:stats(seasonGames),splits:{home:stats(seasonGames.filter(g=>g.isHome===true)),away:stats(seasonGames.filter(g=>g.isHome===false)),opponents:opponents.map(opponent=>({opponent,...stats(seasonGames.filter(g=>g.opponent===opponent))}))},
  thresholdBasis:line==null?'NO_MARKET_THRESHOLD':'CURRENT_THRESHOLD_RETROACTIVE',threshold:line,calibratedProbability:null};
}

/** Join ESPN's event dictionary to season-type stat rows by exact event ID. */
export function espnPropHistoryGames(body,{market,sport,season}={}) {
 const metadata=Array.isArray(body.events)?Object.fromEntries(body.events.map(e=>[String(e.id||e.eventId),e])):body.events||{};
 const rows=(body.seasonTypes||[]).flatMap(s=>(s.categories||[]).flatMap(c=>c.events||[]));
 const events=rows.length?rows:Array.isArray(body.events)?body.events:[];
 return events.map(row=>{
  const id=String(row.eventId||row.id||''),event={...metadata[id],...row};
  return {eventId:id,date:event.gameDate||event.date,opponent:event.opponent?.abbreviation,isHome:event.atVs==='vs',season,
   status:event.gameResult?'FINAL':event.status?.type?.completed?'FINAL':undefined,
   value:valueForEspnEvent(body,event,market,sport,'')};
 });
}

const NFL_HISTORY_FIELDS={passing_yards:'passing_yards',passing_attempts:'attempts',completions:'completions',rushing_yards:'rushing_yards',rushing_attempts:'carries',receiving_yards:'receiving_yards',receptions:'receptions',passing_touchdowns:'passing_tds',touchdowns:'total_tds'};
export function nflSnapshotHistoryGames(player,schedule,asOf,field) {
 return (player.recentGames||[]).map(g=>{
  const matches=schedule.filter(x=>Number(x.season)===Number(g.season)&&Number(x.week)===Number(g.week)&&String(x.opponent_key).toUpperCase()===String(g.opponent).toUpperCase());
  const fixture=matches.length===1?matches[0]:null,date=g.date||fixture?.start_time;
  const prior=!date&&Number(g.season)<new Date(asOf).getUTCFullYear();
  return {eventId:g.eventId||fixture?.event_id||`${g.season}-${g.week}`,date:date||null,season:g.season,week:g.week,opponent:g.opponent,
   isHome:fixture?.site==='HOME'?true:['AWAY','ROAD'].includes(fixture?.site)?false:null,value:n(g.stats?.[field]),
   status:date||prior?'FINAL':'UNVERIFIED',temporalBasis:prior?'PRIOR_SEASON_WEEKLY_SNAPSHOT':'EXACT_SCHEDULE_DATE'};
 });
}
async function nflSchedule(env,team,asOf) {
 try{return (await env.DB.prepare('SELECT event_id,season,week,start_time,opponent_key,site FROM nfl_team_schedule_profile WHERE team_key=? AND season>=?').bind(String(team||'').toLowerCase(),new Date(asOf).getUTCFullYear()-1).all()).results||[];}catch{return [];}
}
async function storedNflHistory(env,profile,{playerId,market,asOf,line}) {
 try{
  const raw=JSON.parse(profile?.raw_json||'{}'),player=raw.usage;
  if(!player?.id||String(raw.roster?.id)!==String(playerId)||String(profile.player_id)!==String(playerId)||String(player.team).toUpperCase()!==String(profile.team_key).toUpperCase()||!NFL_HISTORY_FIELDS[market])return null;
  const schedule=await nflSchedule(env,player.team,asOf),games=nflSnapshotHistoryGames(player,schedule,asOf,NFL_HISTORY_FIELDS[market]);
  const summary=historySummary(games,{line,asOf,season:new Date(asOf).getUTCFullYear()});
  if(!summary.games.length)return null;
  return {available:true,identityVerified:true,canonicalPlayerId:`nfl:espn:${playerId}`,source:'Stored nflverse weekly statistics · exact roster/GSIS link',sourceFetchedAt:profile.updated_at,partialSeason:true,...summary,reason:null};
 }catch{return null;}
}
async function get(url,fetchImpl) {
 const cache=typeof caches==='undefined'?null:caches.default;
 const key=new Request(url);const saved=cache?await cache.match(key):null;if(saved)return saved;
 const r=await fetchImpl(url,{headers:{accept:'application/json,text/csv','user-agent':'FBIS/2.0'},signal:AbortSignal.timeout(6500)});
 if(!r.ok)throw Error('HISTORY_SOURCE_HTTP_'+r.status);
 if(cache){const copy=new Response(await r.clone().text(),{headers:{'content-type':'application/json','cache-control':'public,max-age=900'}});try{await cache.put(key,copy);}catch{}}
 return r;
}
export async function loadCanonicalPropHistory(env,{sport,provider,playerId,market,asOf=new Date().toISOString(),line=null,fetchImpl=fetch,profile=null}={}) {
 if(!playerId||!['nflverse','nhl','mlb','espn'].includes(provider))return {available:false,reason:'VERIFIED_HISTORY_ID_REQUIRED'};
 // Preserve the existing NBA provider/rights gate; no alternate-stat backdoor.
 if(sport==='nba')return {available:false,reason:'NBA_RIGHTS_CLEARED_PLAYER_FEED_REQUIRED',source:'NBA_PLAYER_DATA_POLICY'};
 if(sport==='nfl'&&provider==='espn'&&profile){const stored=await storedNflHistory(env,profile,{playerId,market,asOf,line});if(stored)return stored;}
 let games=[],source=null,season=null,identityVerified=false,partial=false;
 try {
  if(provider==='nhl'&&sport==='nhl'&&/^\d+$/.test(playerId)){
   const b=await (await get(`https://api-web.nhle.com/v1/player/${playerId}/game-log/now`,fetchImpl)).json();
   if(String(b.playerId||playerId)!==String(playerId))throw Error('HISTORY_ID_MISMATCH');
   const key={shots_on_goal:'shots',points:'points',goals:'goals',assists:'assists',saves:'saves'}[market];if(!key)return {available:false,reason:'STAT_DEFINITION_UNSUPPORTED'};
   games=(b.gameLog||[]).filter(g=>g.toi!=='0:00').map(g=>({eventId:String(g.gameId),date:g.gameDate,opponent:g.opponentAbbrev,isHome:g.homeRoadFlag==='H',season:b.seasonId,value:n(g[key]),workload:g.toi||null}));
   source='NHL official player game log';season=b.seasonId;identityVerified=true;
  }else if(provider==='mlb'&&sport==='mlb'&&/^\d+$/.test(playerId)){
   const pitching=['strikeouts','pitcher_outs','earned_runs','hits_allowed','walks_allowed'].includes(market);
   const key={strikeouts:'strikeOuts',pitcher_outs:'outs',earned_runs:'earnedRuns',hits_allowed:'hits',walks_allowed:'baseOnBalls',hits:'hits',home_runs:'homeRuns',total_bases:'totalBases',rbis:'rbi',runs:'runs',walks:'baseOnBalls',stolen_bases:'stolenBases'}[market];
   if(!key)return {available:false,reason:'STAT_DEFINITION_UNSUPPORTED'};
   season=new Date(asOf).getUTCFullYear();const b=await(await get(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=${pitching?'pitching':'hitting'}&season=${season}`,fetchImpl)).json();
   games=(b.stats||[]).flatMap(x=>x.splits||[]).map(g=>({eventId:String(g.game?.gamePk),date:g.date,opponent:g.opponent?.name,isHome:g.isHome,season,value:n(g.stat?.[key]),workload:pitching?n(g.stat?.numberOfPitches):n(g.stat?.plateAppearances)}));
   source='MLB official player game log';identityVerified=true;
  }else if(provider==='nflverse'&&sport==='nfl'){
   const field=NFL_HISTORY_FIELDS[market];
   if(!field)return {available:false,reason:'STAT_DEFINITION_UNSUPPORTED'};
   const feed=await loadNflVerseFeatures(env,{forceNetwork:false});const p=Object.values(feed.playersByTeam||{}).flat().find(p=>String(p.id)===String(playerId));
   if(!p)return {available:false,reason:'CANONICAL_PLAYER_NOT_IN_NFLVERSE_SNAPSHOT'};
   games=nflSnapshotHistoryGames(p,await nflSchedule(env,p.team,asOf),asOf,field);
   // A five-game feature snapshot is not the full season.
   source='nflverse exact GSIS player ID';season=new Date(asOf).getUTCFullYear();identityVerified=true;partial=true;
  }else if(provider==='espn'&&['nfl','cfb','cbb','wnba'].includes(sport)&&/^\d+$/.test(playerId)){
   const cfg={nfl:['football','nfl'],cfb:['football','college-football'],cbb:['basketball','mens-college-basketball'],wnba:['basketball','wnba']}[sport];
   season=new Date(asOf).getUTCFullYear();
   const b=await(await get(`https://site.web.api.espn.com/apis/common/v3/sports/${cfg[0]}/${cfg[1]}/athletes/${playerId}/gamelog?season=${season}`,fetchImpl)).json();
   games=espnPropHistoryGames(b,{market,sport,season});
   if(historySummary(games,{asOf}).games.length<5){
    try{const previous=await(await get(`https://site.web.api.espn.com/apis/common/v3/sports/${cfg[0]}/${cfg[1]}/athletes/${playerId}/gamelog?season=${season-1}`,fetchImpl)).json();
     games.push(...espnPropHistoryGames(previous,{market,sport,season:season-1}));}catch{}
   }
   source='ESPN exact roster player ID';identityVerified=true;
  }else return {available:false,reason:'HISTORY_PROVIDER_ADAPTER_UNAVAILABLE'};
  const summary=historySummary(games,{line,asOf,season});
  return {available:summary.games.length>0,identityVerified,canonicalPlayerId:`${sport}:${provider}:${playerId}`,source,sourceFetchedAt:new Date().toISOString(),partialSeason:partial,...summary,
   reason:summary.games.length?null:'NO_VERIFIED_PREGAME_STATISTICS'};
 }catch{return {available:false,reason:'VERIFIED_HISTORY_SOURCE_UNAVAILABLE',source};}
}
export function gradeFrozenProp({prediction,actual,officialVerified=false,contract={}}={}) {
 const start=Date.parse(prediction?.eventStart),frozen=Date.parse(prediction?.frozenAt);
 if(!officialVerified||n(actual)==null||!Number.isFinite(start)||!Number.isFinite(frozen)||frozen>=start)return {graded:false,reason:'OFFICIAL_RESULT_OR_FROZEN_PREGAME_EVIDENCE_REQUIRED'};
 const line=n(contract.threshold),side=contract.statSide;
 const win=line==null?null:side==='over'?actual>line:side==='under'?actual<line:null;
 return {graded:true,actual,forecastError:n(prediction.projection)==null?null:prediction.projection-actual,
  contractResult:line==null||win==null?'UNSUPPORTED':contract.kind==='binary'?(win?'WON':'LOST'):actual===line?'PUSH':win?'WON':'LOST',
  wagerProfit:null,recordedWager:false,canAuthorizeWager:false};
}
