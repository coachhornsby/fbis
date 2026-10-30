import {publishBoundedStreamRoster} from '../../functions/lib/boundedPolymarketRoster.js';
export default{
 async scheduled(event,env,ctx){
  const slot=Math.floor((event?.scheduledTime||Date.now())/900000);
  if(!Number.isSafeInteger(slot)||Math.abs(slot-Math.floor(Date.now()/900000))>1)return;
  ctx.waitUntil(publishBoundedStreamRoster(env,{reservationId:'poly-roster-'+slot}).catch(()=>({ok:false,code:'ROSTER_PUBLICATION_STOPPED'})));
 },
 fetch(){return Response.json({ok:false,code:'NO_PUBLIC_ROSTER_CONTROLS'},{status:404,headers:{'cache-control':'no-store'}});}
};
