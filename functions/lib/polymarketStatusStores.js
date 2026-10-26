import {listMarketHistoryReadDbs} from './databaseTopology.js';
/** Physical capture counts; event/contract counts are unions across storage. */
export async function polymarketStatusStores(env,{now=new Date()}={}){
 const stores=[{binding:'DB',db:env.DB},...listMarketHistoryReadDbs(env)].filter((p,i,a)=>p.db?.prepare&&a.findIndex(x=>x.db===p.db)===i);
 const rows=[],errors=[];
 const cutoff=new Date(now.getTime()-24*3600000).toISOString();
 for(const p of stores){try{
  const result=await p.db.prepare(`SELECT sport,source,COUNT(*) observations,MAX(collected_at) last_capture,
   json_group_array(DISTINCT provider_event_id) provider_ids,json_group_array(DISTINCT canonical_event_id) event_ids,
   json_group_array(DISTINCT source_market_id) market_ids,
   SUM(CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END) unmatched_observations,
   SUM(CASE WHEN contract_price IS NOT NULL THEN 1 ELSE 0 END) displayed_prices,
   SUM(CASE WHEN event_start_time>=? THEN 1 ELSE 0 END) upcoming_observations
   FROM normalized_market_observations WHERE source IN ('Polymarket US','Polymarket US WebSocket') AND collected_at>=? GROUP BY sport,source`).bind(now.toISOString(),cutoff).all();
  if(!Array.isArray(result.results))throw Error();
  rows.push(...result.results.map(r=>({...r,binding:p.binding})));
 }catch{errors.push({binding:p.binding,reason:'MARKET_STATUS_STORE_UNAVAILABLE'});}}
 const merge=(source,sport=null,historyOnly=false)=>{
  const part=rows.filter(r=>r.source===source&&(!sport||r.sport===sport)&&(!historyOnly||r.binding!=='DB'));
  const ids=key=>new Set(part.flatMap(r=>JSON.parse(r[key]||'[]').filter(x=>x!=null).map(x=>r.sport+'|'+x)));
  return {observations:part.reduce((n,r)=>n+Number(r.observations||0),0),last_capture:part.map(r=>r.last_capture).filter(Boolean).sort().at(-1)||null,
   provider_events:ids('provider_ids').size,matched_games:ids('event_ids').size,contracts:ids('market_ids').size,
   unmatched_observations:part.reduce((n,r)=>n+Number(r.unmatched_observations||0),0),displayed_prices:part.reduce((n,r)=>n+Number(r.displayed_prices||0),0),
   upcoming_observations:part.reduce((n,r)=>n+Number(r.upcoming_observations||0),0),sports:new Set(part.map(r=>r.sport)).size};
 };
 return {merge,errors,bindings:stores.map(p=>p.binding),countKind:'PHYSICAL_CAPTURE_ROWS_UNIQUE_EVENT_CONTRACT_UNIONS'};
}
