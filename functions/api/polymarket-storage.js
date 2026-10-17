import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {compactPolymarketPayloadBatch,restoreArchivedRaw,receiptKey} from '../lib/polymarketPayloadArchive.js';
import {coldHistoryEnabled,coldMarketPartitions} from '../lib/coldMarketHistory.js';
const json=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
/** Maintenance and full-evidence reads require existing operator authorization. */
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 try{
  const body=await request.json();
  if(body.operation==='receipt'){
   let key;try{key=receiptKey(body.receiptId)}catch{return json({ok:false,error:'INVALID_ARCHIVE_RECEIPT_ID'},400)}
   const object=await env.ARCHIVE.get(key);
   if(!object)return json({ok:false,error:'ARCHIVED_RECEIPT_MISSING'},404);
   if(object.size>128*1024*1024)return json({ok:false,error:'ARCHIVED_RECEIPT_TOO_LARGE'},413);
   // Authorized maintenance runners parse the original body outside Pages CPU limits.
   return new Response(object.body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
  if(body.operation==='restore'){
   if(!/^nmo_[a-f0-9]{28}$/.test(body.observationId||''))return json({ok:false,error:'INVALID_OBSERVATION'},400);
   let row=await env.DB.prepare(`SELECT id,raw_payload_json,raw_payload_hash FROM normalized_market_observations WHERE id=? AND source='Polymarket US'`).bind(body.observationId).first();
   if(!row&&coldHistoryEnabled(env)){await coldMarketPartitions(env);row=await env.COLD_HISTORY_DB.prepare(`SELECT id,raw_payload_json,raw_payload_hash FROM normalized_market_observations WHERE id=? AND source='Polymarket US' AND snapshot_type='RESEARCH'`).bind(body.observationId).first();}
   if(!row)return json({ok:false,error:'OBSERVATION_NOT_FOUND'},404);
   const raw=await restoreArchivedRaw(JSON.parse(row.raw_payload_json),env.ARCHIVE,{storedHash:row.raw_payload_hash});
   return json({ok:true,id:row.id,raw,readOnly:true});
  }
  if(body.operation!=='compact')return json({ok:false,error:'INVALID_OPERATION'},400);
  return json(await compactPolymarketPayloadBatch(env,{...body,dryRun:body.apply!==true}));
 }catch(error){return json({ok:false,error:String(error?.message||error)},502)}
}
export async function onRequestGet(){return json({ok:false,error:'method-not-allowed'},405)}
