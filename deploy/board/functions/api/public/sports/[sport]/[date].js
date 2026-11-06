// Anonymous, read-only FBIS-owned model score summaries. Private R2 objects remain private.
// Never retrieve CBB/KenPom inputs, market quotes, D1 data, or invoke models.
import {publicProjectionSummary} from '../../../../../../../functions/lib/publicFourSportProjection.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60, stale-while-revalidate=120','x-content-type-options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export async function onRequestGet({env,params}){
  const sport=String(params?.sport||''),date=String(params?.date||'');
  if(!['nfl','nba','cfb'].includes(sport)||!validDate(date))return json({state:'UNSUPPORTED_PUBLIC_MODEL'},400);
  if(!env?.FBIS_PRIVATE_CBB)return json({state:'MODEL_STORAGE_UNAVAILABLE'},503);
  try{
    const object=await env.FBIS_PRIVATE_CBB.get('private/'+sport+'/projections/'+date+'.json');
    if(!object)return json({state:'MODEL_NOT_AVAILABLE'},404);
    if(object.size>512000)return json({state:'INVALID_MODEL_PACKET'},503);
    const raw=await object.text();
    if(raw.length>512000)return json({state:'INVALID_MODEL_PACKET'},503);
    const summary=publicProjectionSummary(JSON.parse(raw),{sport,date});
    if(Date.now()>=Date.parse(summary.expiresAt))return json({state:'MODEL_EXPIRED'},404);
    if(!summary.events.length)return json({state:'MODEL_NOT_AVAILABLE'},404);
    return json({state:'PUBLIC_RESEARCH_ONLY',sport,date,packet:summary});
  }catch{return json({state:'MODEL_UNAVAILABLE'},503);}
}
