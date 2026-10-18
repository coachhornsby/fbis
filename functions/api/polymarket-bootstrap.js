import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {bootstrapPolymarket} from '../lib/polymarketBootstrap.js';
const LIMIT=9_500_000_000;
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
/** Prefer MARKET_HISTORY when primary is full/unknown so REST can still
 * archive stream rosters and land tennis/team contracts for the WS. */
export function bootstrapWriteTarget(env,sizeAfter){
 const bytes=Number(sizeAfter);
 const knownFull=Number.isFinite(bytes)&&bytes>0&&bytes>=LIMIT;
 const unknown=!Number.isFinite(bytes)||bytes<=0;
 if((knownFull||unknown)&&env.MARKET_HISTORY_DB?.prepare)return {db:env.MARKET_HISTORY_DB,store:'MARKET_HISTORY',primaryBytes:Number.isFinite(bytes)?bytes:null};
 if(knownFull)return {db:null,store:null,primaryBytes:bytes,blocked:'REST_WRITE_CAPACITY_UNAVAILABLE'};
 if(unknown)return {db:null,store:null,primaryBytes:null,blocked:'REST_WRITE_CAPACITY_UNAVAILABLE'};
 return {db:env.DB,store:'PRIMARY',primaryBytes:bytes};
}
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),403);
 try{const body=await request.json();
  if(body.operation==='report'){if(!body.report||JSON.stringify(body.report).length>1000000)return json({ok:false,error:'INVALID_REPORT'},400);await env.ARCHIVE.put('market-sources/polymarket-us/coverage/latest.json',JSON.stringify(body.report));return json({ok:true});}
  let observationDb=env.DB,observationStore='PRIMARY';
  if(body.operation!=='catalogue'){
   const probe=await env.DB.prepare('SELECT 1 AS healthy').all();
   const target=bootstrapWriteTarget(env,probe?.meta?.size_after);
   if(!target.db)return json({ok:false,error:target.blocked,canAuthorizeWager:false},409);
   observationDb=target.db;observationStore=target.store;
  }
  // Keep env.DB on primary for fixture/catalogue reads; only observation writes may use history.
  const result=await bootstrapPolymarket(env,{...body,observationDb,observationStore});return json(result,result.ok?200:409);
 }
 catch(e){const reason=/^[A-Z][A-Z0-9_]{1,100}$/.test(e.message||'')?e.message:'BOOTSTRAP_UNAVAILABLE';return json({ok:false,error:reason,canAuthorizeWager:false},reason.includes('HTTP_429')?429:503);}
}

export async function onRequestGet({env}){
 const object=await env.ARCHIVE?.get('market-sources/polymarket-us/coverage/latest.json');
 if(!object)return json({ok:false,status:'UNVERIFIED',coverageComplete:false},503);
 const report=await object.json();const stale=!Number.isFinite(Date.parse(report.checkedAt))||Date.now()-Date.parse(report.checkedAt)>40*60000;
 return json({...report,stale,coverageComplete:!stale&&report.coverageComplete===true});
}
