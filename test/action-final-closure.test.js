import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLiveActionMisprices} from '../functions/lib/actionMarketIntelligence.js';
import {currentTennisQuotes} from '../functions/api/tennis-v2-snapshot.js';
import {normalizeTennisMarketQuotes,hasActionTennisProvenance,tennisQuoteAcquisitionProvider} from '../functions/lib/tennisMarketV2.js';
import {toDomainEvent,toDomainTodayBoard} from '../functions/lib/fbisDomain.js';
const clock='2026-10-08T12:00:00Z',now=Date.parse(clock);
const at=age=>new Date(now-age*1000).toISOString();
function obs(id,event='e',age=60,patch={}){return {id,sport:'nfl',fbis_event_id:event,collected_at:at(age),source_observed_at:at(age+1),consensus_json:'{"spreadHome":-3}',match_confidence:'exact',...patch};}
function database(observations){return {prepare(sql){return {args:[],bind(...args){this.args=args;return this},async all(){return {results:observations}},async first(){return {sport:'nfl',game_id:this.args[0],proj_margin:7,as_of:at(0)}}}}};}
for(const [name,patch] of [
 ['malformed source',{source_observed_at:'bad'}],['future source',{source_observed_at:at(-1)}],
 ['missing acquisition',{collected_at:null}],['future acquisition',{collected_at:at(-1)}],
 ['source after acquisition',{source_observed_at:at(5)}],
 ['beyond research window',{collected_at:at(21601),source_observed_at:at(21602)}],
])test(`invalid selected observation cannot hide valid event evidence: ${name}`,async()=>{
 const rows=await loadLiveActionMisprices(database([obs('A','e',10,patch),obs('B')]),{now});
 assert.equal(rows.length,1);assert.equal(rows[0].observationId,'B');assert.equal(rows[0].collectedAt,at(60));
});
for(const [name,age,type] of [['current',60,'CURRENT_RESEARCH'],['current boundary',600,'CURRENT_RESEARCH'],['historical',601,'HISTORICAL_RESEARCH'],['research boundary',21600,'HISTORICAL_RESEARCH']])test(`selection retains ${name} semantics`,async()=>{
 const rows=await loadLiveActionMisprices(database([obs('valid','e',age,{source_observed_at:at(age)})]),{now});assert.equal(rows[0].temporalUse,type);assert.equal(rows[0].canAuthorizeWager,false);
});
test('missing optional observation time stays unknown; independent events and equal-time order preserved',async()=>{
 const rows=await loadLiveActionMisprices(database([obs('first','e',60,{source_observed_at:null,observed_at:null}),obs('equal','e',60),obs('other','e2',60)]),{now});
 assert.deepEqual(rows.map(r=>r.observationId),['first','other']);assert.equal(rows[0].marketTimestamp,null);
});
for(const [name,source,provider] of [['source only','ACTION_APIFY',null],['provider only',null,'ACTION_APIFY'],['both','ACTION_APIFY','ACTION_APIFY'],['book source/ACTION provider','HERITAGE','ACTION_APIFY'],['ACTION source/book provider','ACTION_APIFY','HERITAGE']])test(`ACTION provenance cannot hide missing acquisition: ${name}`,()=>{
 assert.deepEqual(currentTennisQuotes([{source,provider,collectedAt:null,observedAt:at(0)}],now),[]);
});
for(const [name,age,observedAge,expected] of [['valid',60,61,true],['stale',601,601,false],['future',-1,-1,false],['observation after acquisition',60,59,false]])test(`contradictory book/actor provenance obeys ${name} temporal rule`,()=>{
 const q={source:'HERITAGE',provider:'ACTION_APIFY',collectedAt:at(age),observedAt:at(observedAge),book:'heritage',p1Price:-110,p2Price:-110};assert.equal(currentTennisQuotes([q],now).length,expected?1:0);
});
test('independent and unspecified quote provenance retain existing semantics without gaining authority',()=>{
 const owned={source:'HERITAGE',provider:'HERITAGE',book:'heritage'},unknown={book:'pinnacle'};assert.deepEqual(currentTennisQuotes([owned,unknown],now),[owned,unknown]);
 assert.equal(tennisQuoteAcquisitionProvider({source:'HERITAGE',provider:'THEODDS_API'}),'HERITAGE');
 assert.equal(tennisQuoteAcquisitionProvider({provider:'THEODDS_API'}),'MARKET_FEED');
});
test('normalization preserves distinct provider and sportsbook-source identity',()=>{
 const q={source:'HERITAGE',provider:'ACTION_APIFY',collectedAt:at(60),observedAt:at(61),book:'heritage',p1Price:-110,p2Price:-110};const [n]=normalizeTennisMarketQuotes([q]);assert.equal(n.provider,'ACTION_APIFY');assert.equal(n.source,'HERITAGE');assert.equal(n.collectedAt,q.collectedAt);assert.equal(tennisQuoteAcquisitionProvider(n),'ACTION_APIFY');assert.equal(hasActionTennisProvenance(n),true);
 assert.equal(tennisQuoteAcquisitionProvider({...n,source:'ACTION_APIFY',provider:'HERITAGE'}),'ACTION_APIFY');
 assert.equal(n.p1,.5);assert.equal(n.p2,.5);
});
function game(action){return {id:'e',sport:'nfl',lean:{pick:'HOME'},market:{execution:{available:true,book:'Heritage',spread:-2.5,spreadPrice:-110}},actionIntel:action};}
for(const [name,action] of [
 ['601-second capture',{collectedAt:at(601)}],['one-second future',{collectedAt:at(-1)}],['missing acquisition',{observedAt:at(0)}],['malformed source',{collectedAt:at(60),sourceObservedAt:'bad'}],['source after acquisition',{collectedAt:at(60),sourceObservedAt:at(59)}],
])test(`current domain helper rejects ${name} before movers/display`,()=>{
 const actionIntel={...action,movement:{openingLine:-1,currentLine:-3,movementMagnitude:2},publicSplits:{ticketPct:70,moneyPct:80}};
 const raw=game(actionIntel);const event=toDomainEvent(raw,{generatedAt:clock});assert.equal(event.actionIntel,null);assert.equal(event.movement.openingLine,null);assert.equal(event.movement.movementMagnitude,null);assert.equal(event.publicSplits.ticketPct,null);assert.equal(event.movement.currentLine,-2.5);assert.equal(event.decision.authorized,false);
 const board=toDomainTodayBoard({games:[raw]},{generatedAt:clock});assert.equal(board.marketMovers.length,0);assert.equal(board.watchlist.length,1);
});
test('fresh/current boundary domain evidence stays usable and owned markets remain intact',()=>{
 for(const age of [60,600]){const intel={collectedAt:at(age),sourceObservedAt:at(age),movement:{openingLine:-1,currentLine:-3,movementMagnitude:2}};const event=toDomainEvent(game(intel),{generatedAt:clock});assert.equal(event.actionIntel.collectedAt,at(age));assert.equal(event.movement.movementMagnitude,2);assert.equal(event.movement.currentLine,-2.5)}
});
test('standalone stale ACTION sentiment cannot bypass domain sanitation',()=>{
 const event=toDomainEvent({...game(null),sentiment:{source:'ACTION_APIFY',collectedAt:at(601),openingLine:-1,magnitude:2,ticketPct:70}},{generatedAt:clock});assert.equal(event.movement.openingLine,null);assert.equal(event.publicSplits.ticketPct,null);
});

test('domain clock validation uses shared semantics and does not replace invalid clocks',t=>{
 t.mock.timers.enable({apis:['Date'],now});
 const raw=game({collectedAt:at(60)});
 assert.equal(toDomainEvent(raw,{generatedAt:'bad'}).actionIntel,null);
 assert.equal(toDomainEvent(raw,{generatedAt:''}).actionIntel,null);
 const equivalent=toDomainEvent(raw,{generatedAt:'2026-10-08T07:00:00-05:00'});
 assert.equal(equivalent.actionIntel.collectedAt,at(60));
});
