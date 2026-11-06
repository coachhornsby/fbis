// Anonymous read: precomputed, sanitized public model results only. No auth or provider calls.
import {PRIVATE_RECOVERY_SPORTS} from '../../functions/lib/privateFourSportProjection.js';
import {validatePublicProjectionSummary} from '../../functions/lib/publicFourSportProjection.js';
const loaded=new Map();
export function clearPublicSportSnapshot(sport,date){loaded.delete(sport+':'+date);}
export async function loadPublicSportSnapshot(sport,date){
  if(!PRIVATE_RECOVERY_SPORTS.includes(sport)||!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Error('INVALID_SPORT_OR_DATE');
  const key=sport+':'+date;
  if(loaded.has(key))return loaded.get(key);
  const promise=fetch('/api/public/sports/'+sport+'/'+date,{credentials:'omit',cache:'no-store'})
    .then(async response=>{
      if(!response.ok)throw Error(response.status===404?'NO_PUBLIC_MODEL_SNAPSHOT':'PUBLIC_MODEL_UNAVAILABLE');
      const body=await response.json();
      if(body.state!=='PUBLIC_RESEARCH_ONLY'||body.sport!==sport||body.date!==date)
        throw Error('INVALID_PUBLIC_MODEL_RESPONSE');
      return {packet:validatePublicProjectionSummary(body.packet,{sport,date}),offers:[],verifiedAt:new Date().toISOString()};
    });
  loaded.set(key,promise);promise.catch(()=>loaded.delete(key));
  return promise;
}
