import { buildSlate } from './slateEngine.js';
import { independentPropRows,loadPropFixturesAndPlayers,resolvePropModelIdentities,resolvePropResearchEnv } from './propResearchData.js';
import { chicagoDayBounds } from './chicagoDayBounds.js';
import { freezePropForecasts } from './propForecastArchive.js';
export async function capturePropForecastJob(env,{now=new Date(),webCrypto=globalThis.crypto}={}){
 const sport=['nba','nfl','nhl','mlb'][Math.floor(now.getTime()/(15*60*1000))%4];
 const owner=await resolvePropResearchEnv(env,sport);if(!owner.ok)return {ok:false,reason:'SPORT_OWNER_UNAVAILABLE',sport};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 let date=day;
 try{const next=await owner.db.prepare("SELECT date FROM games WHERE sport=? AND julianday(start)>julianday(?) AND date>=? AND date<=date(?,'+7 days') ORDER BY start LIMIT 1").bind(sport,now.toISOString(),day,day).first();if(next?.date)date=next.date;}catch{return {ok:false,reason:'FORECAST_FIXTURE_READ_FAILED',sport};}
 const slate=await buildSlate(sport,date,{...env,caches:typeof caches==='undefined'?null:caches.default,parlayCacheOnly:true,cfbdScheduleFallback:false});
 const context=await loadPropFixturesAndPlayers(env,{...chicagoDayBounds(date),sport});
 if(context.diagnostics.length)return {ok:false,reason:'FORECAST_IDENTITY_CONTEXT_UNAVAILABLE',sport,diagnostics:context.diagnostics};
 const rows=resolvePropModelIdentities(independentPropRows(slate,{now:now.getTime()}),context);
 const result=await freezePropForecasts(env,rows,{now,webCrypto});
 const receipt={...result,sport,date,attemptedAt:now.toISOString(),candidateProjections:rows.length};
 await env.ARCHIVE.put('player-props/forecasts/v1/'+sport+'/last-capture.json',JSON.stringify(receipt),{httpMetadata:{contentType:'application/json'}});
 return receipt;
}
