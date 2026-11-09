import test from 'node:test';
import assert from 'node:assert/strict';
import {anchoredMarketPlan,anchoredMarketEvent,validateAnchoredMarketUrl} from '../services/polymarket-rest-collector/anchoredMarkets.mjs';
import {collectBoundedPolymarketRest} from '../services/polymarket-rest-collector/collector.mjs';
import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
import {createExecutionLease,executionFetch} from '../services/account-budget/execution.mjs';
const now=Date.now(),slot=Math.floor(now/60000),at=new Date(now).toISOString(),start=new Date(now+3600000).toISOString();
const game={id:'espn-1',sport:'cfb',start,home_name:'Ohio Bobcats',away_name:'Miami (OH) RedHawks'};
const market=(id='101',family='moneyline')=>({id,slug:'contract-'+id,active:true,closed:false,sportsMarketType:'cfb_full_game_'+family,sportsMarketTypeV2:'SPORTS_MARKET_TYPE_'+family.toUpperCase(),...(family==='total'?{line:47.5}:{}),bestAskQuote:{value:'.6'},bestBidQuote:{value:'.58'},marketSides:family==='total'?[{id:'over-'+id,long:true,description:'Over',marketId:Number(id)},{id:'under-'+id,long:false,description:'Under',marketId:Number(id)}]:[{id:'long-'+id,long:true,description:game.home_name,team:{name:game.home_name},marketId:Number(id)}]});
const source=()=>({id:'900',gameId:12345,slug:'cfb-game',seriesSlug:'cfb',title:game.away_name+' vs '+game.home_name,startTime:start,homeTeam:{name:game.home_name},awayTeam:{name:game.away_name},markets:[market()]});
const pair=m=>({...m,marketSides:[...m.marketSides,{id:'short-'+m.id,long:false,description:game.away_name,team:{name:game.away_name},marketId:Number(m.id)}]});
function setup(event=source(),{sport='cfb',rest=true,limits={}}={}){
 const counts={reads:0,writes:0,reservations:0},saved=[],calls=[];
 const manifest={version:1,source:'FBIS_COLLECTED_SLATE',sport,capturedAt:at,expiresAt:start,providerTags:[sport],fixtures:[{...game,sport}]};
 const env={FBIS_POLYMARKET_PREGAME_REST:String(rest),CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>{counts.reservations++;return {allowed:true,maxUnits:{...CERTIFIED_EXECUTION_JOBS[job].units,...limits},expiresAtMs:Date.now()+120000};}})},ARCHIVE:{head(){},async get(){counts.reads++;const text=JSON.stringify(manifest);return {size:Buffer.byteLength(text),body:new Response(text).body};},async put(k,text){counts.writes++;saved.push(JSON.parse(text));}}};
 return {event,env,counts,saved,calls,sport};
}
const run=(s,result)=>collectBoundedPolymarketRest(s.env,{sport:s.sport,now,slot,fetchImpl:async(url,init)=>{const u=new URL(url);s.calls.push(u);assert.equal(init.redirect,'manual');if(u.pathname==='/v1/markets')return typeof result==='function'?result(u):Response.json(result??{markets:[pair(s.event.markets[0])]});return Response.json({events:[s.event]});}});

