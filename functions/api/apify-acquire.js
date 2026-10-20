import { PRIZEPICKS_FBIS_SPORTS, sharedPrizePicksInput } from '../lib/propMarketPolicy.js';
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
 const now=new Date().toISOString(),until=new Date(Date.now()+8*86400000).toISOString();
 const placeholders=PRIZEPICKS_FBIS_SPORTS.map(()=>'?').join(',');
 const targets=(await env.DB.prepare(`SELECT g.id,g.sport FROM games g
 WHERE g.sport IN (${placeholders}) AND julianday(g.start)>julianday(?) AND julianday(g.start)<=julianday(?)
 AND EXISTS(SELECT 1 FROM prediction_snapshots p WHERE p.game_id=g.id AND p.sport=g.sport
 AND p.model_version IS NOT NULL AND (p.proj_total IS NOT NULL OR (p.proj_home IS NOT NULL AND p.proj_away IS NOT NULL))
 AND julianday(p.frozen_at)<=julianday(?) AND julianday(p.frozen_at)<julianday(g.start))`)
 .bind(...PRIZEPICKS_FBIS_SPORTS,now,until,now).all()).results||[];
 if(!targets.length)return json({ok:false,error:'NO_PROJECTED_FBIS_EVENTS'},409);
 // Team filters combine with AND in the provider: carrying NFL teams here
 // silently removes all other sports. League + modeled stat filters are shared.
 return startPaidAcquisition(env,{source:'prizepicks',component:'prizepicks-daily',sport:'all',
 input:sharedPrizePicksInput(targets.map(g=>String(g.id)))});
}

export async function onRequestGet({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),401);
 const source=await env.DB.prepare("SELECT * FROM external_acquisitions WHERE source='prizepicks' AND provider_run_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").first();
 const url=new URL(request.url);
 if(url.searchParams.get('operation')==='rows'){
   if(source?.state!=='CAPTURED'||!source.raw_key)return json({ok:false,error:'CAPTURE_REQUIRED'},409);
   const offset=Number(url.searchParams.get('offset')||0);
   if(!Number.isSafeInteger(offset)||offset<0||offset%200)return json({ok:false,error:'INVALID_OFFSET'},400);
   const raw=await(await env.ARCHIVE.get(source.raw_key))?.json();
   return json({ok:true,acquisitionId:source.id,runId:source.provider_run_id,rows:(raw?.rows||[]).slice(offset,offset+200),total:raw?.rows?.length||0});
 }

 const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
 if(!source||day(source.created_at)!==day(Date.now()))return json({ok:false,error:'NO_CURRENT_OWNED_CAPTURE'},409);
 return json({ok:true,acquisitionId:source.id,reused:true,data:{id:source.provider_run_id,status:source.provider_status,defaultDatasetId:source.dataset_id}});
}
