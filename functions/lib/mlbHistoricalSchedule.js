/** A resumed game can appear twice in schedule dates; its official game date owns the archive. */
export function mlbCanonicalScheduleDays(schedule){
 if(!Array.isArray(schedule?.dates)||!Number.isFinite(schedule.totalGames))throw Error('INVALID_OFFICIAL_SCHEDULE');
 const records=new Map();
 for(const day of schedule.dates)for(const game of day.games||[]){
  const date=game.officialDate||day.date,id=String(game.gamePk||'');
  if(!/^\d+$/.test(id)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))throw Error('INVALID_OFFICIAL_GAME_IDENTITY');
  const previous=records.get(id);if(previous&&previous.date!==date)throw Error('CONFLICTING_OFFICIAL_GAME_DATE');
  const final=game.status?.codedGameState==='F'||previous?.final===true;
  const pending=!final&&!/postponed|cancelled|canceled/i.test(game.status?.detailedState||'');records.set(id,{date,id,final,pending});
 }
 const gamesByDate=new Map(),pendingByDate=new Map();for(const r of records.values()){
  const map=r.final?gamesByDate:r.pending?pendingByDate:null;if(!map)continue;const ids=map.get(r.date)||[];ids.push(r.id);map.set(r.date,ids);
 }
 return {gamesByDate,pendingByDate};
}
