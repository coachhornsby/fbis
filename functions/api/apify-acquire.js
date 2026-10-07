import { authorizeHarvest,unauthorizedBody } from '../lib/auth.js';
import { startPaidAcquisition,captureAcquisitionRaw } from '../lib/externalAcquisition.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 const body=await request.json();
 if(body.operation==='capture'){
   const id=body.run?.id;
   const owned=id&&await env.DB.prepare('SELECT id FROM external_acquisitions WHERE provider_run_id=?').bind(id).first();
   if(!owned)return json({ok:false,error:'ACQUISITION_NOT_OWNED'},409);
   // Provider run state is read from Apify, never accepted on the caller's assertion.
   const r=await fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${env.APIFY_TOKEN}`}});
   if(!r.ok)return json({ok:false,error:'PROVIDER_READ_BLOCKED'},503);
   const run=(await r.json()).data;
   if(!['SUCCEEDED','SUCCEEDED_WITH_WARNINGS'].includes(run?.status))return json({ok:false,error:'CAPTURE_NOT_COMPLETE'},409);
   // Read immutable provider output. Caller-supplied rows never become raw source truth.
   const d=await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?format=json&clean=true`,{headers:{authorization:`Bearer ${env.APIFY_TOKEN}`}});
   if(!d.ok)return json({ok:false,error:'DATASET_READ_BLOCKED'},503);
   const rows=await d.json();
   try{return json({ok:true,...await captureAcquisitionRaw(env,{run,rows})});}catch{return json({ok:false,error:'RAW_CAPTURE_FAILED'},503);}
 }
 if(body.source!=='prizepicks')return json({ok:false,error:'SOURCE_ROUTE_REQUIRED'},400);
 // Explicit shared scope: a single query covers subscribers, no paid league discovery.
 return startPaidAcquisition(env,{source:'prizepicks',component:'prizepicks-daily',sport:'shared',input:{leagues:['MLB','NFL','NHL','NBA','College Basketball','CFB','Soccer','Tennis']}});
}

export async function onRequestGet({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 const source=await env.DB.prepare("SELECT * FROM external_acquisitions WHERE source='prizepicks' AND provider_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").first();
 const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
 if(!source||day(source.created_at)!==day(Date.now()))return json({ok:false,error:'NO_CURRENT_OWNED_CAPTURE'},409);
 return json({ok:true,acquisitionId:source.id,reused:true,data:{id:source.provider_run_id,status:source.provider_status,defaultDatasetId:source.dataset_id}});
}
