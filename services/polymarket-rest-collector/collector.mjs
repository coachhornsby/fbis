import {verifiedOppositeBinding} from '../../functions/lib/polymarketOppositeBinding.js';
import {pregameDiscoveryPlan,pregameDiscoveryUrl,restReferenceSnapshot} from './pregame.mjs';
import {beginJobExecution} from '../account-budget/jobScope.mjs';
import {POLY_REST_JOB} from '../account-budget/executionJobs.mjs';
import {ROSTER_SPORTS,stageBoundedStreamCandidates} from '../../functions/lib/boundedPolymarketRoster.js';
import {fixtureKey,validateFixtureManifest} from '../../functions/lib/polymarketFixtureArchive.js';
import {POLY_US_API,matchPolymarketUsEvent,polymarketUsMarketOffers,polymarketUsCanonicalSide} from '../../functions/lib/polymarketUs.js';
export const restKey=sport=>'market-sources/polymarket-us/bounded-rest-v1/'+sport;

/** Translate source-confirmed full-game contracts into a display identity.
 * A spread/total can never borrow a line or side from another market. */
export function verifiedFullGameDisplayBinding(offer,fixture){
 if(!fixture||offer?.raw?.contractLong!==true||offer.period!=='full_game')return null;
 const id=offer.sourceOutcomeId;
 if(typeof id!=='string'||!id.length||id.length>160)return null;
 const base={version:1,contractLong:true,period:'full_game',sourceOutcomeId:id};
 if(offer.marketFamily==='moneyline'){
  const side=polymarketUsCanonicalSide(offer,fixture,offer.league);
  return side==='home'||side==='away'?{...base,side,line:null}:null;
 }
 if(offer.marketFamily==='spread'){
  const side=polymarketUsCanonicalSide(offer,fixture,offer.league);
  if(!['away','home'].includes(side))return null;
  const text=String(offer.raw?.providerSide?.description||'').trim();
  const result=text.match(/\s([+-]\d+(?:\.\d+)?)$/);
  const line=result?Number(result[1]):NaN;
  if(!Number.isFinite(line)||Math.abs(line)>1000||
    (Number.isFinite(Number(offer.line))&&offer.line!=null&&Math.abs(Math.abs(Number(offer.line))-Math.abs(line))>0.001))return null;
  return {...base,side,line};
 }
 if(offer.marketFamily==='total'){
  const label=String(offer.raw?.providerSide?.description||offer.side||'').trim().toLowerCase();
  const side=/^over(?:\s|$)/.test(label)?'over':/^under(?:\s|$)/.test(label)?'under':null;
  const line=Number(offer.line);
  if(!side||offer.line==null||!Number.isFinite(line)||line<=0||line>1000)return null;
  return {...base,side,line};
 }
 return null;
}
/** Enrich only an unambiguous pair from this exact provider market response. */
export function verifiedFullGamePairBinding(long,offers,fixture){
 const binding=verifiedFullGameDisplayBinding(long,fixture);
 if(!binding)return null;
 const genuineId=o=>{const id=o?.raw?.providerSide?.id;return (typeof id==='string'&&id.length>0||Number.isSafeInteger(id)&&id>0)&&String(id)===o.sourceOutcomeId;};
 // Reject fallback labels as outcome IDs, duplicate/ambiguous polarity, and
 // negated labels: an opposite team/side must actually be source-authored.
 if(offers.length!==2||offers.filter(o=>o.raw?.contractLong===true).length!==1||!genuineId(long)||
   /^not\s/i.test(String(long.raw.providerSide.team?.name||long.raw.providerSide.description||'')))return binding;
 const short=offers.find(o=>o.raw?.contractLong===false);
 if(!short||!genuineId(short)||short.sourceOutcomeId===long.sourceOutcomeId||
   short.sourceMarketId!==long.sourceMarketId||short.period!==long.period||short.marketFamily!==long.marketFamily||
   /^not\s/i.test(String(short.raw.providerSide.team?.name||short.raw.providerSide.description||'')))return binding;
 // Reuse identity parsing, explicitly checking original short polarity above.
 const opposite=verifiedFullGameDisplayBinding({...short,raw:{...short.raw,contractLong:true}},fixture);
 if(!opposite)return binding;
 const paired={...binding,oppositeSide:opposite.side,oppositeLine:opposite.line,oppositeSourceOutcomeId:opposite.sourceOutcomeId};
 return verifiedOppositeBinding(paired,long.marketFamily,long.sport)?paired:binding;
}
/** Strict source-authored CBB 1H total binding. Never infer a period from the UI or a full-game line. */
export function verifiedCbbFirstHalfTotalBinding(offer,fixture){
 if(!fixture||offer?.sport!=='cbb'||offer?.marketFamily!=='total'||
  offer?.period!=='first_half'||offer?.raw?.contractLong!==true)return null;
 const market=offer.raw.providerMarket;
 // Require a provider-specific first-half market type, not generic TOTAL alone.
 if(!/first_half/.test(String(market?.sportsMarketType||'').toLowerCase()))return null;
 const id=offer.sourceOutcomeId;
 if(typeof id!=='string'||!id.length||id.length>160)return null;
 const description=String(offer.raw?.providerSide?.description||offer.side||'').trim().toLowerCase();
 const side=/^over(?:\s|$)/.test(description)?'over':/^under(?:\s|$)/.test(description)?'under':null;
 const line=offer.line==null?NaN:Number(offer.line);
 if(!side||!Number.isFinite(line)||line<=0||line>150||
  Math.abs(line*2-Math.round(line*2))>1e-8||Math.round(line*2)%2!==1)return null;
 return {version:1,contractLong:true,period:'first_half',sourceOutcomeId:id,side,line};
}
// Official public endpoint: https://docs.polymarket.us/api-reference/events/get-events
export async function collectBoundedPolymarketRest(env,{sport,slot=Math.floor(Date.now()/60000),now=Date.now(),fetchImpl=fetch}={}){
 if(!ROSTER_SPORTS.includes(sport)||!Number.isSafeInteger(slot)||Math.abs(slot-Math.floor(now/60000))>1)throw Error('INVALID_REST_SCOPE');
 env=await beginJobExecution(env,POLY_REST_JOB,{reservationId:'poly-rest-'+sport+'-'+slot,fetchImpl,network:{origin:POLY_US_API,path:'/v1/events'}});
 const stored=await env.ARCHIVE.get(fixtureKey(sport));if(!stored)return {ok:false,sport,code:'FIXTURE_MANIFEST_MISSING'};
 const manifest=validateFixtureManifest(await stored.json(),now);if(manifest.sport!==sport)throw Error('FIXTURE_SPORT_MISMATCH');
 if(!manifest.fixtures.length)return {ok:true,sport,status:'NO_FIXTURES',canAuthorizeWager:false};
 const pregame=env.FBIS_POLYMARKET_PREGAME_REST==='true';
 const pages=[],candidates=[],errors=[],referenceMarkets=new Map();let matched=0;
 // One list page + at most three exact-slug pages for CBB. The total stays
 // within the existing four-request account-budget certificate. Other sports
 // retain the original two-page-per-tag scan.
 const plan=pregame?pregameDiscoveryPlan(manifest,{now,slot}):sport==='cbb'?[{tag:manifest.providerTags[0],page:0}]:
  manifest.providerTags.flatMap(tag=>[0,1].map(page=>({tag,page})));
 const acceptedEvents=[],exhaustedTags=new Set(),failedTags=new Set();
 const processEvents=events=>{
  for(const event of events){
   if(!Array.isArray(event.markets)||event.markets.length>200)throw Error('PROVIDER_MARKET_CAPACITY');
   if(event.markets.some(m=>!Array.isArray(m.marketSides)||m.marketSides.length>4))throw Error('PROVIDER_SIDE_CAPACITY');
   const match=matchPolymarketUsEvent(event,manifest.fixtures,sport);if(!match.id)continue;matched++;
   const fixture=manifest.fixtures.find(g=>g.id===match.id);
   if(pregame&&(Date.parse(fixture.start)<=now||(event.live===true||event.eventState?.live===true)&&event.closed!==true&&event.ended!==true))continue;
   // Only bounded full-game positive contracts. Extra markets are reported as
   // partial coverage rather than silently enlarging a job or scanning history.
   // Inspect up to 24 markets from the already bounded response; no new calls.
   // Never stage contracts with unverifiable side, threshold, or period.
   // Prefer source-labeled CBB first-half totals within the existing 24-market cap.
   // No additional provider calls or increase to the bounded roster.
   const markets=sport==='cbb'?[...event.markets].sort((a,b)=>
    Number(/first_half/.test(String(b?.sportsMarketType||'').toLowerCase())&&String(b?.sportsMarketType||'').toLowerCase().includes('total'))-
    Number(/first_half/.test(String(a?.sportsMarketType||'').toLowerCase())&&String(a?.sportsMarketType||'').toLowerCase().includes('total'))):event.markets;
   for(const market of markets.slice(0,24)){
    const referenceMarket=event.closed===true||event.ended===true?{...market,closed:true}:market;
    if(!Array.isArray(market.marketSides)||market.marketSides.length>4)throw Error('PROVIDER_SIDE_CAPACITY');
    const offers=polymarketUsMarketOffers({...event,markets:[market]},sport,{canonicalId:match.id,capturedAt:new Date(now).toISOString(),maxMarkets:1});
    // US 1H totals use one YES instrument: Over is long, Under is short.
    // Stage a single slug only when BOTH provider-authored sides agree on
    // the identical line; the NO reference cost comes from 1 - YES bid.
    if(sport==='cbb'&&offers.some(o=>o.period==='first_half')){
     const long=offers.find(o=>verifiedCbbFirstHalfTotalBinding(o,fixture)?.side==='over');
     const short=offers.find(o=>o.period==='first_half'&&o.marketFamily==='total'&&
       o.raw?.contractLong===false&&/^under$/i.test(String(o.raw?.providerSide?.description||'').trim())&&
       o.line===long?.line&&o.sourceMarketId===long?.sourceMarketId&&
       typeof o.sourceOutcomeId==='string'&&o.sourceOutcomeId.length>0&&o.sourceOutcomeId.length<=160);
     if(!long||!short)continue;
     const displayBinding={...verifiedCbbFirstHalfTotalBinding(long,fixture),
       oppositeSide:'under',oppositeSourceOutcomeId:short.sourceOutcomeId};
     if(pregame)referenceMarkets.set(long.sourceMarketId,referenceMarket);
     candidates.push({sport,source_market_id:long.sourceMarketId,provider_event_id:long.raw.providerEventId,eventNavigation:long.raw.eventNavigation,canonical_event_id:match.id,
       market_family:'total',event_start_time:fixture.start,collected_at:new Date(now).toISOString(),displayBinding});
     continue;
    }
    for(const offer of offers){
     if(!['moneyline','spread','total'].includes(offer.marketFamily))continue;
     const displayBinding=verifiedFullGamePairBinding(offer,offers,fixture);
     if(!displayBinding)continue;
     if(pregame)referenceMarkets.set(offer.sourceMarketId,referenceMarket);
     candidates.push({sport,source_market_id:offer.sourceMarketId,provider_event_id:offer.raw.providerEventId,eventNavigation:offer.raw.eventNavigation,canonical_event_id:match.id,market_family:offer.marketFamily,event_start_time:fixture.start,collected_at:new Date(now).toISOString(),displayBinding});
    }
   }
  }
 };
 for(const query of plan){
  const {tag,page}=query;
  if(failedTags.has(tag)||!pregame&&exhaustedTags.has(tag))continue;
  const url=new URL('/v1/events',POLY_US_API);
  for(const [key,value] of Object.entries({tagSlug:tag,active:true,closed:false,limit:20,offset:page*20,
   orderBy:'id',orderDirection:'asc',startTimeMin:new Date(now-48*3600000).toISOString(),
   startTimeMax:new Date(now+72*3600000).toISOString()}))url.searchParams.set(key,String(value));
  const response=await env.FBIS_JOB_FETCH((pregame?pregameDiscoveryUrl(query):url).toString(),{headers:{accept:'application/json'}});
  if(!response.ok){await response.body?.cancel();errors.push({tag,status:response.status});failedTags.add(tag);exhaustedTags.add(tag);continue;}
  const value=await response.json();
  if(!Array.isArray(value.events)||value.events.length>20)throw Error('PROVIDER_EVENT_PAGE_INVALID');
  pages.push({tag,offset:page*20,events:value.events});
  processEvents(value.events);
  if(sport==='cbb')for(const e of value.events){
   const match=matchPolymarketUsEvent(e,manifest.fixtures,sport);
   const fixture=manifest.fixtures.find(g=>g.id===match.id);
   if(pregame&&(!fixture||Date.parse(fixture.start)<=now||
     (e.live===true||e.eventState?.live===true)&&e.closed!==true&&e.ended!==true))continue;
   if(typeof e.slug==='string'&&/^cbb-[a-z0-9-]{1,140}$/.test(e.slug)&&match.id)acceptedEvents.push(e);
  }
  if(value.events.length<20)exhaustedTags.add(tag);
 }
 if(sport==='cbb'&&acceptedEvents.length){
  const uniqueEvents=[...new Map(acceptedEvents.map(e=>[e.slug,e])).values()];
  const offset=(pregame?plan[0].detailRotation:Math.floor(slot/10))%uniqueEvents.length;
  for(let i=0;i<Math.min(3,uniqueEvents.length);i++){
   const selected=uniqueEvents[(offset+i)%uniqueEvents.length];
   const url=new URL('/v1/events',POLY_US_API);
   url.searchParams.set('slug',selected.slug);
   url.searchParams.set('limit','1');
   const response=await env.FBIS_JOB_FETCH(url.toString(),{headers:{accept:'application/json'}});
   if(!response.ok){await response.body?.cancel();errors.push({slugScope:'DETAIL_UNAVAILABLE',status:response.status});continue;}
   const detail=await response.json();
   if(!Array.isArray(detail.events)||detail.events.length>1)throw Error('PROVIDER_EVENT_DETAIL_INVALID');
   if(detail.events.length!==1||detail.events[0].slug!==selected.slug)throw Error('PROVIDER_EVENT_SLUG_MISMATCH');
   processEvents(detail.events);
  }
 }
 // A provider slug is one contract. Repeated pages may refresh its quote, but
 // must not silently relabel the same instrument's outcome, side or line.
 const identity=row=>JSON.stringify([row.canonical_event_id,row.market_family,
  row.event_start_time,row.displayBinding]);
 const unique=new Map();
 for(const row of candidates){
  const previous=unique.get(row.source_market_id);
  if(previous&&identity(previous)!==identity(row))throw Error('AMBIGUOUS_PROVIDER_CONTRACT');
  unique.set(row.source_market_id,row);
 }
 const selected=[...unique.values()].slice(0,50),receipt={version:1,sport,capturedAt:new Date(now).toISOString(),pages:pages.length,matchedEvents:matched,candidates:unique.size,selected:selected.length,complete:false,canQualify:false,canAuthorizeWager:false};
 const referenceSnapshot=pregame?restReferenceSnapshot(selected,referenceMarkets,now):null;
 // An empty or failed capture must not erase the last observed references.
 if(!pregame||referenceSnapshot.quotes.length)await env.ARCHIVE.put(restKey(sport)+'/latest.json',JSON.stringify({version:1,sport,capturedAt:receipt.capturedAt,pages:pregame?pages.map(p=>({tag:p.tag,offset:p.offset,eventCount:p.events.length})):pages,...(pregame?{referenceSnapshot}:{}),complete:false,canAuthorizeWager:false}));
 // Staging gets its own reservation. Never pass an already scoped R2 binding
 // into a second lease: each hop uses the original environment supplied below.
 return {receipt,selected,errors};
}
export async function runBoundedPolymarketRest(originalEnv,options={}){
 const result=await collectBoundedPolymarketRest(originalEnv,options);
 if(!result.receipt)return result;
 const {receipt,selected,errors}=result;
 if(originalEnv.FBIS_POLYMARKET_PREGAME_REST==='true'){receipt.staged=false;receipt.transport='REST';}
 else if(selected.length){const staged=await stageBoundedStreamCandidates(originalEnv,{sport:receipt.sport,candidates:selected,now:Date.parse(receipt.capturedAt)});receipt.staged=staged.ok;}
 else receipt.staged=false;
 // Receipt write remains under the collector's reservation; collect function
 // writes its bounded raw envelope. Stage outcome is returned, not re-written.
 return {ok:errors.length===0,sport:receipt.sport,...receipt,errors};
}
