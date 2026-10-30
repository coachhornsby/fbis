import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {POLY_SNAPSHOT_READ_JOB} from '../../services/account-budget/executionJobs.mjs';
import {STREAM_SNAPSHOT_KEY,validateStreamRoster} from '../../services/polymarket-us-stream/boundedSession.mjs';
const MAX_QUOTE_AGE_MS=120000;
const price=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1?x:null;
export async function loadBoundedPolymarketSnapshot(env,{now=new Date()}={}){
 try{
  env=await beginJobExecution(env,POLY_SNAPSHOT_READ_JOB);
  const object=await env.ARCHIVE.get(STREAM_SNAPSHOT_KEY);
  if(!object)return {ok:false,code:'NO_BOUNDED_SNAPSHOT'};
  const value=await object.json(),at=Date.parse(value?.capturedAt),started=Date.parse(value?.startedAt);
  if(value?.version!==1||value.source!=='Polymarket US'||value.scope!=='BOUNDED_RESEARCH_CAPTURE'||!Number.isFinite(at)||!Number.isFinite(started)||started>at||at>+now||+now-at>MAX_QUOTE_AGE_MS||!Array.isArray(value.roster)||!value.roster.length||value.roster.length>50||!Array.isArray(value.quotes)||value.quotes.length>50)return {ok:false,code:'STALE_OR_INVALID_BOUNDED_SNAPSHOT'};
  const roster=validateStreamRoster({version:2,source:value.source,capturedAt:value.capturedAt,expiresAt:new Date(at+900000).toISOString(),roster:value.roster},+now);
  const seen=new Set(),quotes=[];
  for(const q of value.quotes){
   if(typeof q.marketSlug!=='string'||seen.has(q.marketSlug))throw Error('DUPLICATE_QUOTE_IDENTITY');seen.add(q.marketSlug);
   if(q.marketState!=null&&q.marketState!=='MARKET_STATE_OPEN')continue;
   const received=Date.parse(q.receivedAt),provider=Date.parse(q.sourceObservedAt);
   if(!Number.isFinite(received)||received<started||received>at||+now-received>MAX_QUOTE_AGE_MS||q.quoteKind!=='DISPLAY_REFERENCE_NOT_EXECUTABLE')continue;
   // Unknown source time remains unknown. Collection time never verifies it.
   if(q.sourceObservedAt!=null&&(!Number.isFinite(provider)||provider>received||received-provider>MAX_QUOTE_AGE_MS))continue;
   const bid=price(q.bestBid),ask=price(q.bestAsk);if(ask==null||bid!=null&&bid>ask)continue;
   quotes.push({marketSlug:q.marketSlug,bestBid:bid,bestAsk:ask,receivedAt:new Date(received).toISOString(),sourceObservedAt:Number.isFinite(provider)?new Date(provider).toISOString():null});
  }
  return {ok:true,roster,quotes,capturedAt:value.capturedAt,code:'BOUNDED_REFERENCE_SNAPSHOT',continuous:false};
 }catch{return {ok:false,code:'BOUNDED_SNAPSHOT_UNAVAILABLE'};}
}
export function selectBoundedPolymarketOffers(snapshot,games=[],sport){
 const byId=new Map();
 if(!snapshot?.ok)return {byId,available:false,diagnostics:{source:'R2_BOUNDED_STREAM',status:snapshot?.code||'UNAVAILABLE',d1Queries:0}};
 const gamesById=new Map(games.map(g=>[String(g.id),g])),quotes=new Map(snapshot.quotes.map(q=>[q.marketSlug,q]));
 for(const row of snapshot.roster){
  const fixture=gamesById.get(row.canonical_event_id),binding=row.displayBinding,q=quotes.get(row.source_market_id);
  if(row.sport!==sport||!fixture||!binding||!q||String(fixture.sport||sport)!==sport||!Number.isFinite(Date.parse(fixture.start))||Math.abs(Date.parse(fixture.start)-Date.parse(row.event_start_time))>60000)continue;
  const offer={source:'Polymarket US WebSocket',marketFamily:row.market_family,period:'full_game',side:binding.side,line:binding.line,contractPrice:q.bestAsk,sourceMarketId:row.source_market_id,sourceOutcomeId:binding.sourceOutcomeId,collectedAt:q.receivedAt,observedAt:q.sourceObservedAt,sourceObservedAt:q.sourceObservedAt,providerObservedAt:q.sourceObservedAt,quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE',deliveryStore:'R2_BOUNDED_STREAM',raw:{bestBid:q.bestBid,bestAsk:q.bestAsk},priceVerified:false,providerTimestampVerified:false,identityVerified:false,marketAvailable:false,executionEligible:false,canQualify:false,canAuthorizeWager:false};
  const list=byId.get(row.canonical_event_id)||[];list.push(offer);byId.set(row.canonical_event_id,list);
 }
 return {byId,available:byId.size>0,diagnostics:{source:'R2_BOUNDED_STREAM',status:snapshot.code,continuous:false,d1Queries:0,displayedOffers:[...byId.values()].reduce((n,rows)=>n+rows.length,0)}};
}
