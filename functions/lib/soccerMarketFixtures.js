/** Independent ESPN fixture identities. Provider IDs and prices never create fixtures. */
export const SOCCER_MARKET_LEAGUES = ['eng.1','eng.2','esp.1','ger.1','ita.1','fra.1','usa.1','mex.1','uefa.champions','uefa.europa','usa.nwsl'];
export async function loadSoccerMarketFixtures(env,{now=new Date(),fetchImpl=fetch,force=false}={}) {
 const day=now.toISOString().slice(0,10),key=`soccer/market-fixtures/${day}.json`;
 if(!force&&env.ARCHIVE?.get){const cached=await env.ARCHIVE.get(key);if(cached){const d=await cached.json();if(Date.parse(d.observedAt)<=now.getTime()&&now.getTime()-Date.parse(d.observedAt)<3600000)return d;}}
 const days=Array.from({length:4},(_,i)=>new Date(now.getTime()+i*86400000).toISOString().slice(0,10).replaceAll("-",""));
 const jobs=SOCCER_MARKET_LEAGUES.flatMap(league=>days.map(stamp=>({league,stamp})));
 const fixtures=[],errors=[];
 // Bound concurrency and request count; this endpoint uses free schedule reads only.
 for(let i=0;i<jobs.length;i+=8)await Promise.all(jobs.slice(i,i+8).map(async ({league,stamp})=>{
  try{const r=await fetchImpl(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${stamp}&limit=100`,{signal:AbortSignal.timeout(15000)});
   if(!r.ok)throw Error(`HTTP_${r.status}`);const body=await r.json();if(!Array.isArray(body.events))throw Error('INVALID_SCHEDULE');
   for(const e of body.events){const c=e.competitions?.[0],home=c?.competitors?.find(x=>x.homeAway==='home'),away=c?.competitors?.find(x=>x.homeAway==='away');
    if(!e.id||!Number.isFinite(Date.parse(e.date))||!home?.team?.displayName||!away?.team?.displayName)continue;
    fixtures.push({id:String(e.id),sport:'soccer',league,start:e.date,home_name:home.team.displayName,away_name:away.team.displayName,home_abbr:home.team.abbreviation,away_abbr:away.team.abbreviation,fixtureObservedAt:now.toISOString(),fixtureSource:'ESPN'});
   }
  }catch(e){errors.push({league,error:String(e.message)})}
 }));
 const result={observedAt:now.toISOString(),fixtures:[...new Map(fixtures.map(g=>[g.id,g])).values()],errors,complete:errors.length===0};
 if(env.ARCHIVE?.put)await env.ARCHIVE.put(key,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});
 return result;
}
