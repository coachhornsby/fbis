/** Official identities and schedule-confirmed appearances. No market inputs. */
export const MLB_HISTORY_VERSION = 'mlb-appearance-v1';
export const MLB_GAME_TYPES = Object.freeze({S:'SPRING_TRAINING',R:'REGULAR_SEASON',F:'WILD_CARD',D:'DIVISION_SERIES',L:'CHAMPIONSHIP_SERIES',W:'WORLD_SERIES',E:'EXHIBITION',A:'ALL_STAR'});
export const MLB_COMPETITIVE_TYPES = Object.freeze(['R','F','D','L','W']);
export const isMlbPostseason = type => ['F','D','L','W'].includes(type);
const n=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function mlbInningsToOuts(value) {
 if(value==null||value==='')return null;
 const match=String(value).match(/^(\d+)(?:\.([012]))?$/);
 return match?Number(match[1])*3+Number(match[2]||0):null;
}
export function mlbOutsToInnings(value) {
 return Number.isInteger(value)&&value>=0?`${Math.floor(value/3)}.${value%3}`:null;
}
export function mlbMarketDefinition(market) {
 const fields={hits:['hits'],home_runs:['homeRuns'],total_bases:['totalBases'],runs:['runs'],rbis:['rbi'],walks:['baseOnBalls'],stolen_bases:['stolenBases'],hits_runs_rbis:['hits','runs','rbi'],hits_runs_rbi:['hits','runs','rbi'],strikeouts:['strikeOuts'],pitcher_outs:['outs'],earned_runs:['earnedRuns'],hits_allowed:['hits'],walks_allowed:['baseOnBalls'],pitch_count:['numberOfPitches']};
 return fields[market]?{fields:fields[market],group:['strikeouts','pitcher_outs','earned_runs','hits_allowed','walks_allowed','pitch_count'].includes(market)?'pitching':'hitting'}:null;
}
export function mlbStatValue(stat,market) {
 const def=mlbMarketDefinition(market);if(!def)return null;
 const values=def.fields.map(k=>k==='outs'?(n(stat?.outs)??mlbInningsToOuts(stat?.inningsPitched)):n(stat?.[k]));
 return values.every(v=>v!=null)?values.reduce((a,b)=>a+b,0):null;
}
export function mlbScheduleIndex(payload) {
 return new Map((payload?.dates||[]).flatMap(d=>d.games||[]).map(g=>[String(g.gamePk),g]));
}
export function normalizeMlbAppearances(splits,schedule,{playerId,market,asOf,observedAt=new Date().toISOString()}={}) {
 const def=mlbMarketDefinition(market),cutoff=Date.parse(asOf),seen=new Set();if(!def||!Number.isFinite(cutoff))return [];
 return splits.flatMap(split=>{
  const id=String(split.game?.gamePk||''),game=schedule.get(id),stat=split.stat||{};
  if(!id||!game||seen.has(id)||!MLB_COMPETITIVE_TYPES.includes(game.gameType)||game.status?.abstractGameState!=='Final'||game.status?.codedGameState!=='F')return [];
  if(split.player?.id&&String(split.player.id)!==String(playerId))return [];
  const date=game.officialDate||split.date,start=game.gameDate;
  // Final status alone cannot prove completion before an intraday historical cutoff.
  // Require a recorded endTime for same-day games; older final dates are sufficient for display.
  if(!date||!start||Date.parse(start)>=cutoff||date>=asOf.slice(0,10)&&!(game.gameEndDate&&Date.parse(game.gameEndDate)<cutoff))return [];
  const appeared=def.group==='pitching'?(n(stat.gamesPitched)>0||n(stat.battersFaced)>0||n(stat.numberOfPitches)>0||mlbInningsToOuts(stat.inningsPitched)>0):n(stat.plateAppearances)>0;
  const value=mlbStatValue(stat,market);if(!appeared||value==null)return [];
  const own=split.isHome===true?game.teams?.home?.team:split.isHome===false?game.teams?.away?.team:null;
  if(!own||!split.team?.id||String(own.id)!==String(split.team.id))return [];
  const opponent=split.isHome?game.teams?.away?.team:game.teams?.home?.team;
  seen.add(id);
  return [{eventId:id,gameId:id,playerId:String(playerId),date,start,gameNumber:game.gameNumber||split.gameNumber||1,season:Number(game.season||date.slice(0,4)),gameType:game.gameType,gameTypeLabel:MLB_GAME_TYPES[game.gameType]||'OTHER',teamId:String(own.id),opponentId:String(opponent?.id||''),opponent:opponent?.abbreviation||opponent?.name||split.opponent?.name,isHome:split.isHome,status:'FINAL',finalizationStatus:'OFFICIAL_SCHEDULE_FINAL',value,workload:n(def.group==='pitching'?stat.numberOfPitches:stat.plateAppearances),source:'MLB_STATS_API',sourceUrl:`https://statsapi.mlb.com/api/v1/game/${id}/boxscore`,sourceObservedAt:observedAt}];
 }).sort((a,b)=>Date.parse(b.start)-Date.parse(a.start)||b.gameNumber-a.gameNumber);
}
export async function fetchMlbPlayerHistory({playerId,market,asOf,read,scope='auto'}) {
 const def=mlbMarketDefinition(market);if(!def)return {unsupported:true};
 const season=new Date(asOf).getUTCFullYear();
 const [logSets,schedule]=await Promise.all([
  Promise.all(MLB_COMPETITIVE_TYPES.map(type=>read(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=${def.group}&season=${season}&gameType=${type}`))),
  read(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameTypes=R,F,D,L,W`),
 ]);
 const games=normalizeMlbAppearances(logSets.flatMap(logs=>logs.stats||[]).filter(s=>!s.group?.displayName||s.group.displayName===def.group).flatMap(s=>s.splits||[]),mlbScheduleIndex(schedule),{playerId,market,asOf});
 const postseason=games.filter(g=>isMlbPostseason(g.gameType));
 const playoffStarted=[...mlbScheduleIndex(schedule).values()].some(g=>isMlbPostseason(g.gameType)&&Date.parse(g.gameDate)<Date.parse(asOf));
 const selectedScope=scope==='auto'?(playoffStarted?'POSTSEASON':'REGULAR_SEASON'):scope;
 return {season,allGames:games,games:selectedScope==='POSTSEASON'?postseason:selectedScope==='COMPETITIVE_RECENT'?games:games.filter(g=>g.gameType==='R'),scope:selectedScope,version:MLB_HISTORY_VERSION};
}
