import { resolveNbaResearchOwnerDb } from '../lib/nbaResearchOwnerDb.js';
import { extractNbaOfficialBoxscore } from '../lib/nbaOfficialPropTotals.js';
const respond=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'public,max-age=60'}});
export async function onRequestGet({env,request,fetchImpl=fetch}){
 const q=new URL(request.url).searchParams,date=q.get('date'),eventId=q.get('eventId');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||eventId&&!/^\d+$/.test(eventId))
  return respond({ok:false,error:'Invalid NBA game date or event ID'},400);
 const owner=await resolveNbaResearchOwnerDb(env);
 if(!owner.ok)return respond({ok:false,reason:'NBA_DATA_OWNER_UNAVAILABLE',rows:[]},503);
 let games=[];
 try{
  const result=await owner.db.prepare("SELECT id,home_id,away_id,home_abbr,away_abbr,start FROM games WHERE sport='nba' AND date=? ORDER BY start LIMIT 15").bind(date).all();
  games=(result.results||[]).filter(g=>/^\d+$/.test(String(g.id))&&
   (!eventId||String(g.id)===eventId)&&Number.isFinite(Date.parse(g.start))&&Date.parse(g.start)<Date.now());
 }catch{return respond({ok:false,reason:'NBA_GAMES_READ_FAILED',rows:[]},503)}
 const pending=[],rows=[];
 await Promise.all(games.map(async g=>{
  try{
   const uri='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+encodeURIComponent(g.id);
   const res=await fetchImpl(uri,{method:'GET',headers:{accept:'application/json'},redirect:'manual',
    signal:AbortSignal.timeout(8000)});
   if(!res.ok){pending.push({eventId:g.id,status:'OFFICIAL_SOURCE_UNAVAILABLE'});return;}
   const evidence=extractNbaOfficialBoxscore(await res.json(),{eventId:g.id,homeId:g.home_id,awayId:g.away_id,homeAbbr:g.home_abbr,awayAbbr:g.away_abbr});
   if(!evidence.ok){pending.push({eventId:g.id,status:evidence.reason});return;}
   rows.push(...evidence.rows);
  }catch{pending.push({eventId:g.id,status:'OFFICIAL_SOURCE_UNAVAILABLE'});}
 }));
 return respond({ok:true,date,rows,checkedGames:games.length,
  officialFinalGames:new Set(rows.map(r=>r.eventId)).size,
  pending,source:'ESPN_NBA_FINAL_BOXSCORE',canQualify:false,canAuthorizeWager:false});
}
