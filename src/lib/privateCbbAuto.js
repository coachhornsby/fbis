import {validatePrivatePacket} from './privateBoardProjection.js';

const loaded=new Map();
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
