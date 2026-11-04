// Signed-owner-only, read-only R2 delivery for three recovered sport projections.
// CBB uses /api/private/cbb/:date and is intentionally separate.
import {inspectRequestOwnerAccess} from '../../cbb/[date].js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','vary':'Cookie'}});
const dateOk=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
export async function onRequestGet({request,env,params}){
 const sport=String(params?.sport||''),date=String(params?.date||'');
 if(!['nfl','nba','cfb'].includes(sport)||!dateOk(date))return json({state:'INVALID_PRIVATE_PATH'},400);
 if(!env?.FBIS_PRIVATE_CBB)return json({state:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 const identity=await inspectRequestOwnerAccess(request,env);
 if(!identity.ok)return json({state:'PRIVATE_AUTH_REQUIRED',authStage:identity.reason},401);
 if(new URL(request.url).searchParams.get('login')==='1')return Response.redirect(new URL('/?sport='+sport+'&date='+date,request.url),303);
 try{
  const obj=await env.FBIS_PRIVATE_CBB.get('private/'+sport+'/projections/'+date+'.json');
  if(!obj)return json({state:'NO_PRIVATE_PROJECTION',sport,date},404);
  if((obj.size||0)>768*1024)return json({state:'PRIVATE_PACKET_TOO_LARGE'},503);
  const raw=await obj.text();if(raw.length>768*1024)return json({state:'PRIVATE_PACKET_TOO_LARGE'},503);
  const p=JSON.parse(raw);
  if(p?.version!==1||p.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||p.sport!==sport||p.date!==date||p.canAuthorizeWager!==false||!Array.isArray(p.events)||p.events.length>300||!Number.isFinite(Date.parse(p.generatedAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.parse(p.generatedAt)||Date.parse(p.expiresAt)-Date.parse(p.generatedAt)>86400000)return json({state:'INVALID_PRIVATE_PACKET'},503);
  const seen=new Set();
  for(const e of p.events){
   if(e.date!==date||!String(e.eventId||'')||seen.has(String(e.eventId))||!String(e.homeId||'')||!String(e.awayId||'')||e.homeId===e.awayId||!Number.isFinite(Date.parse(e.start))||Date.parse(e.start)<=Date.parse(p.generatedAt)||!Number.isFinite(Date.parse(e.sourceCapturedAt))||Date.parse(e.sourceCapturedAt)>Date.parse(p.generatedAt)||!String(e.modelId||'')||!String(e.modelVersion||'')||e.canAuthorizeWager!==false||!['home','away','margin','total'].every(k=>typeof e[k]==='number'&&Number.isFinite(e[k]))||e.home<0||e.away<0||Math.abs(e.home-e.away-e.margin)>.21||Math.abs(e.home+e.away-e.total)>.21)return json({state:'INVALID_PRIVATE_PACKET'},503);
   seen.add(String(e.eventId));
  }
  return json({state:'PRIVATE_RESEARCH_ONLY',sport,date,packet:p,meta:{expired:Date.now()>=Date.parse(p.expiresAt),canAuthorizeWager:false}});
 }catch{return json({state:'PRIVATE_READ_FAILED'},503);}
}
export function onRequest(){return json({state:'METHOD_NOT_ALLOWED'},405);}
