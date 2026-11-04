import {PRIVATE_RECOVERY_SPORTS,validateFourSportPacket} from '../../functions/lib/privateFourSportProjection.js';
const loaded=new Map();
export async function loadSportSnapshot(sport,date){
 if(!PRIVATE_RECOVERY_SPORTS.includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('INVALID_SPORT_OR_DATE');
 const key=sport+':'+date;
 if(loaded.has(key))return loaded.get(key);
 const promise=fetch('/api/private/sports/'+sport+'/'+date,{credentials:'same-origin',cache:'no-store'})
  .then(async response=>{
    if(!response.ok)throw Error(response.status===401||response.status===403?'PRIVATE_SIGN_IN_REQUIRED':response.status===404?'NO_PRIVATE_SNAPSHOT':'PRIVATE_DATA_UNAVAILABLE');
    const body=await response.json();
    if(body.state!=='PRIVATE_RESEARCH_ONLY'||body.sport!==sport||body.date!==date)throw Error('INVALID_PRIVATE_RESPONSE');
    return {packet:validateFourSportPacket(body.packet,{sport,date}),offers:Array.isArray(body.markets?.offers)?body.markets.offers:[],verifiedAt:new Date().toISOString()};
  });
 loaded.set(key,promise);promise.catch(()=>loaded.delete(key));
 return promise;
}
