import {runBoundedPolymarketRest} from './collector.mjs';
import {ROSTER_SPORTS} from '../../functions/lib/boundedPolymarketRoster.js';
export default{
 async scheduled(event,env,ctx){
  const slot=Math.floor((event?.scheduledTime||Date.now())/60000);
  if(!Number.isSafeInteger(slot)||Math.abs(slot-Math.floor(Date.now()/60000))>1)return;
  // One sport per minute-slot, rotating all eleven. No concurrent fanout or
  // implicit retries. Actual schedules remain empty until cost clearance.
  const sport=ROSTER_SPORTS[slot%ROSTER_SPORTS.length];
  ctx.waitUntil(runBoundedPolymarketRest(env,{sport,slot}).catch(()=>({ok:false,code:'BOUNDED_REST_STOPPED'})));
 },
 fetch(){return Response.json({ok:false,code:'NO_PUBLIC_COLLECTION'},{status:404,headers:{'cache-control':'no-store'}});}
};
