import {listMarketHistoryReadDbs} from './databaseTopology.js';
/** Read only contract metadata already captured by the REST owner. No provider calls. */
export async function capturedPolymarketStreamRoster(env,fixtures,{now=new Date()}={}){
 const since=new Date(now.getTime()-72*3600000).toISOString(),until=now.toISOString();
 const permitted=new Map(fixtures.map(g=>[g.sport+'|'+String(g.id),g]));
 const byMarket=new Map(),errors=[];
 const stores=[...listMarketHistoryReadDbs(env),{binding:'DB',db:env.DB}].filter(p=>p.db?.prepare);
 for(const part of stores){
  try{
   const indexes=(await part.db.prepare('PRAGMA index_list(normalized_market_observations)').all()).results||[];
   const names=new Set(indexes.map(x=>x.name));
   const index=['idx_norm_market_event_time','idx_shard_market_event'].find(n=>names.has(n));
   const clause=index?' INDEXED BY '+index:'';
   for(const sport of [...new Set(fixtures.map(g=>g.sport))]){
    const ids=fixtures.filter(g=>g.sport===sport).map(g=>String(g.id));
    for(let start=0;start<ids.length;start+=40){
     const chunk=ids.slice(start,start+40);
     const sql=`WITH recent AS (SELECT sport,league,canonical_event_id,provider_event_id,event_start_time,
       home_team,away_team,market_family,side,line,period,source_market_id,source_outcome_id,collected_at,
       json_extract(raw_payload_json,'$.canonicalSide') canonical_side,
       json_extract(raw_payload_json,'$.opposite') opposite_json,
       json_extract(raw_payload_json,'$.providerMarket.feeCoefficient') fee_coefficient,
       ROW_NUMBER() OVER(PARTITION BY source_market_id ORDER BY collected_at DESC,id DESC) rn
       FROM normalized_market_observations${clause}
       WHERE sport=? AND canonical_event_id IN (${chunk.map(()=>'?').join(',')})
       AND source='Polymarket US' AND collected_at BETWEEN ? AND ?
       AND market_family IN ('moneyline','spread','total')
       AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.contractLong')=1)
       SELECT * FROM recent WHERE rn=1 LIMIT 20001`;
     const rows=(await part.db.prepare(sql).bind(sport,...chunk,since,until).all()).results;
     if(!Array.isArray(rows)||rows.length>20000)throw Error('STREAM_ROSTER_SCOPE_EXCEEDED');
     for(const row of rows){
      const game=permitted.get(row.sport+'|'+String(row.canonical_event_id));
      if(!game||!/^[-a-z0-9]{1,160}$/i.test(row.source_market_id||'')||Math.abs(Date.parse(game.start)-Date.parse(row.event_start_time))>60000||!Number.isFinite(Date.parse(row.event_start_time)))continue;
      const old=byMarket.get(row.source_market_id);
      if(!old||row.collected_at>old.collected_at){let opposite=null;try{opposite=JSON.parse(row.opposite_json||'null')}catch{}
       const {opposite_json,rn,...safe}=row;byMarket.set(row.source_market_id,{...safe,opposite});}
     }
    }
   }
  }catch(error){errors.push({binding:part.binding,reason:error.message==='STREAM_ROSTER_SCOPE_EXCEEDED'?error.message:'STREAM_ROSTER_STORE_UNAVAILABLE'});}
 }
 if(byMarket.size>20000)throw Error('STREAM_ROSTER_SCOPE_EXCEEDED');
 return {roster:[...byMarket.values()],errors};
}
