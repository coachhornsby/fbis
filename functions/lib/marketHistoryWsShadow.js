/** Additive WebSocket-only market evidence shadow mirror.
 * Canonical primary-D1 insertion must finish before this runs.
 * Neither full source nor betting decisions are ever removed or redirected.
 * A failure must be surfaced to operators; never lose the canonical insert.
 */
import {isD1CapacityError} from "./d1Capacity.js";
const ORIGIN_DB="b50c724c-903b-4241-8ce1-48d931e7a44c";
const WS_SOURCE="Polymarket US WebSocket";
const BATCH="FBIS_WS_DUAL_SHADOW_20261016_V1";
const fail=(s)=>{throw Error("SHADOW_WS_"+s)};
async function hash(text){
 const x=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(text)));
 return Array.from(new Uint8Array(x),n=>n.toString(16).padStart(2,"0")).join("");
}
async function all(db,sql,...params){
 if(!db?.prepare)fail("BINDING_MISSING");
 const st=db.prepare(sql),q=params.length?st.bind(...params):st;
 const r=await q.all();
 if(!Array.isArray(r?.results))fail("QUERY_UNAVAILABLE");
 return r.results;
}
export async function mirrorVerifiedWsObservations(env,ids=[]){
 if(env?.MARKET_HISTORY_SHADOW_WS!=="enabled")return {state:"OFF",attempted:0,verified:0,sourceRowsDeleted:0};
 if(!env?.DB?.prepare||!env?.MARKET_HISTORY_DB?.prepare)fail("BINDING_MISSING");
 if(!Array.isArray(ids)||!ids.length||ids.length>16||ids.some(x=>!/^nmo_[0-9a-f]{28}$/.test(String(x))))fail("INVALID_ID_SCOPE");
 const unique=[...new Set(ids)];
 const [pcols,scols]=await Promise.all([
  all(env.DB,"PRAGMA table_info(normalized_market_observations)"),
  all(env.MARKET_HISTORY_DB,"PRAGMA table_info(normalized_market_observations)")
 ]);
 const columns=pcols.map(r=>r.name);
 if(columns.length!==50||JSON.stringify(columns)!==JSON.stringify(scols.map(r=>r.name)))fail("SCHEMA_DRIFT");
 const source=await all(env.DB,"SELECT rowid AS __source_rowid,* FROM normalized_market_observations WHERE id IN ("+unique.map(()=>"?").join(",")+")",...unique);
 if(source.length!==unique.length)fail("CANONICAL_ROW_MISSING");
 const insert="INSERT OR IGNORE INTO normalized_market_observations("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+")";
 let written=0,verified=0;
 for(const row of source){
  if(row.source!==WS_SOURCE || Number(row.can_qualify)!==0 || Number(row.can_authorize_wager)!==0)fail("SCOPE_OR_AUTHORITY");
  const values=columns.map(k=>row[k]),digest=await hash(JSON.stringify(values));
  let result;
  try{result=await env.MARKET_HISTORY_DB.prepare(insert).bind(...values).run();}
  catch(error){
   // Primary remains authoritative. When the history shard is at its 10 GB
   // ceiling, skip shadowing rather than failing the live WS ingest path.
   if(isD1CapacityError(error)){
    return {state:"SHADOW_CAPACITY_DEGRADED",attempted:unique.length,written,verified,
     sourceRowsDeleted:0,canQualify:false,canAuthorizeWager:false,primaryIsAuthoritative:true,
     reason:"MARKET_HISTORY_D1_CAPACITY"};
   }
   throw error;
  }
  written+=Number(result?.meta?.changes||0);
  const matched=await all(env.MARKET_HISTORY_DB,"SELECT * FROM normalized_market_observations WHERE id=?",row.id);
  if(matched.length!==1 || await hash(JSON.stringify(columns.map(k=>matched[0][k])))!==digest)fail("SHARD_CONTENT_PARITY");
  const evidence=await env.MARKET_HISTORY_DB.prepare(
   "INSERT OR IGNORE INTO market_history_transfer_evidence(id,source_db,source_rowid,source_payload_sha256,full_row_sha256,pilot_batch,recorded_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(row.id,ORIGIN_DB,row.__source_rowid,await hash(row.raw_payload_json||""),digest,BATCH,new Date().toISOString()).run();
  const receipt=await all(env.MARKET_HISTORY_DB,
   "SELECT full_row_sha256,source_payload_sha256,source_rowid,source_db FROM market_history_transfer_evidence WHERE id=?",row.id);
  if(receipt.length!==1||receipt[0].full_row_sha256!==digest||receipt[0].source_db!==ORIGIN_DB||
   Number(receipt[0].source_rowid)!==Number(row.__source_rowid)||
   receipt[0].source_payload_sha256!==await hash(row.raw_payload_json||""))fail("LINEAGE_PARITY");
  verified++;
 }
 return {state:"SHADOW_VERIFIED",attempted:unique.length,written,verified,sourceRowsDeleted:0,canQualify:false,canAuthorizeWager:false,primaryIsAuthoritative:true};
}
