import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSoccerMarketFixtures} from '../functions/lib/soccerMarketFixtures.js';
import {soccerShadowMarketSnapshot} from '../functions/lib/soccerShadowMarkets.js';
import {parsePolymarketUsLite,polymarketUsSubscribe} from '../functions/lib/polymarketUsSignedWs.js';
import {polymarketUsPeriod} from '../functions/lib/polymarketUs.js';
import {liveBboOffer} from '../services/polymarket-us-stream/core.mjs';
const now=new Date('2026-10-15T06:00:00Z');
test('future soccer fixtures come from independent ESPN identities with bounded calls and a durable cache',async()=>{
 let calls=0,stored;const env={ARCHIVE:{get:async()=>stored?{json:async()=>stored}:null,put:async(k,v)=>{stored=JSON.parse(v)}}};
 const d=await loadSoccerMarketFixtures(env,{now,fetchImpl:async url=>{calls++;assert.match(url,/dates=\d{8}&/);return{ok:true,json:async()=>({events:[{id:'401884770',date:'2026-10-16T18:30Z',competitions:[{competitors:[{homeAway:'home',team:{displayName:'Eintracht Frankfurt'}},{homeAway:'away',team:{displayName:'FC Cologne'}}]}]}]})}}});
 assert.equal(calls,44);assert.equal(d.fixtures.length,1);assert.equal(d.fixtures[0].fixtureSource,'ESPN');
 await loadSoccerMarketFixtures(env,{now,fetchImpl:async()=>{throw Error('cache missed')}});assert.equal(calls,44);
});
const rows=(clock='2026-10-15T05:59:00Z')=>['home','draw','away'].map((side,i)=>({id:`q${i}`,canonical_event_id:'g',source:'PinnOdds',market_family:'moneyline',period:'full_game',side,line:null,decimal_odds:[2.2,3.4,3.1][i],source_market_id:'match:ml',source_observed_at:clock,collected_at:'2026-10-15T05:59:30Z',raw_payload_json:JSON.stringify({snapshotId:'s',sourceObservedAt:clock})}));
const context={eventId:'g',kickoff:'2026-10-16T18:30:00Z',snapshotAt:now.toISOString()};
test('complete same-capture bookmaker 1X2 yields no-vig probabilities and original observation links',()=>{
 const d=soccerShadowMarketSnapshot(rows(),context);assert.equal(d.references.length,3);
 assert.ok(Math.abs(Object.values(d.byFamily['1X2']).reduce((n,x)=>n+x.marketNoVigProbability,0)-1)<1e-12);
 assert.equal(d.byFamily['1X2'].HOME.entryPrice,120.00000000000001);assert.equal(d.byFamily['1X2'].DRAW.observationId,'q1');
});
test('unknown clocks, missing draw, mixed captures and post-capture identity links cannot qualify prices',()=>{
 assert.equal(soccerShadowMarketSnapshot(rows(null),context).references.length,3);
 assert.equal(soccerShadowMarketSnapshot(rows(null),context).byFamily['1X2'],undefined);
 assert.equal(soccerShadowMarketSnapshot(rows().slice(0,2),context).byFamily['1X2'],undefined);
 const mixed=rows();mixed[1].raw_payload_json=JSON.stringify({snapshotId:'other'});assert.equal(soccerShadowMarketSnapshot(mixed,context).byFamily['1X2'],undefined);
 const linked=rows().map(r=>({...r,raw_payload_json:JSON.stringify({snapshotId:'s',postCaptureIdentityLink:true})}));assert.equal(soccerShadowMarketSnapshot(linked,context).byFamily['1X2'],undefined);
});
test('full-book socket timestamp survives to ledger and first-half identity stays first-half',()=>{
 const t=parsePolymarketUsLite({marketData:{marketSlug:'soccer-a-b',bids:[{px:{value:'.4'}}],offers:[{px:{value:'.5'}}],transactTime:'2026-10-15T05:59:00Z',state:'MARKET_STATE_OPEN'}});
 assert.equal(t.sourceObservedAt,'2026-10-15T05:59:00.000Z');assert.equal(t.bestAsk,.5);
 assert.equal(polymarketUsSubscribe(['soccer-a-b'],'full',{fullBook:true}).subscribe.subscription_type,'SUBSCRIPTION_TYPE_MARKET_DATA');
 const o=liveBboOffer({...t,at:now.toISOString()},{period:'first_half'});assert.equal(o.period,'first_half');assert.equal(o.raw.sourceObservedAt,t.sourceObservedAt);assert.equal(o.raw.contractBindingVerified,true);
 assert.equal(parsePolymarketUsLite({marketDataLite:{marketSlug:'a-b',bestAsk:null}}).bestAsk,null);
 assert.equal(polymarketUsPeriod({sportsMarketType:'soccer_team_first_half_spread'}),'first_half');
 assert.equal(polymarketUsPeriod({sportsMarketType:'soccer_team_full_time_winner'}),'full_game');
});