test('official US query keeps exact IDs/family enums without redundant gameId intersection',()=>{
 const event=source();event.marketGroups=[{marketIds:['102','103']}];const p=anchoredMarketPlan(event);
 assert.equal(p.url.origin,'https://gateway.polymarket.us');assert.equal(p.url.pathname,'/v1/markets');
 assert.equal(p.url.searchParams.has('gameId'),false);assert.equal(p.event.gameId,12345);
 assert.deepEqual(p.url.searchParams.getAll('id'),['101','102','103']);assert.equal(p.url.searchParams.has('slug'),false);
 assert.deepEqual(p.url.searchParams.getAll('sportsMarketTypes'),['SPORTS_MARKET_TYPE_MONEYLINE','SPORTS_MARKET_TYPE_SPREAD','SPORTS_MARKET_TYPE_TOTAL']);
 assert.equal(p.url.searchParams.get('limit'),'24');assert.equal(p.url.searchParams.get('offset'),'0');
});
test('documented slug filter remains exact when source market ID is not int32',()=>{const e=source();e.markets[0].id='non-numeric';const p=anchoredMarketPlan(e);assert.equal(p.mode,'slug');assert.deepEqual(p.url.searchParams.getAll('slug'),['contract-101']);assert.equal(p.url.searchParams.has('id'),false);assert.equal(p.url.searchParams.has('gameId'),false);assert.equal(p.url.searchParams.getAll('sportsMarketTypes').length,3);});
test('numeric and string group references normalize to one exact source anchor',async()=>{const e=source();e.markets=[];e.marketGroups=[{marketIds:[102,'102']}];const p=anchoredMarketPlan(e);assert.deepEqual(p.requested,['102']);const s=setup(e),m=market('102','total');m.id=102;const r=await run(s,{markets:[m]});assert.equal(r.selected.length,1);assert.equal(r.selected[0].market_family,'total');assert.equal(r.selected[0].provider_event_id,e.id);});
test('group anchor cannot relabel the slug of another embedded source market',()=>{const e=source();e.marketGroups=[{marketIds:['102']}];const p=anchoredMarketPlan(e);assert.throws(()=>anchoredMarketEvent({markets:[{...market('102'),slug:e.markets[0].slug}]},p),/ANCHOR_CONFLICT/);});
test('all up-to200 source anchors receive bounded rotating batches without scanning unbounded inventory',()=>{const e=source();e.marketGroups=[{marketIds:Array.from({length:199},(_,i)=>String(i+102))}];const seen=new Set();for(let rotation=0;rotation<25;rotation++){const p=anchoredMarketPlan(e,{rotation});assert.equal(p.requested.length,24);for(const id of p.requested)seen.add(id);}assert.equal(seen.size,200);e.marketGroups[0].marketIds.push('301');assert.equal(anchoredMarketPlan(e),null);});
test('missing or invalid source gameId never substitutes event ID, event.game.id or ESPN ID',()=>{for(const id of [undefined,null,'12345',0,-1,1.5,2147483648]){const e=source();e.gameId=id;e.game={id:12345};assert.equal(anchoredMarketPlan(e),null);}});
test('no ID or slug anchors and malformed/overcapacity groups retain existing detail eligibility',()=>{for(const mutate of [e=>e.markets=[{marketSides:[]}],e=>e.marketGroups={},e=>e.marketGroups=[{marketIds:null}],e=>e.marketGroups=Array.from({length:201},()=>({marketIds:[]}))]){const e=source();mutate(e);assert.equal(anchoredMarketPlan(e),null);}});
test('source parent disagreement and duplicate source identities reject rather than falling back',()=>{for(const mutate of [e=>e.eventState={gameId:999},e=>e.eventState={eventId:999},e=>e.markets.push({...e.markets[0],slug:'other'})]){const e=source();mutate(e);assert.throws(()=>anchoredMarketPlan(e),/ANCHOR_CONFLICT/);}});
test('exact query validation rejects origin/path/filter/limit changes',()=>{const p=anchoredMarketPlan(source());for(const change of [u=>u.hostname='gamma-api.polymarket.com',u=>u.pathname='/v1/market/id/101',u=>u.searchParams.set('gameId','999'),u=>u.searchParams.set('limit','200'),u=>u.searchParams.set('offset','24'),u=>u.searchParams.set('includeHidden','true'),u=>u.hash='#extra']){const u=new URL(p.url);change(u);assert.throws(()=>validateAnchoredMarketUrl(u,p),/QUERY_NOT_APPROVED/);}});

