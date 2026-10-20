const requests=new Map();
export function fetchPropResearch(row,{historyOnly=false}={}) {
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.start_time));
 const q=new URLSearchParams({sport:row.sport,date:day,playerId:row.canonicalPlayerId,eventId:row.canonicalEventId,market:row.canonical_market});
 if(row.contractId){q.set('contractId',row.contractId);q.set('contractSide',row.side||'yes');}
 if(historyOnly)q.set('historyOnly','1');
 const key=q.toString(),cached=requests.get(key);
 if(cached&&Date.now()-cached.at<120000)return cached.promise;
 const promise=fetch('/api/prop-research?'+key,{credentials:'same-origin'}).then(async r=>{const body=await r.json();if(!r.ok||!body.ok)throw Error(body.error||`HTTP ${r.status}`);return body;}).catch(e=>{requests.delete(key);throw e;});
 if(requests.size>200)requests.delete(requests.keys().next().value);
 requests.set(key,{promise,at:Date.now()});return promise;
}
