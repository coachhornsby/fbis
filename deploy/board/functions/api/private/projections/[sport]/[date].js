// Owner-only, read-only projections for NFL, CFB and NBA. No D1, collector, odds or paid APIs.
import {inspectRequestOwnerAccess} from '../../cbb/[date].js';
const sports=new Set(['nfl','cfb','nba']);
const noStore={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','x-content-type-options':'nosniff','vary':'Cookie'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:noStore});
const validDate=d=>{if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))return false;const t=Date.parse(d+'T12:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===d;};
const iso=s=>typeof s==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
function validPacket(p,sport,date){
 if(!p||p.version!==1||p.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||p.sport!==sport||p.date!==date||!iso(p.generatedAt)||!iso(p.expiresAt)||Date.parse(p.expiresAt)<Date.parse(p.generatedAt)||!Array.isArray(p.events)||p.events.length>500||!Array.isArray(p.sources)||!p.sources.length||p.sources.length>12||p.sources.some(s=>typeof s!=='string'||!s.trim()||s.length>120)||p.canAuthorizeWager!==false)return false;
 const ids=new Set();
 for(const e of p.events){if(!e||e.date!==date||!/^[0-9]+$/.test(String(e.eventId||''))||!/^[0-9]+$/.test(String(e.homeId||''))||!/^[0-9]+$/.test(String(e.awayId||''))||e.homeId===e.awayId||!iso(e.start)||(e.neutralSite!==null&&typeof e.neutralSite!=='boolean')||ids.has(String(e.eventId)))return false;
  ids.add(String(e.eventId));const m=e.primary;if(m!=null&&(typeof m.modelId!=='string'||!m.modelId.trim()||m.modelId.length>120||!['home','away','margin','total'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k]))||m.home<0||m.away<0||Math.abs(m.margin-m.home+m.away)>0.16||Math.abs(m.total-m.home-m.away)>0.16||m.canAuthorizeWager!==false))return false;}
 return true;
}
export async function onRequestGet({request,env,params}){
 const sport=String(params?.sport||''),date=String(params?.date||'');
 if(!sports.has(sport)||!validDate(date))return json({state:'UNSUPPORTED_SPORT_DATE'},400);
 if(!env?.FBIS_PRIVATE_CBB)return json({state:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 const auth=await inspectRequestOwnerAccess(request,env);
 if(!auth.ok)return json({state:'PRIVATE_AUTH_REQUIRED',authStage:auth.reason},401);
 try{
  const obj=await env.FBIS_PRIVATE_CBB.get('private/'+sport+'/projections/'+date+'.json');
  if(!obj)return json({state:'NO_PRIVATE_PROJECTION',sport,date},404);
  if((obj.size||0)>1024*1024)return json({state:'INVALID_PRIVATE_PACKET'},503);
  const raw=await obj.text();
  if(raw.length>1024*1024)return json({state:'INVALID_PRIVATE_PACKET'},503);
  const packet=JSON.parse(raw);
  if(!validPacket(packet,sport,date))return json({state:'INVALID_PRIVATE_PACKET'},503);
  return json({state:'PRIVATE_RESEARCH_ONLY',sport,date,packet,meta:{expired:Date.now()>=Date.parse(packet.expiresAt),canAuthorizeWager:false}});
 }catch{return json({state:'PRIVATE_READ_FAILED'},503);}
}
export async function onRequest(){return json({state:'METHOD_NOT_ALLOWED'},405);}