test('PinnOdds full-match BTTS and first-half specials retain different families and periods',async()=>{
 const {normalizePinnoddsMarkets}=await import('../functions/lib/pinnoddsMarkets.js');
 const parent={event_id:1,starts:'2026-10-16T18:30:00Z',home:'Frankfurt',away:'Cologne',league_name:'Germany Bundesliga'};
 const special=(id,name)=>({event_id:id,parent_id:1,special:name,special_category:'team',league_name:parent.league_name,special_markets:{num_0:[{type:'yesno',prices:[{name:'yes',price:1.8},{name:'no',price:2.1}]}]}});
 const result=normalizePinnoddsMarkets({events:[parent,special(2,'Both Teams To Score?'),special(3,'Both Teams To Score? 1st Half')]},{sportId:1,capturedAt:now.toISOString()});
 assert.equal(result.rows.filter(r=>r.marketFamily==='btts'&&r.period==='full_game').length,2);
 assert.equal(result.rows.filter(r=>r.marketFamily==='special'&&r.period==='first_half').length,2);
});

test('soccer book home and away prices cannot attach with reversed team orientation',async()=>{
 const {matchPolymarketUsEvent}=await import('../functions/lib/polymarketUs.js');
 const fixtures=[{id:'g',start:'2026-10-16T18:30Z',home_name:'Eintracht Frankfurt',away_name:'FC Cologne'}];
 assert.equal(matchPolymarketUsEvent({startTime:fixtures[0].start,homeTeam:{name:'Cologne'},awayTeam:{name:'Frankfurt'}},fixtures,'soccer').id,null);
 assert.equal(matchPolymarketUsEvent({startTime:fixtures[0].start,homeTeam:{name:'Frankfurt'},awayTeam:{name:'Cologne'}},fixtures,'soccer').id,'g');
});

