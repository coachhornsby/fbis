// Private four-sport recovery read contract. CBB retains its independently licensed packet.
// No forecasts are calculated here. Missing dates must never reuse a prior day.
const SPORTS=Object.freeze(['nfl','nba','cfb']);
const cache=new Map();
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export function validateSportSnapshot(p,sport,date){
 if(!SPORTS.includes(sport)||!validDate(date)||p?.version!==1||p.visibility!=='PRIVATE_PERSONAL_ANALYSIS'||p.sport!==sport||p.date!==date||!Array.isArray(p.events)||p.events.length>300)throw Error('INVALID_SPORT_PACKET');
 const generated=Date.parse(p.generatedAt),expires=Date.parse(p.expiresAt);
 if(!Number.isFinite(generated)||!Number.isFinite(expires)||expires<=generated||expires-generated>24*3600000||p.canAuthorizeWager!==false)throw Error('INVALID_SPORT_PACKET');
 const seen=new Set();
 for(const e of p.events){
  if(String(e.eventId||'').length<1||seen.has(String(e.eventId))||e.date!==date||!Number.isFinite(Date.parse(e.start))||typeof e.homeId!=='string'||typeof e.awayId!=='string'||e.homeId===e.awayId)throw Error('INVALID_FIXTURE');
  if(Date.parse(e.start)<=generated||e.sourceCapturedAt==null||!Number.isFinite(Date.parse(e.sourceCapturedAt))||Date.parse(e.sourceCapturedAt)>generated||typeof e.modelId!=='string'||!e.modelId||typeof e.modelVersion!=='string'||!e.modelVersion)throw Error('INVALID_PROVENANCE');
  if(!['home','away','margin','total'].every(k=>finite(e[k]))||Math.abs(e.home-e.away-e.margin)>0.21||Math.abs(e.home+e.away-e.total)>0.21||e.home<0||e.away<0)throw Error('INVALID_FORECAST');
  if(e.canAuthorizeWager!==false)throw Error('INVALID_FORECAST_AUTHORITY');
  seen.add(String(e.eventId));
 }
 return p;
}
export async function loadSportSnapshot(sport,date){
 if(!SPORTS.includes(sport)||!validDate(date))throw Error('INVALID_SPORT_DATE');
 const key=sport+':'+date;
 if(cache.has(key))return cache.get(key);
 const promise=fetch('/api/private/projections/'+sport+'/'+date,{credentials:'same-origin',cache:'no-store'}).then(async res=>{
  if(!res.ok)throw Error(res.status===401||res.status===403?'PRIVATE_SIGN_IN_REQUIRED':res.status===404?'NO_SPORT_SNAPSHOT':'PRIVATE_DATA_UNAVAILABLE');
  const x=await res.json();
  if(x.state!=='PRIVATE_RESEARCH_ONLY'||x.date!==date||x.sport!==sport)throw Error('INVALID_PRIVATE_RESPONSE');
  return validateSportSnapshot(x.packet,sport,date);
 });
 cache.set(key,promise);
 promise.catch(()=>cache.delete(key));
 return promise;
}
export function sportProjectionFor(game,p,clock=Date.now()){
 if(!game||!p||game.sport!==p.sport||game.date!==p.date)return null;
 const e=p.events.find(x=>x.eventId===String(game.id));
 if(!e||e.homeId!==String(game.home?.espnId)||e.awayId!==String(game.away?.espnId)||Date.parse(e.start)!==Date.parse(game.start))return null;
 return {...e,expired:clock>=Date.parse(p.expiresAt),started:clock>=Date.parse(e.start)||game.status!=='scheduled',expiresAt:p.expiresAt};
}
