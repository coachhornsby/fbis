import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {fetchTennisAbstractElo,persistTennisAbstractElo} from '../lib/tennisAbstractEloSource.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,
 headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 if(!env?.DB?.prepare||!env?.DB?.batch||!env?.TENNIS_DB?.prepare||!env?.TENNIS_DB?.batch)return json({ok:false,error:'PRIMARY_OR_TENNIS_SHADOW_BINDING_UNAVAILABLE'},503);
 const receipts=[],errors=[];
 for(const tour of ['atp','wta']){
  try{
   const record=await fetchTennisAbstractElo(tour,{apifyToken:env.APIFY_TOKEN});
   const primary=await persistTennisAbstractElo(env.DB,record);
   const shadow=await persistTennisAbstractElo(env.TENNIS_DB,record);
   if(primary.players!==shadow.players)throw Error('ELO_PRIMARY_SHADOW_PARITY_MISMATCH');
   receipts.push({...primary,shadowPlayers:shadow.players,shadowUnchanged:shadow.unchanged});
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
  const rows=(await env.DB.prepare(`SELECT tour,report_date,player_count,retrieved_at,source_label,
   'TENNIS_ABSTRACT_LIVE_ELO_RESEARCH' AS source FROM (
   SELECT *,ROW_NUMBER() OVER(PARTITION BY tour ORDER BY report_date DESC,retrieved_at DESC) rn
   FROM tennis_abstract_elo_runs) WHERE rn=1 ORDER BY tour`).all()).results||[];
  const shadowRows=env.TENNIS_DB?.prepare?
    (await env.TENNIS_DB.prepare(`SELECT tour,report_date,player_count,retrieved_at,source_label
      FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY tour ORDER BY report_date DESC,retrieved_at DESC) rn
      FROM tennis_abstract_elo_runs) WHERE rn=1 ORDER BY tour`).all()).results||[]:[];
  const shadowParity=rows.length===2&&shadowRows.length===2&&rows.every(p=>
    shadowRows.some(s=>s.tour===p.tour&&s.report_date===p.report_date&&
      Number(s.player_count)===Number(p.player_count)));
  return json({ok:true,snapshots:rows,shadowSnapshots:shadowRows,shadowParity,
    researchOnly:true,matchHistoryBackfilled:false,canAuthorizeWager:false});
 }catch{return json({ok:false,error:'ELO_SCHEMA_OR_DATA_UNAVAILABLE'},503);}
}
