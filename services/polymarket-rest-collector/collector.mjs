import {beginJobExecution} from '../account-budget/jobScope.mjs';
import {POLY_REST_JOB} from '../account-budget/executionJobs.mjs';
import {ROSTER_SPORTS,stageBoundedStreamCandidates} from '../../functions/lib/boundedPolymarketRoster.js';
import {fixtureKey,validateFixtureManifest} from '../../functions/lib/polymarketFixtureArchive.js';
import {POLY_US_API,matchPolymarketUsEvent,polymarketUsMarketOffers,polymarketUsCanonicalSide} from '../../functions/lib/polymarketUs.js';
export const restKey=sport=>'market-sources/polymarket-us/bounded-rest-v1/'+sport;
// Official public endpoint: https://docs.polymarket.us/api-reference/events/get-events
export async function collectBoundedPolymarketRest(env,{sport,slot=Math.floor(Date.now()/60000),now=Date.now(),fetchImpl=fetch}={}){
 if(!ROSTER_SPORTS.includes(sport)||!Number.isSafeInteger(slot)||Math.abs(slot-Math.floor(now/60000))>1)throw Error('INVALID_REST_SCOPE');
 env=await beginJobExecution(env,POLY_REST_JOB,{reservationId:'poly-rest-'+sport+'-'+slot,fetchImpl,network:{origin:POLY_US_API,path:'/v1/events'}});
 const stored=await env.ARCHIVE.get(fixtureKey(sport));if(!stored)return {ok:false,sport,code:'FIXTURE_MANIFEST_MISSING'};
 const manifest=validateFixtureManifest(await stored.json(),now);if(manifest.sport!==sport)throw Error('FIXTURE_SPORT_MISMATCH');
 if(!manifest.fixtures.length)return {ok:true,sport,status:'NO_FIXTURES',canAuthorizeWager:false};
 const pages=[],candidates=[],errors=[];let matched=0;
 for(const tag of manifest.providerTags){for(let page=0;page<2;page++){
  const url=new URL('/v1/events',POLY_US_API);
  for(const [key,value]of Object.entries({tagSlug:tag,active:true,closed:false,limit:20,offset:page*20,orderBy:'id',orderDirection:'asc',startTimeMin:new Date(now-48*3600000).toISOString(),startTimeMax:new Date(now+72*3600000).toISOString()}))url.searchParams.set(key,String(value));
  const response=await env.FBIS_JOB_FETCH(url.toString(),{headers:{accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();errors.push({tag,status:response.status});break;}
  const value=await response.json();if(!Array.isArray(value.events)||value.events.length>20)throw Error('PROVIDER_EVENT_PAGE_INVALID');
  pages.push({tag,offset:page*20,events:value.events});
  for(const event of value.events){
   if(!Array.isArray(event.markets)||event.markets.length>200)throw Error('PROVIDER_MARKET_CAPACITY');
   if(event.markets.some(m=>!Array.isArray(m.marketSides)||m.marketSides.length>4))throw Error('PROVIDER_SIDE_CAPACITY');
   const match=matchPolymarketUsEvent(event,manifest.fixtures,sport);if(!match.id)continue;matched++;
   const fixture=manifest.fixtures.find(g=>g.id===match.id);
   // Only bounded full-game positive contracts. Extra markets are reported as
   // partial coverage rather than silently enlarging a job or scanning history.
   for(const market of event.markets.slice(0,8)){
    if(!Array.isArray(market.marketSides)||market.marketSides.length>4)throw Error('PROVIDER_SIDE_CAPACITY');
    const offers=polymarketUsMarketOffers({...event,markets:[market]},sport,{canonicalId:match.id,capturedAt:new Date(now).toISOString(),maxMarkets:1});
    for(const offer of offers){
     if(offer.raw?.contractLong!==true||!['moneyline','spread','total'].includes(offer.marketFamily))continue;
     const side=polymarketUsCanonicalSide(offer,fixture,offer.league);
     candidates.push({sport,source_market_id:offer.sourceMarketId,canonical_event_id:match.id,market_family:offer.marketFamily,event_start_time:fixture.start,collected_at:new Date(now).toISOString(),...(offer.marketFamily==='moneyline'&&offer.period==='full_game'&&side?{displayBinding:{version:1,contractLong:true,period:'full_game',side,sourceOutcomeId:offer.sourceOutcomeId,line:null}}:{})});
    }
   }
  }
  if(value.events.length<20)break;
 }}
 const unique=new Map();for(const row of candidates){const previous=unique.get(row.source_market_id);if(previous&&previous.canonical_event_id!==row.canonical_event_id)throw Error('AMBIGUOUS_PROVIDER_CONTRACT');unique.set(row.source_market_id,row);}
 const selected=[...unique.values()].slice(0,50),receipt={version:1,sport,capturedAt:new Date(now).toISOString(),pages:pages.length,matchedEvents:matched,candidates:unique.size,selected:selected.length,complete:false,canQualify:false,canAuthorizeWager:false};
 await env.ARCHIVE.put(restKey(sport)+'/latest.json',JSON.stringify({version:1,sport,capturedAt:receipt.capturedAt,pages,complete:false,canAuthorizeWager:false}));
 // Staging gets its own reservation. Never pass an already scoped R2 binding
 // into a second lease: each hop uses the original environment supplied below.
 return {receipt,selected,errors};
}
export async function runBoundedPolymarketRest(originalEnv,options={}){
 const result=await collectBoundedPolymarketRest(originalEnv,options);
 if(!result.receipt)return result;
 const {receipt,selected,errors}=result;
 if(selected.length){const staged=await stageBoundedStreamCandidates(originalEnv,{sport:receipt.sport,candidates:selected,now:Date.parse(receipt.capturedAt)});receipt.staged=staged.ok;}
 else receipt.staged=false;
 // Receipt write remains under the collector's reservation; collect function
 // writes its bounded raw envelope. Stage outcome is returned, not re-written.
 return {ok:errors.length===0,sport:receipt.sport,...receipt,errors};
}
