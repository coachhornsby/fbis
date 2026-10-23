import { assessPropModel } from './propAcceptance.js';
const ROOT='player-props/forecasts/v1/';
const stat=v=>v==='pra'?'points_rebounds_assists':v;
const hash=async(text,subtle)=>[...new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const eventPrefix=(sport,event)=>ROOT+encodeURIComponent(sport)+'/'+encodeURIComponent(event)+'/';

/** One immutable object per event/capture, containing every eligible player/stat forecast. */
export async function freezePropForecasts(env,rows,{now=new Date(),webCrypto=globalThis.crypto}={}){
 if(!env.ARCHIVE?.get||!env.ARCHIVE?.put||!webCrypto?.subtle)return {ok:false,reason:'FORECAST_ARCHIVE_UNAVAILABLE'};
 if(!Array.isArray(rows)||rows.length>10000)return {ok:false,reason:'MODEL_BATCH_LIMIT_EXCEEDED'};
 const groups=new Map(),blocked={};
 for(const row of rows){const check=assessPropModel(row,{now:now.getTime()});
  if(!check.displayReady){for(const reason of check.reasons)blocked[reason]=(blocked[reason]||0)+1;continue;}
  const key=row.sport+'|'+row.canonicalEventId;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 const receipts=[];
 for(const eventRows of groups.values()){
  if(eventRows.some(r=>Date.parse(r.start_time)!==Date.parse(eventRows[0].start_time))){receipts.push({ok:false,reason:'CONFLICTING_EVENT_START'});continue;}
  if(eventRows.length>1000){receipts.push({ok:false,reason:'EVENT_BATCH_LIMIT_EXCEEDED'});continue;}
  const first=eventRows[0],seen=new Set();
  const forecasts=[];let ambiguous=false;
  for(const r of eventRows){const key=r.canonicalPlayerId+'|'+stat(r.canonical_market)+'|'+r.period;
   if(seen.has(key)){ambiguous=true;break;}seen.add(key);
   forecasts.push({canonicalPlayerId:r.canonicalPlayerId,market:stat(r.canonical_market),period:r.period,projection:r.fbis_projection,sigma:r.sigma,modelId:r.modelId,modelVersion:r.modelVersion,modelAsOf:r.modelAsOf});
  }
  if(ambiguous){receipts.push({ok:false,event:first.canonicalEventId,reason:'AMBIGUOUS_MODEL_BATCH'});continue;}
  const payload={schemaVersion:1,sport:first.sport,canonicalEventId:first.canonicalEventId,eventStart:first.start_time,frozenAt:now.toISOString(),forecasts,recordedWager:false};
  const body=JSON.stringify(payload),id=await hash(body,webCrypto.subtle),key=eventPrefix(first.sport,first.canonicalEventId)+now.toISOString()+'-'+id+'.json';
  try{const existing=await env.ARCHIVE.get(key);if(existing&&await existing.text()!==body)throw Error('CONTENT_CONFLICT');
   if(!existing)await env.ARCHIVE.put(key,body,{httpMetadata:{contentType:'application/json'}});
   const saved=await env.ARCHIVE.get(key);if(!saved||await saved.text()!==body)throw Error('READBACK_FAILED');
   receipts.push({ok:true,event:first.canonicalEventId,forecasts:forecasts.length,key});
  }catch{receipts.push({ok:false,event:first.canonicalEventId,reason:'FORECAST_PERSISTENCE_FAILED'});}
 }
 return {ok:receipts.every(r=>r.ok),status:receipts.some(r=>r.ok)?Object.keys(blocked).length?'PARTIAL':'CAPTURED':rows.length?'MODEL_CLOCK_OR_IDENTITY_GAPS':'NO_MODEL_ROWS',captured:receipts.filter(r=>r.ok).reduce((n,r)=>n+r.forecasts,0),blocked,receipts,canAuthorizeWager:false};
}

export async function readFrozenPropForecast(env,{sport,eventId,playerId,market,eventStart,webCrypto=globalThis.crypto}={}){
 if(!env.ARCHIVE?.list||!env.ARCHIVE?.get||!webCrypto?.subtle)return null;
 try{let cursor;const candidates=[];let complete=false;
  for(let page=0;page<4;page++){
   const list=await env.ARCHIVE.list({prefix:eventPrefix(sport,eventId),limit:1000,...(cursor?{cursor}:{})});candidates.push(...list.objects);
   if(!list.truncated){complete=true;break;}cursor=list.cursor;
  }
  if(!complete)return null;
  for(const object of candidates.sort((a,b)=>b.key.localeCompare(a.key)).slice(0,16)){
   const file=await env.ARCHIVE.get(object.key);if(!file)continue;
   const raw=await file.text(),digest=object.key.match(/-([a-f0-9]{64})\.json$/)?.[1];if(!digest||await hash(raw,webCrypto.subtle)!==digest)continue;
   const body=JSON.parse(raw),start=Date.parse(body.eventStart),frozen=Date.parse(body.frozenAt);
   if(body.schemaVersion!==1||body.sport!==sport||body.canonicalEventId!==eventId||!Number.isFinite(start)||!Number.isFinite(frozen)||frozen>=start||start!==Date.parse(eventStart))continue;
   const matches=body.forecasts.filter(r=>r.canonicalPlayerId===playerId&&r.market===stat(market)&&r.period==='full_game');
   if(matches.length===1)return {...matches[0],frozenAt:body.frozenAt,eventStart:body.eventStart,evidenceKey:object.key};
  }
 }catch{}
 return null;
}
