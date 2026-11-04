// Owner-only immutable model snapshots for the four-sport FBIS recovery.
// No D1, model inference, provider API, jobs, wagers, or writes on GET.
import {inspectRequestOwnerAccess} from '../../cbb/[date].js';
import {PRIVATE_RECOVERY_SPORTS,validateFourSportPacket} from '../../../../../../../functions/lib/privateFourSportProjection.js';
const headers={'cache-control':'private, no-store, max-age=0','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff','vary':'Cookie'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
export async function onRequestGet({request,env,params}){
 const sport=String(params?.sport||''),date=String(params?.date||'');
 if(!PRIVATE_RECOVERY_SPORTS.includes(sport)||!validDate(date))return json({state:'INVALID_SPORT_OR_DATE'},400);
 const authorization=await inspectRequestOwnerAccess(request,env);
 if(!authorization.ok)return json({state:'PRIVATE_AUTH_REQUIRED',authStage:authorization.reason},401);
 if(new URL(request.url).searchParams.get('login')==='1')return Response.redirect(new URL('/?sport='+sport+'&date='+date,request.url),303);
 if(!env?.FBIS_PRIVATE_CBB)return json({state:'PRIVATE_STORAGE_UNAVAILABLE'},503);
 try{
   const key='private/'+sport+'/projections/'+date+'.json';
   const object=await env.FBIS_PRIVATE_CBB.get(key);
   if(!object)return json({state:'NO_PRIVATE_PROJECTION',sport,date},404);
   if(object.size>512000)return json({state:'INVALID_PRIVATE_PACKET'},503);
   const text=await object.text();
   if(text.length>512000)return json({state:'INVALID_PRIVATE_PACKET'},503);
   let packet;
   try{packet=validateFourSportPacket(JSON.parse(text),{sport,date});}
   catch{return json({state:'INVALID_PRIVATE_PACKET'},503);}
   // Separate verified quote receipts. No market price is fabricated when this object is missing.
   let markets=null;
   const quoteObject=await env.FBIS_PRIVATE_CBB.get('private/'+sport+'/markets/'+date+'.json');
   if(quoteObject&&(quoteObject.size||0)<=1024*1024){
     const raw=await quoteObject.text();
     if(raw.length<=1024*1024){
       try{
         const q=JSON.parse(raw);
         if(q?.version===1&&q.sport===sport&&q.date===date&&Array.isArray(q.offers)&&q.offers.length<=1000)
           markets={capturedAt:q.capturedAt||null,offers:q.offers};
       }catch{} // A bad quote snapshot cannot invalidate an otherwise valid projection.
     }
   }
   return json({state:'PRIVATE_RESEARCH_ONLY',sport,date,packet,markets,
     meta:{projectionExpired:Date.now()>=Date.parse(packet.expiresAt),qualifiedWagers:0,marketQuotesAvailable:Boolean(markets)}});
 }catch{return json({state:'PRIVATE_READ_FAILED'},503);}
}
export async function onRequest(){return json({state:'METHOD_NOT_ALLOWED'},405);}
