import { buildSlate } from './slateEngine.js';
import { independentPropRows,loadPropFixturesAndPlayers,resolvePropModelIdentities,resolvePropResearchEnv } from './propResearchData.js';
import { chicagoDayBounds } from './chicagoDayBounds.js';
import { freezePropForecasts } from './propForecastArchive.js';
import { frozenForecastDateIndex } from './fbisFrozenModelDelivery.js';
export async function capturePropForecastJob(env,{now=new Date(),webCrypto=globalThis.crypto,sport:requestedSport=null,clock=()=>new Date(),buildSlateImpl=buildSlate,loadContextImpl=loadPropFixturesAndPlayers}={}){
 const sports=['nba','nfl','nhl','mlb'];
 if(requestedSport&&!sports.includes(requestedSport))return {ok:false,reason:'SPORT_CAPTURE_NOT_SUPPORTED'};
 const sport=requestedSport||sports[Math.floor(now.getTime()/(15*60*1000))%4];
 const owner=await resolvePropResearchEnv(env,sport);if(!owner.ok)return {ok:false,reason:'SPORT_OWNER_UNAVAILABLE',sport};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 let date=day;
 try{const next=await owner.db.prepare("SELECT date FROM games WHERE sport=? AND julianday(start)>julianday(?) AND date>=? AND date<=date(?,'+7 days') ORDER BY start LIMIT 1").bind(sport,now.toISOString(),day,day).first();if(next?.date)date=next.date;}catch{return {ok:false,reason:'FORECAST_FIXTURE_READ_FAILED',sport};}
 const slate=await buildSlateImpl(sport,date,{...env,caches:typeof caches==='undefined'?null:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false});
 const context=await loadContextImpl(env,{...chicagoDayBounds(date),sport});
 if(context.diagnostics.length)return {ok:false,reason:'FORECAST_IDENTITY_CONTEXT_UNAVAILABLE',sport,diagnostics:context.diagnostics};
 const rows=resolvePropModelIdentities(independentPropRows(slate,{now:now.getTime()}),context);
 // Live NHL/MLB features may arrive after the request began. Freeze at
 // completion, never backdate the receipt to before its own input cutoff.
 const capturedAt=clock();
 if(!(capturedAt instanceof Date)||!Number.isFinite(+capturedAt)||+capturedAt<+now)
  return {ok:false,reason:'CAPTURE_CLOCK_BEFORE_REQUEST',sport};
 const result=await freezePropForecasts(env,rows,{now:capturedAt,webCrypto});
 const receipt={...result,sport,date,attemptedAt:now.toISOString(),candidateProjections:rows.length,completedAt:capturedAt.toISOString()};
 await env.ARCHIVE.put('player-props/forecasts/v1/'+sport+'/last-capture.json',JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
 // Index only already readback-verified immutable blobs; never copy projections
 // into a mutable unverified price/forecast payload.
 const indexKey=frozenForecastDateIndex(sport,date);
 try{
  const old=await env.ARCHIVE.get(indexKey),previous=old?await old.json():null;
  const receipts=new Map();
  if(previous?.sport===sport&&previous?.date===date&&Array.isArray(previous.receipts))
   for(const r of previous.receipts)if(r.ok===true&&r.event&&r.key)receipts.set(r.event,r);
  for(const r of result.receipts||[])if(r.ok===true&&r.event&&r.key)receipts.set(r.event,r);
  await env.ARCHIVE.put(indexKey,JSON.stringify({
   schemaVersion:1,sport,date,attemptedAt:now.toISOString(),receipts:[...receipts.values()],
   canAuthorizeWager:false
  }),{httpMetadata:{contentType:'application/json'}});
 }catch{
  receipt.indexStatus='DATE_INDEX_WRITE_FAILED';
 }
 return receipt;
}
