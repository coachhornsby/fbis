import {authorizeHarvest,unauthorizedBody} from '../lib/auth.js';
import {captureFreeTennisCurrentSeason} from '../lib/tennisFreeCurrentCollector.js';
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const auth=authorizeHarvest(request,env);
 if(!auth.ok)return json(unauthorizedBody(auth.reason),403);
 const u=new URL(request.url),tour=u.searchParams.get('tour');
 if(!['atp','wta'].includes(tour))return json({ok:false,reason:'TOUR_REQUIRED'},400);
 if(env?.TENNIS_FREE_RESEARCH_ENABLED!=='true')
  return json({ok:false,reason:'RESEARCH_DISABLED_UNTIL_DB_AND_SOURCE_REVIEW'},409);
 try{return json(await captureFreeTennisCurrentSeason(env,{tour}));}
 catch(e){return json({ok:false,reason:String(e?.message||'RESEARCH_INGEST_FAILED'),
  contractTradingAuthorized:false},503);}
}
