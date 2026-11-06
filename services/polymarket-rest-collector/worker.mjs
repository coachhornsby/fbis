import {runBoundedPolymarketRest} from './collector.mjs';
import {refreshExchangeFixtures} from './fixtures.mjs';
export const ACTIVE_EXCHANGE_SPORTS=['nfl','cfb','cbb','nba','nhl'];
export default{
 async scheduled(event,env,ctx){
  const slot=Math.floor((event?.scheduledTime||Date.now())/60000);
  if(!Number.isSafeInteger(slot)||Math.abs(slot-Math.floor(Date.now()/60000))>1)return;
  // One sport per two-minute slot, rotating five active leagues.
  // No concurrent fanout or implicit retries; admission precedes all IO.
  const sport=ACTIVE_EXCHANGE_SPORTS[Math.floor(slot/2)%ACTIVE_EXCHANGE_SPORTS.length];
  ctx.waitUntil((async()=>{await refreshExchangeFixtures(env,{sport,slot});return runBoundedPolymarketRest(env,{sport,slot});})().catch(()=>({ok:false,code:'BOUNDED_REST_STOPPED'})));
 },
 fetch(){return Response.json({ok:false,code:'NO_PUBLIC_COLLECTION'},{status:404,headers:{'cache-control':'no-store'}});}
};