test('CFB reserved slot enriches exact anchored moneyline with genuine opposite ID and unchanged sourceclock',async()=>{
 const s=setup(),r=await run(s);
 assert.equal(s.calls.length,2);assert.equal(s.calls[0].pathname,'/v1/events');assert.equal(s.calls[1].pathname,'/v1/markets');assert.deepEqual(s.counts,{reads:1,writes:1,reservations:1});
 assert.equal(r.selected.length,1);assert.equal(r.selected[0].provider_event_id,'900');assert.equal(r.selected[0].canonical_event_id,'espn-1');assert.equal(r.selected[0].displayBinding.oppositeSourceOutcomeId,'short-101');
 assert.equal(r.selected[0].collected_at,at);assert.equal(s.saved[0].capturedAt,at);assert.equal(s.saved[0].complete,false);assert.equal(r.receipt.marketDetailPages[0].complete,false);
});
test('genuine numeric market/side IDs normalize without fabricating outcome IDs',async()=>{
 for(const stringify of [false,true]){const e=source();e.id=900;e.markets[0].id=101;e.markets[0].marketSides[0].id=501;const s=setup(e),m=pair(e.markets[0]);m.marketSides[1].id=502;if(stringify){m.id='101';for(const side of m.marketSides)side.id=String(side.id);}const r=await run(s,{markets:[m]});assert.equal(r.selected[0].provider_event_id,'900');assert.equal(r.selected[0].displayBinding.sourceOutcomeId,'501');assert.equal(r.selected[0].displayBinding.oppositeSourceOutcomeId,'502');}
});
test('boolean, zero, negative and unsafe numeric outcome IDs are rejected',async()=>{for(const id of [true,false,0,-1,Number.MAX_SAFE_INTEGER+1]){const s=setup(),m=pair(s.event.markets[0]);m.marketSides[1].id=id;await assert.rejects(run(s,{markets:[m]}),/ANCHOR_CONFLICT/);assert.equal(s.counts.writes,0);}});
test('new derivative requires explicit source group membership, with existing downstream total binding',async()=>{const e=source();e.marketGroups=[{marketIds:['102']}];const s=setup(e),r=await run(s,{markets:[pair(e.markets[0]),market('102','total')]});assert.equal(r.selected.length,2);const row=r.selected.find(x=>x.market_family==='total');assert.equal(row.displayBinding.oppositeSourceOutcomeId,'under-102');assert.equal(row.displayBinding.line,47.5);assert.equal(row.provider_event_id,e.id);});
test('empty filtered result preserves list without retry or inferred cancellation',async()=>{const s=setup(),r=await run(s,{markets:[]});assert.equal(r.selected.length,1);assert.equal(r.selected[0].displayBinding.oppositeSourceOutcomeId,undefined);assert.equal(s.calls.length,2);assert.equal(r.receipt.marketDetailPages[0].returnedMarketCount,0);assert.equal(s.saved[0].complete,false);});
test('missing anchors use existing event detail, while CBB and legacy do not acquire the new route',async()=>{
 const missing=source();delete missing.gameId;const s=setup(missing);await run(s);assert.ok(s.calls.every(u=>u.pathname==='/v1/events'));assert.equal(s.calls.at(-1).searchParams.get('slug'),'cfb-game');
 const cbb={...source(),slug:'cbb-game',seriesSlug:'cbb'},c=setup(cbb,{sport:'cbb'});await run(c);assert.ok(c.calls.every(u=>u.pathname==='/v1/events'));
 const l=setup(source(),{rest:false});await run(l);assert.ok(l.calls.every(u=>u.pathname==='/v1/events'));assert.equal(l.calls.length,1);
});
for(const [label,change] of [
 ['unknown market despite game filter',m=>({...m,id:'999',slug:'other'})],
 ['known ID with wrong slug',m=>({...m,slug:'other'})],
 ['conflicting game',m=>({...m,gameId:'99'})],
 ['conflicting event',m=>({...m,eventId:'99'})],
 ['conflicting event slug',m=>({...m,eventSlug:'cfb-other'})],
 ['conflicting kickoff',m=>({...m,gameStartTime:new Date(now+86400000).toISOString()})],
 ['conflicting family',m=>({...m,sportsMarketTypeV2:'TOTAL',sportsMarketType:'cfb_full_game_total',line:47.5})],
 ['conflicting period',m=>({...m,sportsMarketType:'cfb_first_half_moneyline'})],
 ['changed source outcome',m=>({...m,marketSides:[{...m.marketSides[0],id:'changed'}]})],
 ['wrong side parent',m=>({...m,marketSides:[{...m.marketSides[0],marketId:999}]})],
 ['changed source team',m=>({...m,marketSides:[{...m.marketSides[0],team:{name:'Another Team'}}]})],
])test(label+' fails closed before capture write',async()=>{const s=setup();await assert.rejects(run(s,{markets:[change(pair(s.event.markets[0]))]}),/ANCHOR_CONFLICT/);assert.equal(s.counts.writes,0);});
for(const [label,value,error] of [
 ['malformed response',{markets:null},/MARKET_PAGE_INVALID/],
 ['25market amplification',{markets:Array.from({length:25},()=>market())},/MARKET_PAGE_INVALID/],
 ['duplicate identity',{markets:[market(),market()]},/ANCHOR_CONFLICT/],
 ['duplicate side',{markets:[{...market(),marketSides:[market().marketSides[0],market().marketSides[0]]}]},/ANCHOR_CONFLICT/],
 ['five sides',{markets:[{...market(),marketSides:Array.from({length:5},(_,i)=>({...market().marketSides[0],id:'s'+i}))}]},/SIDE_CAPACITY/],
])test(label+' rejects the whole optional response',async()=>{const s=setup();await assert.rejects(run(s,value),error);assert.equal(s.counts.writes,0);});
test('valid first derivative does not permit partially accepting a later wrong market',()=>{const e=source();e.marketGroups=[{marketIds:['102']}];const before=structuredClone(e),p=anchoredMarketPlan(e);assert.throws(()=>anchoredMarketEvent({markets:[market('102','total'),market('999')]},p),/ANCHOR_CONFLICT/);assert.deepEqual(e,before);});
test('two-MiB and shared request allowances still fail before writes without a fallback call',async()=>{for(const [limits,result,error] of [[{},()=>Response.json({markets:[market()],extra:'x'.repeat(2097152)}),/UNIT_LIMIT_responseBytes/],[{requests:1},null,/UNIT_LIMIT_requests/]]){const s=setup(source(),{limits});await assert.rejects(run(s,result),error);assert.equal(s.counts.writes,0);assert.ok(s.calls.length<=2);}});
test('response-byte total is aggregated across event list and market detail wrappers',async()=>{const e=source();e.listPadding='x'.repeat(1100000);const s=setup(e);await assert.rejects(run(s,()=>Response.json({markets:[pair(e.markets[0])],detailPadding:'x'.repeat(1100000)})),/UNIT_LIMIT_responseBytes/);assert.equal(s.calls.length,2);assert.equal(s.counts.writes,0);});
test('denied reservation prevents both endpoints and all archive IO',async()=>{const s=setup();s.env.FBIS_ACCOUNT_BUDGET={getByName:()=>({reserve:async()=>({allowed:false,reason:'DENIED'})})};await assert.rejects(run(s));assert.equal(s.calls.length,0);assert.equal(s.counts.reads,0);assert.equal(s.counts.writes,0);});
test('non-success market read consumes its slot with no retry, redirects or event-detail fallback',async()=>{for(const status of [302,403,429,500]){const s=setup(),r=await run(s,()=>new Response(null,{status}));assert.equal(s.calls.length,2);assert.equal(r.selected.length,1);assert.equal(r.errors[0].status,status);}});
test('two endpoint wrappers share one lease and reject all other paths/methods before a call',async()=>{const lease=createExecutionLease({allowed:true,expiresAtMs:Date.now()+120000,maxUnits:{requests:4,responseBytes:1000}});let calls=0;const mock=async()=>{calls++;return Response.json({});};const events=executionFetch(lease,mock,{origin:'https://gateway.polymarket.us',path:'/v1/events'}),markets=executionFetch(lease,mock,{origin:'https://gateway.polymarket.us',path:'/v1/markets'});for(const read of [events,events,events,markets])await read('https://gateway.polymarket.us/v1/'+(read===markets?'markets':'events'));await assert.rejects(markets('https://gateway.polymarket.us/v1/markets'),/UNIT_LIMIT_requests/);assert.equal(calls,4);for(const [url,init] of [['https://gateway.polymarket.us/v1/events',{}],['https://gamma-api.polymarket.com/v1/markets',{}],['https://gateway.polymarket.us/v1/markets',{method:'POST'}]]){const fresh=createExecutionLease({allowed:true,expiresAtMs:Date.now()+120000,maxUnits:{requests:4,responseBytes:1000}});await assert.rejects(executionFetch(fresh,mock,{origin:'https://gateway.polymarket.us',path:'/v1/markets'})(url,init),/DESTINATION_NOT_APPROVED/);}assert.equal(calls,4);});
