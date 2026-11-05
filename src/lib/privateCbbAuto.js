import {validatePrivatePacket} from './privateBoardProjection.js';

const loaded=new Map();
export function clearCbbSnapshot(date){if(date)loaded.delete(date);else loaded.clear();}

export async function loadCbbSnapshot(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_DATE');
 if(loaded.has(date))return loaded.get(date);
 const promise=fetch('/api/private/cbb/'+date,{credentials:'same-origin',cache:'no-store'})
  .then(async res=>{
    if(!res.ok)throw Error(res.status===401||res.status===403?'PRIVATE_SIGN_IN_REQUIRED':res.status===404?'NO_CBB_SNAPSHOT':'PRIVATE_DATA_UNAVAILABLE');
    const response=await res.json();
    if(response.state!=='PRIVATE_RESEARCH_ONLY'||response.date!==date)throw Error('INVALID_PRIVATE_RESPONSE');
    const packet=validatePrivatePacket(response.packet);
    if(packet.events.some(event=>event.date!==date))throw Error('CROSS_DATE_PACKET');
    const offers=Array.isArray(response.markets?.offers)?response.markets.offers:[];
    return {packet,offers,verifiedAt:new Date().toISOString()};
  });
 loaded.set(date,promise);
 promise.catch(()=>loaded.delete(date));
 return promise;
}

/** One owner-authenticated attempt on a visit, never on an old or future slate. */
export function shouldAutoRefreshCbb({date,today,packet=null,status=null,attempted=false,now=Date.now()}){
 if(attempted||date!==today)return false;
 if(packet)return Number.isFinite(Date.parse(packet.expiresAt))&&Date.parse(packet.expiresAt)<=now+15*60*1000;
 return status==='NO_CBB_SNAPSHOT';
}

/** Fetch only via the existing owner-only POST route. Browser supplies same-origin cookies. */
export async function requestAutoCbbRefresh(date,{fetchFn=fetch}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_DATE');
 const res=await fetchFn('/api/private/cbb/refresh/manual',{
  method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
  headers:{'Content-Type':'application/json','X-FBIS-Manual-Refresh':'1'},
  body:JSON.stringify({date})
 });
 let body=null;try{body=await res.json();}catch{}
 if(!body||typeof body.state!=='string')return {ok:false,state:'REFRESH_RESPONSE_UNAVAILABLE'};
 return {ok:res.ok,state:body.state,reason:typeof body.reason==='string'?body.reason:null,
  primaryProjections:Number.isInteger(body.primaryProjections)?body.primaryProjections:0};
}
