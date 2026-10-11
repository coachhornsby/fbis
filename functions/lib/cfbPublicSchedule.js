import {readCache,writeCache} from './cache.js';
import {mapEvent,shiftDateCT} from './slateEngineCore.js';
import {isFbsVsFbsGame} from './cfbGameVisibility.js';
export async function loadCfbPublicWeek(day,env={},shift=0,fetchFn=fetch) {
  const since=shiftDateCT(day,Number(shift||0)*7),until=shiftDateCT(since,6);
  const key=`cfb-public-week-v1-${since}`;
  const cached=await readCache(key,env.caches,5*60_000);
  if(cached)return cached;
  const days=Array.from({length:7},(_,i)=>shiftDateCT(since,i));
  const responses=await Promise.all(days.map(async day=>{
    const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=1000&dates=${day.replaceAll('-','')}`;
    try {
      const response=await fetchFn(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(9000)});
      if(!response.ok)throw Error(`ESPN public schedule ${response.status}`);
      const bytes=await response.arrayBuffer();if(bytes.byteLength>8*1024*1024)throw Error('Public calendar exceeds bound');
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!Array.isArray(body.events)||body.events.length>=1000)throw Error('Invalid/truncated public calendar');
      return {day,events:body.events,week:body.week?.number||body.events[0]?.week?.number||null};
    }catch(error){return {day,error:String(error?.message||error),events:[]};}
  }));
  if(responses.every(r=>r.error))throw Error(responses.map(r=>r.error).join('; '));
  const gamesById=new Map();
  for(const event of responses.flatMap(r=>r.events)){
    if(event.competitions?.length!==1||event.competitions[0].competitors?.length!==2)continue;
    const game=mapEvent('cfb',event);if(!isFbsVsFbsGame(game))continue;
    const previous=gamesById.get(String(game.id));
    if(previous&&(previous.home.providerTeamId!==game.home.providerTeamId||previous.away.providerTeamId!==game.away.providerTeamId||previous.start!==game.start))throw Error('Conflicting public fixture identities');
    gamesById.set(String(game.id),game);
  }
  const games=[...gamesById.values()];
  const result={games,week:responses.find(r=>r.week)?.week||null,range:{since,until},source:'ESPN_PUBLIC',observedAt:new Date().toISOString(),coverage:{requestedDays:7,successfulDays:responses.filter(r=>!r.error).length,failures:responses.filter(r=>r.error).map(r=>({day:r.day,error:r.error}))}};
  await writeCache(key,result,env.caches,5*60_000);return result;
}
