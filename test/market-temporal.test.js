import test from 'node:test';
import assert from 'node:assert/strict';
import {marketTemporalStatus,providerObservationTime} from '../functions/lib/marketTemporal.js';
import {persistNormalizedMarketObservation} from '../functions/lib/marketObservationLedger.js';
const now=new Date('2026-10-13T16:00:00Z');
const input={source:'Polymarket US',eventId:'game',providerObservedAt:'2026-10-13T15:59:00Z',collectedAt:'2026-10-13T15:59:30Z',eventStartAt:'2026-10-13T18:00:00Z',projectionAsOf:'2026-10-13T16:00:00Z'};
test('source clock states retain research while independently gating prospective inputs',()=>{
 const current=marketTemporalStatus(input,{now});
 assert.equal(current.status,'CURRENT');assert.equal(current.prospectiveEvidenceEligible,true);assert.equal(current.wagerQualificationEligible,false);
 const unknown=marketTemporalStatus({...input,providerObservedAt:null},{now});
 assert.equal(unknown.status,'SOURCE_TIME_UNKNOWN');assert.equal(unknown.currentDisplayEligible,true);assert.equal(unknown.modelInputEligible,false);
 const old=marketTemporalStatus({...input,providerObservedAt:'2026-10-12T16:00:00Z'},{now});
 assert.equal(old.status,'STALE');assert.equal(old.researchEligible,true);assert.equal(old.currentDisplayEligible,false);
 for(const [patch,status] of [[{providerObservedAt:'2026-10-13T16:01:00Z'},'FUTURE_CLOCK'],[{collectedAt:'bad'},'INVALID'],[{eventId:null},'UNMATCHED']])assert.equal(marketTemporalStatus({...input,...patch},{now}).status,status);
 assert.equal(marketTemporalStatus({...input,eventStartAt:'2026-10-13T15:00:00Z'},{now}).prospectiveEvidenceEligible,false);
 assert.equal(marketTemporalStatus({...input,projectionAsOf:'2026-10-13T15:58:00Z'},{now}).modelInputEligible,false);
});
test('DST offsets describe instants without dependence on server timezone',()=>{
 const result=marketTemporalStatus({...input,providerObservedAt:'2026-11-01T01:59:00-05:00',collectedAt:'2026-11-01T01:00:00-06:00'},{now:new Date('2026-11-01T07:01:00Z')});
 assert.equal(result.status,'CURRENT');assert.equal(result.sourceObservationLagMs,60000);
});
test('collector-only Polymarket clocks never persist as provider times',async()=>{
 let args;
 const db={prepare(){return{bind(...values){args=values;return{async run(){return{meta:{changes:1}}}}}}}};
 const offer={source:'Polymarket US',sourceType:'exchange',sport:'nhl',eventId:'game',marketFamily:'moneyline',fetchedAt:input.collectedAt,raw:{sourceObservedAt:null}};
 await persistNormalizedMarketObservation(db,offer,{collectedAt:input.collectedAt});
 assert.equal(args[29],null);assert.equal(args[30],input.collectedAt);
 assert.equal(providerObservationTime({...offer,source:'Polymarket US WebSocket',raw:null}),null);
 assert.equal(providerObservationTime({source:'book',fetchedAt:input.providerObservedAt,raw:{sourceObservedAt:null}}),null);
});
