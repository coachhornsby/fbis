/** Storage partition only. Current rows stay on primary; frozen RESEARCH rows
 * come from the verified cold copy. No prices, clocks or authority are altered.
 */
import { listMarketHistoryReadDbs, resolveMarketHistoryWriteDb } from "./databaseTopology.js";
export const COLD_MARKET_SOURCE_UPPER=667201;
export const COLD_MARKET_CAPTURE_CUTOFF='2026-10-16T01:35:42.412Z';
export const coldHistoryEnabled=env=>env?.COLD_MARKET_ARCHIVE_READS==='enabled';
const digestPattern=/^[a-f0-9]{64}$/;
export async function coldMarketPartitions(env){
 if(!coldHistoryEnabled(env))return [{db:env.DB,where:'1=1',kind:'primary'}];
 if(!env.COLD_HISTORY_DB?.prepare)throw Error('COLD_HISTORY_BINDING_REQUIRED');
 const receipt=await env.COLD_HISTORY_DB.prepare("SELECT * FROM storage_archive_acceptance WHERE id='market-20261017'").first();
 if(receipt?.state!=='COPY_VERIFIED'||receipt.source_upper_rowid!==COLD_MARKET_SOURCE_UPPER||receipt.source_rows!==667201||receipt.research_rows!==497624||receipt.drive_verified!==1||!digestPattern.test(receipt.manifest_sha256||''))throw Error('COLD_HISTORY_NOT_QUALIFIED');
 return [
  {db:env.DB,where:`NOT (snapshot_type='RESEARCH' AND rowid<=${COLD_MARKET_SOURCE_UPPER})`,kind:'primary'},
  {db:env.COLD_HISTORY_DB,where:"snapshot_type='RESEARCH'",kind:'cold'}
 ];
}
/** Existing retrospective replays retain their original captured timestamp.
 * Route only those old RESEARCH writes after qualified storage cutover.
 * New RESEARCH/HISTORICAL volume prefers the newest under-capacity market-history
 * partition (2026Q4 when bound); legacy MARKET_HISTORY_DB remains a read source.
 * CURRENT quotes remain on primary.
 */
export async function marketObservationDatabase(env,capturedAt,snapshotType='RESEARCH'){
 const snap=String(snapshotType||'RESEARCH').toUpperCase();
 if(coldHistoryEnabled(env)&&snap==='RESEARCH'&&Number.isFinite(Date.parse(capturedAt))&&Date.parse(capturedAt)<=Date.parse(COLD_MARKET_CAPTURE_CUTOFF)){
  await coldMarketPartitions(env);return env.COLD_HISTORY_DB;
 }
 if(snap==='RESEARCH'||snap==='HISTORICAL'){
  const target=await resolveMarketHistoryWriteDb(env,{now:capturedAt||new Date()});
  if(target.db)return target.db;
  // A rejected history partition must never spill into a full legacy D1 or
  // into the primary operational database. Preserve the resolver's fail-closed gate.
  throw new Error(target.warning || 'MARKET_HISTORY_WRITE_UNAVAILABLE_FAIL_CLOSED');
 }
 return env.DB;
}
export async function readPartitionedMirrorCoverage(env,source,sport){
 let n=0,collected=null,observed=null;
 for(const part of await coldMarketPartitions(env)){
  const row=await part.db.prepare(`SELECT COUNT(*) n,MAX(collected_at) collected_at,MAX(source_observed_at) observed_at FROM normalized_market_observations WHERE source=? AND sport=? AND (${part.where})`).bind(source,sport).first();
  n+=Number(row?.n)||0;if(row?.collected_at&&(collected===null||row.collected_at>collected))collected=row.collected_at;if(row?.observed_at&&(observed===null||row.observed_at>observed))observed=row.observed_at;
 }
 return {n,collected_at:collected,observed_at:observed};
}
const encoder=new TextEncoder();
export function sqliteBinaryCompare(a,b){
 if(a===b)return 0;if(a==null)return-1;if(b==null)return 1;
 if(typeof a==='number'&&typeof b==='number')return a<b?-1:1;
 const x=encoder.encode(String(a)),y=encoder.encode(String(b));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return x.length<y.length?-1:1;
}
const eventPartition=['source','source_market_id','source_outcome_id','period','side','line','player_name','stat_family'];
const eventOrder=['source','market_family','period','source_market_id','source_outcome_id','id'];
export function mergeLatestEventObservations(groups){
 const chosen=new Map();
 for(const row of groups.flat()){
  const key=JSON.stringify(eventPartition.map(k=>row[k]??null)),previous=chosen.get(key);
  if(!previous||sqliteBinaryCompare(row.collected_at,previous.collected_at)>0||(row.collected_at===previous.collected_at&&sqliteBinaryCompare(row.id,previous.id)>0))chosen.set(key,row);
 }
 return [...chosen.values()].sort((a,b)=>{for(const key of eventOrder){const c=sqliteBinaryCompare(a[key],b[key]);if(c)return c;}return 0;});
}
const projection=`id,source,sport,canonical_event_id,player_name,market_family,stat_family,side,line,period,
 american_odds,decimal_odds,contract_price,source_market_id,source_outcome_id,source_observed_at,collected_at,event_start_time,
 CASE WHEN json_valid(raw_payload_json) THEN json_type(raw_payload_json,'$.sourceObservedAt') ELSE NULL END __raw_clock_type,
 CASE WHEN json_valid(raw_payload_json) THEN json_extract(raw_payload_json,'$.sourceObservedAt','$.quoteProvenance','$.quoteKind','$.priceKind') ELSE '[null,null,null,null]' END __raw_meta`;
