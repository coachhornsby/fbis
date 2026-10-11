import {readCache,writeCache} from './cache.js';
const KEY='cfbd-provider-backoff-v1';
const inFlight=new Map();
let providerQueue=Promise.resolve();
export function retryAfterUntil(value, now=Date.now()) {
  const seconds=/^\d+(?:\.\d+)?$/.test(String(value||''))?Number(value):null;
  const date=seconds==null?Date.parse(value||''):now+seconds*1000;
  return Math.max(now+60_000,Number.isFinite(date)?date:now+15*60_000);
}
export async function fetchWithCfbBackoff(url,options={},env={},fetchFn=fetch) {
  if(new URL(url).hostname!=='api.collegefootballdata.com')return fetchFn(url,options);
  const cache=env.caches||globalThis.caches?.default;
  const blocked=await readCache(KEY,cache,24*60*60_000);
  if(blocked?.until>Date.now())return Response.json({error:'CFBD cooldown; cached/public sources required'},{status:429,headers:{'Retry-After':String(Math.ceil((blocked.until-Date.now())/1000)),'X-FBIS-Cooldown':'true'}});
  // Deduplicate concurrent identical reads inside an isolate; callers get independent bodies.
  const requestKey=url+'|'+String(options.headers?.Authorization||'');
  const copy=response=>typeof response.clone==='function'?response.clone():response;
  if(inFlight.has(requestKey))return copy(await inFlight.get(requestKey));
  const promise=providerQueue.then(async()=>{
    const cooldown=await readCache(KEY,cache,24*60*60_000);
    if(cooldown?.until>Date.now())return Response.json({error:'CFBD cooldown; cached/public sources required'},{status:429,headers:{'Retry-After':String(Math.ceil((cooldown.until-Date.now())/1000)),'X-FBIS-Cooldown':'true'}});
    const response=await fetchFn(url,options);
    if(response.status===429){
      const until=retryAfterUntil(response.headers?.get?.('Retry-After'));
      await writeCache(KEY,{until,observedAt:new Date().toISOString()},cache,Math.max(60_000,until-Date.now()));
    }
    return response;
  });
  providerQueue=promise.then(()=>undefined,()=>undefined);
  inFlight.set(requestKey,promise);
  try{return copy(await promise);}finally{inFlight.delete(requestKey);}
}
