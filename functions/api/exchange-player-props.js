import {readCache,writeCache} from "../lib/cache.js";
import {buildTodayBoard,resolveTodayDate} from '../lib/todayBoard.js';
import {todayEnv} from './today.js';
import {loadKalshiPlayerProps,polymarketPropRow} from '../lib/exchangePlayerProps.js';
import {chicagoDayBounds} from '../lib/chicagoDayBounds.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestGet(context){
 const u=new URL(context.request.url),resolved=resolveTodayDate(u.searchParams.get('date')||'');if(!resolved.ok)return json({ok:false,error:resolved.error,rows:[]},400);
 const sport=String(u.searchParams.get('sport')||'all').toLowerCase();
 const cacheKey='exchange-prop-board-v1:'+resolved.date+':'+sport;const cached=await readCache(cacheKey,caches.default,20000);if(cached)return json(cached);
 const board=await buildTodayBoard(resolved.date,todayEnv(context),{focusSport:sport});
 const modelFailures=[];
 let games=(board.games||[]).filter(g=>sport==='all'||g.sport===sport);
 if(sport==='all'){
  const sports=[...new Set(games.filter(g=>!(g.playerProjectionRows||[]).length).map(g=>g.sport))];
  for(let i=0;i<sports.length;i+=3){const loaded=await Promise.allSettled(sports.slice(i,i+3).map(s=>buildTodayBoard(resolved.date,todayEnv(context),{focusSport:s})));
   for(const result of loaded){if(result.status==='rejected'){modelFailures.push(String(result.reason?.message||result.reason));continue;}for(const game of result.value.games||[]){const index=games.findIndex(g=>String(g.id)===String(game.id)&&g.sport===game.sport);if(index>=0)games[index]=game;}}
  }
 }
 const result=await loadKalshiPlayerProps(games,{date:resolved.date,caches:caches.default}).catch(e=>({rows:[],coverage:{source:'Kalshi',error:String(e.message)}}));
 // Existing Polymarket US ingestion is the only authority for its delivered props.
 // Never relabel a game market or display probability as an executable prop quote.
 const bounds=chicagoDayBounds(resolved.date);const coverage=[];
 const marketSports=[...new Set(games.map(g=>g.sport))];
 for(const [name,db] of [['PRIMARY_D1',context.env.DB],['MARKET_HISTORY',context.env.MARKET_HISTORY_DB]])if(db?.prepare&&marketSports.length){try{
 const stats=await db.prepare(`SELECT * FROM normalized_market_observations WHERE source IN ('Polymarket US','Polymarket US WebSocket') AND sport IN (${marketSports.map(()=>'?').join(',')}) AND market_family='player_prop' AND julianday(event_start_time)>=julianday(?) AND julianday(event_start_time)<julianday(?) AND collected_at>=? AND collected_at<=? ORDER BY collected_at DESC LIMIT 1000`).bind(...marketSports,bounds.start,bounds.end,new Date(Date.now()-3600000).toISOString(),new Date().toISOString()).all();
 const observations=stats?.results||[];for(const o of observations){const row=polymarketPropRow(o,games);if(row)result.rows.push(row);}
 coverage.push({store:name,propObservations:observations.length});
 }catch(e){coverage.push({store:name,error:String(e.message)});}}
 const unique=new Map();for(const row of result.rows){const key=[row.venue,row.sourceMarketId,row.contractSide,row.line].join('|');const old=unique.get(key);if(!old||Date.parse(row.collected_at)>Date.parse(old.collected_at))unique.set(key,row);}
 const ranked=[...unique.values()].sort((a,b)=>(b.contractEconomics?.profitQualified?1:0)-(a.contractEconomics?.profitQualified?1:0)||(b.confidence_stars||0)-(a.confidence_stars||0));
 const rows=ranked.slice(0,u.searchParams.get("mode")==="top25"?25:250);
 const response={ok:true,date:resolved.date,rows,count:rows.length,venues:['Kalshi','Polymarket US'],coverage:{models:{games:games.length,withModels:games.filter(g=>(g.playerProjectionRows||[]).length).length,failures:modelFailures},kalshi:result.coverage,polymarket:{source:'Polymarket US',stores:coverage,status:result.rows.some(r=>r.venue==='Polymarket US')?'DELIVERED':'PLAYER_PROP_DELIVERY_NOT_VERIFIED'}},policy:{prizePicksExecution:false,pickemPayoutRules:false,canAuthorizeWager:false}};
 await writeCache(cacheKey,response,caches.default,20000);return json(response);
}
