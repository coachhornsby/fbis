import {verifiedOppositeBinding} from './polymarketOppositeBinding.js';
import {beginJobExecution} from '../../services/account-budget/jobScope.mjs';
import {POLY_SNAPSHOT_READ_JOB} from '../../services/account-budget/executionJobs.mjs';
import {STREAM_SNAPSHOT_KEY,validateStreamRoster} from '../../services/polymarket-us-stream/boundedSession.mjs';
const MAX_QUOTE_AGE_MS=120000;
const price=x=>typeof x==='number'&&Number.isFinite(x)&&x>0&&x<1?x:null;
const suppliedMarketUrl=(row,marketId)=>{
 const value=row?.marketUrl??row?.sourceMarketUrl;
 if(typeof value!=='string'||value.length>2048)return null;
 try{
  const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='polymarket.us'||u.username||u.password||u.port)return null;
  const parts=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if(!(parts.includes(marketId)&&parts.some(p=>/^(market|markets|contract|contracts)$/i.test(p)))&&!['market','marketId','market_id','slug'].some(k=>u.searchParams.get(k)===marketId))return null;
  return u.toString();
 }catch{return null;}
};
export async function loadBoundedPolymarketSnapshot(env,{now=new Date(),retainLastObserved=false,sport}={}){
 try{
  env=await beginJobExecution(env,POLY_SNAPSHOT_READ_JOB);
  const rest=env.FBIS_POLYMARKET_PREGAME_REST==='true'&&['nfl','cfb','cbb','nba','nhl'].includes(sport);
  const object=await env.ARCHIVE.get(rest?'market-sources/polymarket-us/bounded-rest-v1/'+sport+'/latest.json':STREAM_SNAPSHOT_KEY);
  if(!object)return {ok:false,code:'NO_BOUNDED_SNAPSHOT'};
  const value=await object.json();
  const result=decodeBoundedPolymarketSnapshot(rest?value.referenceSnapshot:value,{now,retainLastObserved,transport:rest?'REST':'WebSocket'});
  return {...result,transport:rest?'REST':'WebSocket'};
 }catch{return {ok:false,code:'BOUNDED_SNAPSHOT_UNAVAILABLE'};}
}
// Historical display is explicitly opt-in. Live/qualification readers keep their
// existing freshness limits, and all returned prices remain non-executable.
export function decodeBoundedPolymarketSnapshot(value,{now=new Date(),retainLastObserved=false,transport='WebSocket'}={}){
 try{
  const displayAgeMs=retainLastObserved&&transport==='REST'?900000:MAX_QUOTE_AGE_MS;
  const at=Date.parse(value?.capturedAt),started=Date.parse(value?.startedAt),clock=+now;
  if(!Number.isFinite(clock)||value?.version!==1||value.source!=='Polymarket US'||value.scope!=='BOUNDED_RESEARCH_CAPTURE'||!Number.isFinite(at)||!Number.isFinite(started)||started>at||at>clock||(!retainLastObserved&&clock-at>MAX_QUOTE_AGE_MS)||!Array.isArray(value.roster)||!value.roster.length||value.roster.length>50||!Array.isArray(value.quotes)||value.quotes.length>50)return {ok:false,code:'STALE_OR_INVALID_BOUNDED_SNAPSHOT'};
  // Validate the captured roster in its original time context for display only;
  // never rewrite its collected_at, event time or binding metadata.
  const roster=validateStreamRoster({version:2,source:value.source,capturedAt:value.capturedAt,expiresAt:new Date(at+900000).toISOString(),roster:value.roster},retainLastObserved?at:clock);
  const sourceRows=new Map(value.roster.map(r=>[r.source_market_id,r]));
  const rosterIds=new Set(roster.map(r=>r.source_market_id)),seen=new Set(),quotes=[],unavailableMarkets=[];
  for(const q of value.quotes){
   if(typeof q?.marketSlug!=='string'||seen.has(q.marketSlug))throw Error('DUPLICATE_QUOTE_IDENTITY');seen.add(q.marketSlug);
   if(!rosterIds.has(q.marketSlug))continue;
   const received=Date.parse(q.receivedAt),provider=Date.parse(q.sourceObservedAt);
   if(!Number.isFinite(received)||received<started||received>at||(!retainLastObserved&&clock-received>MAX_QUOTE_AGE_MS)||q.quoteKind!=='DISPLAY_REFERENCE_NOT_EXECUTABLE')continue;
   const unavailable=(marketStatus)=>{if(retainLastObserved)unavailableMarkets.push({venue:'Polymarket',marketId:q.marketSlug,receivedAt:new Date(received).toISOString(),marketStatus,sourceMarketState:q.marketState??null});};
   if(q.marketState!=null&&q.marketState!=='MARKET_STATE_OPEN'){
    unavailable(['MARKET_STATE_CLOSED','MARKET_STATE_RESOLVED','MARKET_STATE_SETTLED'].includes(q.marketState)?'closed':'invalid');continue;
   }
   // Unknown source time remains unknown. Old valid source observations can be
   // shown as stale, but malformed/future timestamps are never accepted.
   if(q.sourceObservedAt!=null&&(!Number.isFinite(provider)||provider>received)) {unavailable('invalid');continue;}
   if(!retainLastObserved&&q.sourceObservedAt!=null&&received-provider>MAX_QUOTE_AGE_MS)continue;
   const bid=price(q.bestBid),ask=price(q.bestAsk);
   if(ask==null||bid!=null&&bid>ask){unavailable('invalid');continue;}
   const stale=clock-received>displayAgeMs||(Number.isFinite(provider)&&clock-provider>displayAgeMs);
   quotes.push({marketSlug:q.marketSlug,bestBid:bid,bestAsk:ask,marketUrl:suppliedMarketUrl(q,q.marketSlug)||suppliedMarketUrl(sourceRows.get(q.marketSlug),q.marketSlug),receivedAt:new Date(received).toISOString(),sourceObservedAt:Number.isFinite(provider)?new Date(provider).toISOString():null,
    stale,fresh:!stale,ageSeconds:Math.floor((clock-received)/1000),sourceAgeSeconds:Number.isFinite(provider)?Math.floor((clock-provider)/1000):null,
    marketStatus:q.marketState==='MARKET_STATE_OPEN'?'open':'unknown',referenceOnly:true,executionEligible:false,canQualify:false,canAuthorizeWager:false});
  }
  return {ok:true,roster,quotes,unavailableMarkets,capturedAt:value.capturedAt,code:'BOUNDED_REFERENCE_SNAPSHOT',continuous:false,
   stale:clock-at>displayAgeMs,referenceOnly:true,executionEligible:false,canQualify:false,canAuthorizeWager:false};
 }catch{return {ok:false,code:'BOUNDED_SNAPSHOT_UNAVAILABLE'};}
}
export function selectBoundedPolymarketOffers(snapshot,games=[],sport){
 const byId=new Map();
 if(!snapshot?.ok)return {byId,available:false,diagnostics:{source:'R2_BOUNDED_STREAM',status:snapshot?.code||'UNAVAILABLE',d1Queries:0}};
 const gamesById=new Map(games.map(g=>[String(g.id),g])),quotes=new Map(snapshot.quotes.map(q=>[q.marketSlug,q]));
 for(const row of snapshot.roster){
  const fixture=gamesById.get(row.canonical_event_id),binding=row.displayBinding,q=quotes.get(row.source_market_id);
  if(row.sport!==sport||!fixture||!binding||!q||String(fixture.sport||sport)!==sport||!Number.isFinite(Date.parse(fixture.start))||Math.abs(Date.parse(fixture.start)-Date.parse(row.event_start_time))>60000)continue;
  const offer={source:snapshot.transport==='REST'?'Polymarket US REST':'Polymarket US WebSocket',marketFamily:row.market_family,period:binding.period,side:binding.side,line:binding.line,contractPrice:q.bestAsk,sourceMarketId:row.source_market_id,eventNavigation:row.eventNavigation??null,marketUrl:q.marketUrl??null,sourceOutcomeId:binding.sourceOutcomeId,collectedAt:q.receivedAt,observedAt:q.sourceObservedAt,sourceObservedAt:q.sourceObservedAt,providerObservedAt:q.sourceObservedAt,quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE',deliveryStore:snapshot.transport==='REST'?'R2_BOUNDED_REST':'R2_BOUNDED_STREAM',stale:q.stale===true,fresh:q.fresh===true,ageSeconds:q.ageSeconds??null,sourceAgeSeconds:q.sourceAgeSeconds??null,marketStatus:q.marketStatus??'unknown',referenceOnly:true,raw:{bestBid:q.bestBid,bestAsk:q.bestAsk},priceVerified:false,providerTimestampVerified:false,identityVerified:false,marketAvailable:false,executionEligible:false,canQualify:false,canAuthorizeWager:false};
  const list=byId.get(row.canonical_event_id)||[];list.push(offer);
  const opposite=verifiedOppositeBinding(binding,row.market_family,row.sport);
  if(opposite&&price(q.bestBid)!=null&&price(q.bestAsk)!=null&&q.bestBid<=q.bestAsk){
    // Single US instrument: buying synthetic NO costs 1 - the observed YES bid.
    // This is a raw reference, before fees/collateral and never an executable price.
    const noCost=Math.round((1-q.bestBid)*10000)/10000;
    if(price(noCost)!=null)list.push({...offer,side:opposite.side,line:opposite.line,contractPrice:noCost,
      sourceOutcomeId:opposite.sourceOutcomeId,quoteKind:'SYNTHETIC_NO_FROM_YES_BID_REFERENCE',
      raw:{...offer.raw,priceDerivation:'COMPLEMENT_OF_YES_BID'},priceVerified:false,
      executionEligible:false,canQualify:false,canAuthorizeWager:false});
  }
  byId.set(row.canonical_event_id,list);
 }
 return {byId,available:byId.size>0,diagnostics:{source:snapshot.transport==='REST'?'R2_BOUNDED_REST':'R2_BOUNDED_STREAM',status:snapshot.code,continuous:false,d1Queries:0,displayedOffers:[...byId.values()].reduce((n,rows)=>n+rows.length,0)}};
}
