import {captureSignedKalshiMarkets,captureSignedKalshiExchangeStatus,captureKalshiSportsSeriesCatalog} from '../lib/kalshiSignedCollector.js';
import {KALSHI_BASE,KALSHI_DIAGNOSTIC_PATHS} from '../lib/kalshiAccount.js';
import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {KALSHI_CAPTURE_JOB,KALSHI_STATUS_JOB,KALSHI_CATALOG_JOB} from '../../services/account-budget/executionJobs.mjs';
const respond=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'}});
async function authorized(expected,provided,subtle){
  if(typeof expected!=="string"||expected.length<40
    ||typeof provided!=="string"||provided.length!==expected.length
    ||provided.length>256)return false;
  const enc=new TextEncoder();
  const [a,b]=await Promise.all([
    subtle.digest("SHA-256",enc.encode(expected)),
    subtle.digest("SHA-256",enc.encode(provided)),
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}

const scopes=Object.freeze({
 markets:{job:KALSHI_CAPTURE_JOB,path:KALSHI_DIAGNOSTIC_PATHS.markets,run:captureSignedKalshiMarkets},
 'exchange-status':{job:KALSHI_STATUS_JOB,path:KALSHI_DIAGNOSTIC_PATHS.status,run:captureSignedKalshiExchangeStatus},
 'series-catalog':{job:KALSHI_CATALOG_JOB,path:KALSHI_DIAGNOSTIC_PATHS.series,run:captureKalshiSportsSeriesCatalog},
});
const sports=new Set(['nfl','cfb','nba','cfb_spread','cfb_total','atp','wta','atp_challenger','itf_men','itf_women','atp_doubles','wta_doubles','itf_doubles','itf_women_doubles']);
export async function onRequestPost({request,env,fetchImpl=fetch,webCrypto=crypto}){
 if(!await authorized(env?.FBIS_KALSHI_RELAY_TOKEN,request.headers.get('x-fbis-kalshi-relay-token'),webCrypto.subtle))return respond({ok:false,code:'INTERNAL_COLLECTOR_ACCESS_DENIED'},403);
 const url=new URL(request.url),scope=url.searchParams.get('scope');
 if(!Object.hasOwn(scopes,scope||''))return respond({ok:false,code:'JOB_EXECUTION_NOT_CERTIFIED'},503);
 const operation=scopes[scope],sport=url.searchParams.get('sport');
 if(scope==='markets'&&!sports.has(sport))return respond({ok:false,code:'KALSHI_SPORT_NOT_ENABLED'},400);
 try{
  env=await beginJobExecution(env,operation.job,{fetchImpl,network:{origin:KALSHI_BASE,path:operation.path}});
 }catch{return respond({ok:false,code:'ACCOUNT_BUDGET_STOP',paused:true},503);}
 try{
  const result=await operation.run(env,{sport,fetchImpl:env.FBIS_JOB_FETCH,webCrypto});
  return respond(result,result.ok?200:result.rateLimited?429:503);
 }catch{return respond({ok:false,code:'BOUNDED_COLLECTION_STOPPED'},503);}
}
export async function onRequestGet(){return respond({ok:false,code:'INTERNAL_POST_REQUIRED'},405);}
