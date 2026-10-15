import {reserveCfbdRequest,completeCfbdRequest} from "./cfbCfbdAcquisition.js";
import {readCache,writeCache} from './cache.js';
const KEY='cfbd-provider-backoff-v1';
export function retryAfterUntil(value, now=Date.now()) {
  const seconds=/^\d+(?:\.\d+)?$/.test(String(value||''))?Number(value):null;
  const date=seconds==null?Date.parse(value||''):now+seconds*1000;
  return Math.max(now+60_000,Number.isFinite(date)?date:now+15*60_000);
}

// Test-double concurrency remains in-process; production NEVER shares a response
// stream or a Promise<Response> between Cloudflare request contexts.
const mockInFlight=new Map();
let mockQueue=Promise.resolve();

async function runMockAcquisition(url,options,env,fetchFn,cache){
  const requestKey=url+"|"+String(options.headers?.Authorization||"");
  const copy=(res)=>typeof res.clone==="function"?res.clone():res;
  if(mockInFlight.has(requestKey))return copy(await mockInFlight.get(requestKey));
  const run=mockQueue.then(async()=>{
    const cooldown=await readCache(KEY,cache,24*60*60_000);
    if(cooldown?.until>Date.now())return Response.json({error:"mock cooldown"},{status:429,
      headers:{"X-FBIS-Cooldown":"true"}});
    const permit=env.DB?.prepare?await reserveCfbdRequest(env,url):{allowed:false,offlineTest:true};
    if(env.DB?.prepare&&!permit.allowed)return Response.json({error:permit.reason},
      {status:503,headers:{"X-FBIS-CFBD-Gate":permit.reason}});
    let response;
    try{response=await fetchFn(url,options);}
    catch(err){await completeCfbdRequest(env,permit,0,null);throw err;}
    await completeCfbdRequest(env,permit,response.status,response);
    if(response.status===429){
      const until=retryAfterUntil(response.headers?.get("Retry-After"));
      await writeCache(KEY,{until,observedAt:new Date().toISOString()},cache,Math.max(60_000,until-Date.now()));
    }
    return response;
  });
  mockQueue=run.then(()=>undefined,()=>undefined);
  mockInFlight.set(requestKey,run);
  try{return copy(await run);}finally{mockInFlight.delete(requestKey);}
}

export async function fetchWithCfbBackoff(url,options={},env={},fetchFn=fetch) {
  // Do NOT share Response / Promise / ReadableStream across Cloudflare requests.
  // An isolate can process distinct requests in different I/O contexts.
  // D1's atomic reservation, not module-global promises, is our deduplication.
  if(!["api.collegefootballdata.com","api.collegebasketballdata.com"].includes(new URL(url).hostname))
    return fetchFn(url,options);
  const cache=env.caches||globalThis.caches?.default;
  // Injected fetchFn is reserved for offline mock tests; never production.
  if(fetchFn!==fetch)return runMockAcquisition(url,options,env,fetchFn,cache);
  const blocked=await readCache(KEY,cache,24*60*60_000);
  if(blocked?.until>Date.now())
    return Response.json({error:"CFBD cooldown; cached/public sources required"},{status:429,
      headers:{"Retry-After":String(Math.ceil((blocked.until-Date.now())/1000)),
        "X-FBIS-Cooldown":"true"}});
  // Explicit injected transports without D1 are restricted to offline test doubles.
  // Production always needs a shared D1 acquisition permit.
  const offlineTestTransport=fetchFn!==fetch && !env.DB?.prepare;
  const permit=offlineTestTransport?{allowed:false,offlineTest:true}:await reserveCfbdRequest(env,url);
  if(!offlineTestTransport&&!permit.allowed)
    return Response.json({error:permit.reason},{status:503,
      headers:{"X-FBIS-CFBD-Gate":permit.reason}});
  let response;
  try {response=await fetchFn(url,options);}
  catch(err) {await completeCfbdRequest(env,permit,0,null);throw err;}
  await completeCfbdRequest(env,permit,response.status,response);
  if(response.status===429){
    const until=retryAfterUntil(response.headers?.get?.("Retry-After"));
    await writeCache(KEY,{until,observedAt:new Date().toISOString()},cache,Math.max(60_000,until-Date.now()));
  }
  return response;
}