export async function readColdCompatibleEventObservations(env,{sport,eventId,offset=0,pageSize=100}){
 const partitions=await coldMarketPartitions(env),groups=[];
 // Current recovery ticks and newer research captures live in the market shard,
 // independently of the older immutable cold-archive cutover.
 for(const hist of listMarketHistoryReadDbs(env))partitions.push({db:hist.db,where:'1=1',kind:hist.binding});
 for(const part of partitions){
  const result=await part.db.prepare(`WITH latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period,side,line,player_name,stat_family ORDER BY collected_at DESC,id DESC) rn
    FROM normalized_market_observations WHERE sport=? AND canonical_event_id=? AND (${part.where}) AND source IN ('Polymarket US','Polymarket US WebSocket','PinnOdds','PrizePicks GitHub Mirror'))
    SELECT ${projection} FROM latest WHERE rn=1 ORDER BY source,market_family,period,source_market_id,source_outcome_id,id LIMIT 10001`).bind(sport,eventId).all();
  if(!Array.isArray(result?.results)||result.results.length>10000)throw Error('HISTORICAL_EVENT_QUERY_BUDGET_EXCEEDED');
  groups.push(result.results.map(row=>{
   const m=JSON.parse(row.__raw_meta),raw={quoteProvenance:m[1],quoteKind:m[2],priceKind:m[3]};if(row.__raw_clock_type!==null)raw.sourceObservedAt=m[0];
   return {...row,raw_payload_json:JSON.stringify(raw)};
  }));
 }
 const rows=mergeLatestEventObservations(groups),found=rows.slice(offset,offset+pageSize+1);return {results:found};
}

const reconcileKeys=['source','source_market_id','source_outcome_id','period','side','line'];
const reconcileIdentity=r=>JSON.stringify(reconcileKeys.map(k=>r[k]??null));
const reconcileCompare=(a,b)=>sqliteBinaryCompare(a.collected_at,b.collected_at)||((a.canonical_event_id==null?0:1)-(b.canonical_event_id==null?0:1))||sqliteBinaryCompare(a.id,b.id);
/** Preserve cursor-based historical reconciliation and suppress versions
 * superseded by an identity match in the other storage partition.
 */
export async function readColdCompatibleReconcilePage(env,{from,until,now,afterId,limit}){
 const parts=await coldMarketPartitions(env),candidates=[];
 for(const part of parts){
  const r=await part.db.prepare(`WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period,side,line ORDER BY collected_at DESC,CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END,id DESC) rn
   FROM normalized_market_observations WHERE sport='soccer' AND source IN ('PinnOdds','Polymarket US','Polymarket US WebSocket') AND (${part.where}) AND event_start_time BETWEEN ? AND ? AND collected_at<=?)
   SELECT * FROM ranked WHERE rn=1 AND canonical_event_id IS NULL AND id>? ORDER BY id LIMIT ?`).bind(from,until,now,afterId,limit+1).all();
  if(!Array.isArray(r?.results))throw Error('HISTORICAL_RECONCILE_QUERY_FAILED');candidates.push(...r.results);
 }
 candidates.sort((a,b)=>sqliteBinaryCompare(a.id,b.id));const scan=candidates.slice(0,limit),identities=[...new Map(scan.map(r=>[reconcileIdentity(r),r])).values()],best=new Map();
 for(let i=0;i<identities.length;i+=15){
  const group=identities.slice(i,i+15),predicates=group.map(()=> '('+reconcileKeys.map(k=>k+' IS ?').join(' AND ')+')').join(' OR '),args=group.flatMap(r=>reconcileKeys.map(k=>r[k]??null));
  for(const part of parts){
   const r=await part.db.prepare(`WITH ranked AS (SELECT id,source,source_market_id,source_outcome_id,period,side,line,canonical_event_id,collected_at,
    ROW_NUMBER() OVER(PARTITION BY source,source_market_id,source_outcome_id,period,side,line ORDER BY collected_at DESC,CASE WHEN canonical_event_id IS NULL THEN 1 ELSE 0 END,id DESC) rn
    FROM normalized_market_observations WHERE sport='soccer' AND (${part.where}) AND event_start_time BETWEEN ? AND ? AND collected_at<=? AND (${predicates})) SELECT * FROM ranked WHERE rn=1`).bind(from,until,now,...args).all();
   for(const row of r?.results||[]){const key=reconcileIdentity(row),old=best.get(key);if(!old||reconcileCompare(row,old)>0)best.set(key,row);}
  }
 }
 const rows=scan.filter(r=>best.get(reconcileIdentity(r))?.id===r.id);
 return {rows,nextCursor:scan.length===limit?scan.at(-1).id:null};
}
