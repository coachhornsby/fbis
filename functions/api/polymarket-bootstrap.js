import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
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
 const overflow=env.MARKET_HISTORY_2026Q4B_DB?.prepare?env.MARKET_HISTORY_2026Q4B_DB:null;
 const q4=env.MARKET_HISTORY_2026Q4_DB?.prepare?env.MARKET_HISTORY_2026Q4_DB:null;
 const legacy=!overflow&&!q4&&env.MARKET_HISTORY_ALLOW_LEGACY_WRITE==='enabled'&&env.MARKET_HISTORY_DB?.prepare?env.MARKET_HISTORY_DB:null;
 const db=overflow||q4||legacy;
 const store=overflow?'MARKET_HISTORY_2026Q4B':q4?'MARKET_HISTORY_2026Q4':legacy?'MARKET_HISTORY':null;
 if(!db)return {db:null,store:null,primaryBytes,blocked:'MARKET_HISTORY_2026Q4_UNBOUND_FAIL_CLOSED'};
 // A bound shard is not evidence of free space. Reject unknown or >=85% Q4/legacy.
 const bytes=Number(historySizeAfter);
 if(!Number.isSafeInteger(bytes)||bytes<=0)return {db:null,store,primaryBytes,blocked:'MARKET_HISTORY_SIZE_UNVERIFIED_FAIL_CLOSED'};
 const capacity=capacityAlertLevel(bytes);
 const gate=shouldBlockMarketHistoryWrite(capacity);
 if(gate.blocked)return {db:null,store,primaryBytes,capacity,blocked:'MARKET_HISTORY_CAPACITY_'+capacity.level+'_FAIL_CLOSED'};
 return {db,store,primaryBytes,historyBytes:bytes,capacity};
}
export async function onRequestPost({env,request}){
 const auth=authorizeHarvest(request,env);if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 return json({ok:false,error:'LEGACY_US_COLLECTION_RETIRED',replacement:'fbis-polymarket-rest-collector',noProviderRequest:true,canAuthorizeWager:false},410);
}
export async function onRequestGet(){return json({ok:false,error:'LEGACY_US_COLLECTION_RETIRED',noProviderRequest:true,canAuthorizeWager:false},410);}
