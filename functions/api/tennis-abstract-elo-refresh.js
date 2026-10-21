import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {fetchTennisAbstractElo,persistTennisAbstractElo} from '../lib/tennisAbstractEloSource.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,
 headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare||!env?.DB?.batch)return json({ok:false,error:'D1_BINDING_UNAVAILABLE'},503);
 const receipts=[],errors=[];
 for(const tour of ['atp','wta']){
  try{
   const record=await fetchTennisAbstractElo(tour);
   receipts.push(await persistTennisAbstractElo(env.DB,record));
  }catch(e){errors.push({tour,error:String(e?.message||e).slice(0,140)});}
 }
 return json({ok:errors.length===0,source:'TENNIS_ABSTRACT_LIVE_ELO_RESEARCH',
  receipts,errors,researchOnly:true,matchHistoryBackfilled:false,
  modelAuthorityChanged:false,canQualify:false,canAuthorizeWager:false},
  errors.length?502:200);
}
export async function onRequestGet({env}){
 if(!env?.DB?.prepare)return json({ok:false,error:'D1_BINDING_UNAVAILABLE'},503);
 try{
  const rows=(await env.DB.prepare(`SELECT tour,report_date,player_count,retrieved_at,
   'TENNIS_ABSTRACT_LIVE_ELO_RESEARCH' AS source FROM (
   SELECT *,ROW_NUMBER() OVER(PARTITION BY tour ORDER BY report_date DESC,retrieved_at DESC) rn
   FROM tennis_abstract_elo_runs) WHERE rn=1 ORDER BY tour`).all()).results||[];
  return json({ok:true,snapshots:rows,researchOnly:true,matchHistoryBackfilled:false,
   canAuthorizeWager:false});
 }catch{return json({ok:false,error:'ELO_SCHEMA_OR_DATA_UNAVAILABLE'},503);}
}