test('soccer drawable exchange contracts identify match-winner, draw and complement explicitly',async()=>{
 const {polymarketUsMarketOffers}=await import('../functions/lib/polymarketUs.js');
 const offers=polymarketUsMarketOffers({id:'event',markets:[{id:'draw',sportsMarketType:'soccer_team_full_time_winner',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_DRAWABLE_OUTCOME',title:'Tie (Reg. Time)',marketSides:[{id:'yes',description:'yes',long:true,price:'.24'},{id:'no',description:'no',long:false,price:'.78'}]}]},'soccer');
 assert.equal(offers[0].marketFamily,'moneyline');assert.equal(offers[0].period,'full_game');assert.equal(offers[0].side,'Draw');assert.equal(offers[1].side,'Not Draw');
});

test('legacy drawable references reach shadow records with actual draw label and unchanged clock',()=>{
 const raw={providerMarket:{sportsMarketType:'soccer_team_full_time_winner',title:'Tie (Reg. Time)'},providerSide:{description:'yes',long:true},contractLong:true,sourceObservedAt:null};
 const d=soccerShadowMarketSnapshot([{id:'draw',source:'Polymarket US',canonical_event_id:'g',market_family:'unclassified',period:'unspecified',side:'yes',contract_price:.24,collected_at:'2026-10-15T05:59:30Z',raw_payload_json:JSON.stringify(raw)}],context);
 assert.equal(d.references[0].side,'Draw');assert.equal(d.references[0].family,'moneyline');assert.equal(d.references[0].providerObservedAt,null);assert.equal(d.byFamily['1X2'],undefined);
});

test('archive ingestion retries transient D1 loss with the same snapshot and cannot call paid capture',async()=>{
 const {ingestPinnArchiveStep}=await import('../scripts/lib/soccerPinnArchiveRetry.mjs');
 const requests=[];const body={operation:'consume',snapshotId:'existing-paid-capture',batchIndex:25};
 const r=await ingestPinnArchiveStep({base:'https://fbis.test',secret:'test',body,wait:async()=>{},fetchImpl:async(url,args)=>{requests.push({url,body:JSON.parse(args.body)});return requests.length===1?{ok:false,status:502,json:async()=>({ok:false,error:'D1_ERROR: Network connection lost.'})}:{ok:true,status:200,json:async()=>({ok:true,inserted:100})}}});
 assert.equal(r.inserted,100);assert.equal(requests.length,2);assert.ok(requests.every(r=>r.url.endsWith('/api/pinnodds-ingest')));assert.deepEqual(requests[0].body,requests[1].body);
 await assert.rejects(ingestPinnArchiveStep({body:{operation:'capture'}}),/ARCHIVE_INGEST_OPERATION_ONLY/);
});

test('market batches use bounded D1 transactions with unchanged IDs, clocks and duplicate handling',async()=>{
 const {persistNormalizedMarketBatch}=await import('../functions/lib/marketObservationLedger.js');const ids=new Set(),sizes=[];let individual=0;
 const db={prepare(){return{bind(...args){return{args,run:async()=>{individual++;throw Error('must batch')}}}}},async batch(stmts){sizes.push(stmts.length);return stmts.map(s=>{const changed=!ids.has(s.args[0]);ids.add(s.args[0]);assert.equal(s.args[30],now.toISOString());return{meta:{changes:changed?1:0}}})}};
 const offers=Array.from({length:105},(_,i)=>({source:'PinnOdds',sourceType:'sportsbook',sport:'soccer',eventId:'g',marketFamily:'moneyline',side:'home',decimalOdds:2,sourceMarketId:`m${i}`,sourceOutcomeId:'home',sourceObservedAt:null}));
 const a=await persistNormalizedMarketBatch(db,offers,{collectedAt:now.toISOString()}),b=await persistNormalizedMarketBatch(db,offers,{collectedAt:now.toISOString()});
 assert.equal(a.inserted,105);assert.equal(b.inserted,0);assert.deepEqual(a.ids,b.ids);assert.deepEqual(sizes,[100,5,100,5]);assert.equal(individual,0);
});

test('verified soccer local names match only inside their competition and unique opponent/kickoff',async()=>{
 const {matchPolymarketUsEvent}=await import('../functions/lib/polymarketUs.js');
 const game={id:'g',league:'ger.1',start:'2026-10-16T18:30Z',home_name:'Eintracht Frankfurt',away_name:'FC Cologne'};
 const event={startTime:game.start,title:'Eintracht Frankfurt vs. 1. FC Koln'};
 assert.equal(matchPolymarketUsEvent(event,[game],'soccer').id,'g');assert.equal(matchPolymarketUsEvent(event,[{...game,league:'eng.1'}],'soccer').id,null);
 const spanish={id:'s',league:'esp.1',start:'2026-10-16T19:00Z',home_name:'Deportivo',away_name:'Levante'};
 assert.equal(matchPolymarketUsEvent({startTime:spanish.start,title:'RC Deportivo A Coruña vs. Levante'},[spanish],'soccer').id,'s');
});
test('PinnOdds French and renamed NWSL teams retain independent event identity',async()=>{
 const {matchPolymarketUsEvent}=await import('../functions/lib/polymarketUs.js');
 const cases=[['eng.1','Brighton & Hove Albion','Crystal Palace','Brighton','Crystal Palace'],['fra.1','Paris FC','Stade Rennais','Paris FC','Rennes'],['fra.1','Le Havre AC','AJ Auxerre','Le Havre','Auxerre'],['usa.nwsl','Chicago Stars FC','Seattle Reign FC','Chicago Red Stars','Seattle Reign']];
 for(const [league,home,away,sourceHome,sourceAway] of cases){
  const game={id:'exact',league,start:'2026-10-18T23:00:00Z',home_name:home,away_name:away};
  const event={startTime:game.start,homeTeam:{name:sourceHome},awayTeam:{name:sourceAway}};
  assert.equal(matchPolymarketUsEvent(event,[game],'soccer').id,'exact');
  assert.equal(matchPolymarketUsEvent(event,[{...game,league:'ger.1'}],'soccer').id,null);
  assert.equal(matchPolymarketUsEvent({...event,startTime:'2026-10-19T23:00:00Z'},[game],'soccer').id,null);
 }
});
