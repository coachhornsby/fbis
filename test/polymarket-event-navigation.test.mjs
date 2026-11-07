import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePolymarketEventNavigation as validate,polymarketEventNavigationFromSource as fromSource} from '../src/lib/polymarketEventNavigation.js';
import {polymarketUsMarketOffers} from '../functions/lib/polymarketUs.js';
import {buildStreamRosterManifest} from '../services/polymarket-us-stream/boundedSession.mjs';
import {decodeBoundedPolymarketSnapshot,selectBoundedPolymarketOffers} from '../functions/lib/boundedPolymarketBoard.js';
import {exchangeMarketLink} from '../src/lib/exchangeMarketLinks.js';
import {exchangeCardRows} from '../src/lib/exchangeCardRows.js';
import {exchangeGameMarkets} from '../src/lib/exchangeMarketExplorer.js';
// URL independently verified on the official website Nov 7, 2026. The provider
// response and IDs below are synthetic: no claim the current API supplies url.
const url='https://polymarket.us/sports/cfb/cfb-tx-missr-2026-11-07';
const at=Date.parse('2026-11-07T06:00:00Z'),stamp=new Date(at).toISOString(),start='2026-11-07T17:00:00Z';
const event={id:'synthetic-provider-event',slug:'cfb-tx-missr-2026-11-07',url,startTime:start,markets:[{slug:'synthetic-contract',sportsMarketType:'full_game_moneyline',marketSides:[{id:'synthetic-outcome',long:true,description:'Texas',price:.57}]}]};
const game={id:'synthetic-canonical',sport:'cfb',start};
const nav=()=>fromSource(event,{sport:'cfb',canonicalEventId:game.id,eventStart:start});
test('source URL required; slug or title alone never generates navigation',()=>{
 assert.equal(nav().url,url);
 assert.equal(fromSource({...event,url:undefined},{sport:'cfb',canonicalEventId:game.id,eventStart:start}),null);
 assert.equal(fromSource(event,{sport:'cfb',canonicalEventId:null,eventStart:start}),null);
});
test('reject mismatched identities and unsafe or unrelated destinations',()=>{
 for(const binding of [{sport:'cbb'},{canonicalEventId:'wrong'},{providerEventId:'wrong'},{eventStart:'2026-11-08T17:00:00Z'}])assert.equal(validate(nav(),binding),null);
 for(const u of ['https://polymarket.com/event/cfb-tx-missr-2026-11-07',url+'?market=wrong',url+'#trade',url.replace('cfb-tx','cfb-other'),url.replace('/cfb/','/nba/'),url.replace('polymarket.us','evil.invalid'),'https://user@polymarket.us/sports/cfb/cfb-tx-missr-2026-11-07'])assert.equal(validate({...nav(),url:u}),null,u);
});
test('source metadata survives normalization, roster, snapshot and selected offer',()=>{
 const offer=polymarketUsMarketOffers(event,'cfb',{canonicalId:game.id,capturedAt:stamp})[0];
 assert.equal(offer.raw.providerEventSlug,event.slug);assert.equal(offer.raw.eventNavigation.url,url);
 const candidate={sport:'cfb',canonical_event_id:game.id,provider_event_id:event.id,event_start_time:start,collected_at:stamp,source_market_id:'synthetic-contract',market_family:'moneyline',eventNavigation:offer.raw.eventNavigation,displayBinding:{version:1,contractLong:true,period:'full_game',side:'away',sourceOutcomeId:'synthetic-outcome',line:null}};
 const roster=buildStreamRosterManifest([candidate],{now:at}).roster;
 assert.deepEqual(roster[0].eventNavigation,nav());
 const snapshot={version:1,source:'Polymarket US',scope:'BOUNDED_RESEARCH_CAPTURE',startedAt:stamp,capturedAt:stamp,roster,quotes:[{marketSlug:'synthetic-contract',receivedAt:stamp,bestBid:.56,bestAsk:.57,quoteKind:'DISPLAY_REFERENCE_NOT_EXECUTABLE'}]};
 const selected=selectBoundedPolymarketOffers(decodeBoundedPolymarketSnapshot(snapshot,{now:at,retainLastObserved:true}),[game],'cfb').byId.get(game.id)[0];
 assert.deepEqual(selected.eventNavigation,nav());assert.equal(selected.executionEligible,false);
 assert.equal(buildStreamRosterManifest([{...candidate,eventNavigation:{...nav(),canonicalEventId:'wrong'}}],{now:at}).roster[0].eventNavigation,undefined);
});
test('game link clearly scoped as event and remains ineligible for wagering',()=>{
 const q={venue:'Polymarket',marketFamily:'moneyline',side:'away',line:null,ask:.57,transport:'WebSocket',receivedAt:stamp,eventStart:start,marketId:'synthetic-contract',eventNavigation:nav(),canAuthorizeWager:false};
 const link=exchangeMarketLink({source:'Polymarket US',sourceMarketId:q.marketId,eventNavigation:nav()});assert.equal(link.scope,'EVENT');assert.equal(link.label,'View game on Polymarket US');
 const cell=exchangeCardRows({...game,exchangeReferenceQuotes:[q]},at+3600000).find(r=>r.venue==='Polymarket'&&r.family==='moneyline').cells[0];
 assert.equal(cell.link.url,url);assert.equal(cell.stale,true);assert.equal(cell.canAuthorizeWager,false);
 const payload={ok:true,referenceOnly:true,canAuthorizeWager:false,byEvent:{[game.id]:[q]}};
 assert.equal(exchangeGameMarkets(payload,game,{now:at})[0].link.url,url);
 for(const eventNavigation of [{...nav(),canonicalEventId:'other'},{...nav(),eventStart:'2026-11-08T17:00:00Z'}]){
  const bad={...q,eventNavigation};
  assert.equal(exchangeCardRows({...game,exchangeReferenceQuotes:[bad]},at).find(r=>r.venue==='Polymarket'&&r.family==='moneyline').cells[0].link.scope,'SITE');
  assert.equal(exchangeGameMarkets({...payload,byEvent:{[game.id]:[bad]}},game,{now:at})[0].link.scope,'SITE');
 }
 assert.equal(exchangeCardRows({...game,exchangeReferenceQuotes:[{...q,marketStatus:'closed'}]},at).find(r=>r.venue==='Polymarket'&&r.family==='moneyline').cells[0].link,null);
});

test('verified game destination beats homepage when supplied contract link is invalid',()=>{
 const link=exchangeMarketLink({source:'Polymarket US',sourceMarketId:'synthetic-contract',marketUrl:'https://evil.invalid/',eventNavigation:nav()});
 assert.equal(link.scope,'EVENT');assert.equal(link.url,url);
});
