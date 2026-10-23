import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {bootstrapPolymarket} from '../lib/polymarketBootstrap.js';
import {collectPolymarketUsTennisInventory} from '../lib/tennisExchangeInventory.js';
import {capacityAlertLevel} from '../lib/databaseOwnership.js';
import {shouldBlockMarketHistoryWrite} from '../lib/marketHistoryCapacity.js';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
/**
 * Unified with resolveMarketHistoryWriteDb / WS persist: observation writes
 * always prefer Q4. Never fall through to PRIMARY for market observations.
 * Legacy MARKET_HISTORY_DB only when MARKET_HISTORY_ALLOW_LEGACY_WRITE=enabled.
 */
export function bootstrapWriteTarget(env,sizeAfter,historySizeAfter=null){
 const primary=Number(sizeAfter);
 const primaryBytes=Number.isSafeInteger(primary)&&primary>0?primary:null;
 const q4=env.MARKET_HISTORY_2026Q4_DB?.prepare?env.MARKET_HISTORY_2026Q4_DB:null;
 const legacy=!q4&&env.MARKET_HISTORY_ALLOW_LEGACY_WRITE==='enabled'&&env.MARKET_HISTORY_DB?.prepare?env.MARKET_HISTORY_DB:null;
 const db=q4||legacy;
 const store=q4?'MARKET_HISTORY_2026Q4':legacy?'MARKET_HISTORY':null;
 if(!db)return {db:null,store:null,primaryBytes,blocked:'MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED'};
 // A bound shard is not evidence of free space. Reject unknown or >=85% Q4/legacy.
 const bytes=Number(historySizeAfter);
 if(!Number.isSafeInteger(bytes)||bytes<=0)return {db:null,store,primaryBytes,blocked:'MARKET_HISTORY_SIZE_UNVERIFIED_FAIL_CLOSED'};
 const capacity=capacityAlertLevel(bytes);
 const gate=shouldBlockMarketHistoryWrite(capacity);
 if(gate.blocked)return {db:null,store,primaryBytes,capacity,blocked:'MARKET_HISTORY_CAPACITY_'+capacity.level+'_FAIL_CLOSED'};
 return {db,store,primaryBytes,historyBytes:bytes,capacity};
}
export async function onRequestPost({request,env}){
 if(!authorizeHarvest(request,env).ok)return json(unauthorizedBody(),403);
 try{const body=await request.json();
  if(body.operation==='report'){if(!body.report||JSON.stringify(body.report).length>1000000)return json({ok:false,error:'INVALID_REPORT'},400);await env.ARCHIVE.put('market-sources/polymarket-us/coverage/latest.json',JSON.stringify(body.report));return json({ok:true});}
  // Market-first ATP/WTA discovery does not require a prior FBIS projection
  // and writes ONLY a bounded public-data R2 snapshot, never market D1.
  if(body.operation==='tennis-inventory'){
   const result=await collectPolymarketUsTennisInventory(env);
   return json(result,result.ok?200:503);
  }
  let observationDb=env.DB,observationStore='PRIMARY';
  if(body.operation!=='catalogue'){
   const probe=await env.DB.prepare('SELECT 1 AS healthy').all();
   const historyDb=env.MARKET_HISTORY_2026Q4_DB?.prepare?env.MARKET_HISTORY_2026Q4_DB:
     env.MARKET_HISTORY_ALLOW_LEGACY_WRITE==='enabled'?env.MARKET_HISTORY_DB:null;
   const historyProbe=historyDb?.prepare?await historyDb.prepare('SELECT 1 AS healthy').all():null;
   const target=bootstrapWriteTarget(env,probe?.meta?.size_after,historyProbe?.meta?.size_after);
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
