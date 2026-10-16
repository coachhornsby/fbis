/**
 * Quota-friendly PinnOdds ingestion:
 * fetch one complete $0 board, retain its immutable raw source in R2, but
 * persist only independently projected canonical FBIS events and game markets.
 * A forecast must predate BOTH the provider capture and the event start.
 * Never use PinnOdds prices as model input or as retroactive prediction proof.
 */
const GAME_MARKETS = new Set(['moneyline','spread','total']);
const CHUNK_SIZE = 70;
const validTime = x => { const n=Date.parse(String(x||'')); return Number.isFinite(n)?n:null; };
export async function filterPinnoddsToFbisProjections(db, rows, {capturedAt}={}) {
 if(!db?.prepare || validTime(capturedAt)===null) throw Error('PINNODDS_MODELED_SCOPE_DB_OR_CLOCK_REQUIRED');
 if(!Array.isArray(rows))throw Error('PINNODDS_MODELED_SCOPE_ROWS_REQUIRED');
 const candidates=rows.filter(r=>r?.eventId && r.sport && GAME_MARKETS.has(r.marketFamily) && validTime(r.eventStart)!==null);
 const bySport=new Map();
 for(const r of candidates){
   if(!bySport.has(r.sport))bySport.set(r.sport,new Set());
   bySport.get(r.sport).add(String(r.eventId));
 }
 const supported=new Map();
 let evaluated=0;
 for(const [sport,set] of bySport){
  const ids=[...set];
  for(let i=0;i<ids.length;i+=CHUNK_SIZE){
   const chunk=ids.slice(i,i+CHUNK_SIZE),placeholders=chunk.map(()=>'?').join(',');
   const queries=[
    {
     sql:`SELECT game_id AS event_id,MIN(frozen_at) AS model_at FROM prediction_snapshots
      WHERE sport=? AND game_id IN (${placeholders}) AND frozen_at<=?
      AND model_version IS NOT NULL AND TRIM(model_version)<>''
      AND (projection_kind IS NULL OR UPPER(projection_kind) NOT IN
           ('PINNACLE_IMPLIED','MARKET_IMPLIED','UNAVAILABLE','MISSING'))
      AND (proj_total IS NOT NULL OR (proj_home IS NOT NULL AND proj_away IS NOT NULL)
           OR p_home_final BETWEEN 0 AND 1)
      GROUP BY game_id`,
     binds:[sport,...chunk,capturedAt]
    },
    {
     sql:`SELECT game_id AS event_id,MIN(published_at) AS model_at FROM published_projections
      WHERE sport=? AND game_id IN (${placeholders}) AND published_at<=?
       AND json_valid(payload_json)
       AND json_extract(payload_json,'$.model.independent')=1
      GROUP BY game_id`,
     binds:[sport,...chunk,capturedAt]
    }
   ];
   if(sport==='tennis')queries.push({
    sql:`SELECT canonical_event_id AS event_id,MIN(decision_timestamp) AS model_at
      FROM tennis_v2_research_decisions
      WHERE canonical_event_id IN (${placeholders}) AND decision_timestamp<=?
       AND pure_p1 BETWEEN 0 AND 1 GROUP BY canonical_event_id`,
    binds:[...chunk,capturedAt]
   });
   for(const q of queries){
    const result=await db.prepare(q.sql).bind(...q.binds).all();
    for(const row of result?.results||[]){
     const at=validTime(row.model_at);
     if(at===null||at>validTime(capturedAt))continue;
     const key=sport+'|'+String(row.event_id);
     const prior=supported.get(key);
     if(prior==null||at<prior)supported.set(key,at);
    }
    evaluated++;
   }
  }
 }
 const selected= candidates.filter(row=>{
   const modelAt=supported.get(row.sport+'|'+String(row.eventId));
   return modelAt!=null && modelAt<validTime(row.eventStart);
 });
 return {
   rows:selected,
   inputRows:rows.length,
   projectedEventCount:new Set(selected.map(r=>r.sport+'|'+String(r.eventId))).size,
   providerEventCount:new Set(rows.map(r=>r.raw?.providerEventId).filter(Boolean)).size,
   rejectedNoCanonicalOrModel:rows.length-selected.length,
   omittedNonGameMarkets:rows.filter(r=>r?.eventId && !GAME_MARKETS.has(r.marketFamily)).length,
   modelEvidenceQueries:evaluated,
   ingestionScope:'IMMUTABLE_FULL_BOARD_FETCH_FBISEXISTING_PROJECTIONS_GAME_MARKETS',
   modelClockPolicy:'PRE_CAPTURE_AND_PRE_START',
   readOnly:true,canAuthorizeWager:false
 };
}
