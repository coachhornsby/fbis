import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBoundedPolymarketRest} from '../services/polymarket-rest-collector/collector.mjs';
import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
const now=Date.now(),slot=Math.floor(now/60000),at=new Date(now).toISOString(),start=new Date(now+3600000).toISOString();
function fixture(sport='cbb'){
 const game={id:'game',sport,start,home_name:sport==='cfb'?'Ohio Bobcats':'Ohio State Buckeyes',away_name:sport==='cfb'?'Miami (OH) RedHawks':'Youngstown State Penguins'};
 const event={id:'event',slug:sport+'-game',seriesSlug:sport,title:game.away_name+' vs '+game.home_name,startTime:start,homeTeam:{name:game.home_name},awayTeam:{name:game.away_name},markets:[{slug:'contract',active:true,closed:false,sportsMarketType:sport+'_full_game_moneyline',sportsMarketTypeV2:'MONEYLINE',bestAskQuote:{value:'.6'},bestBidQuote:{value:'.58'},marketSides:[{id:'long',long:true,description:game.home_name,team:{name:game.home_name}}]}]};
 const manifest={version:1,source:'FBIS_COLLECTED_SLATE',sport,capturedAt:at,expiresAt:start,providerTags:[sport],fixtures:[game]};
 const counts={reads:0,writes:0,calls:0},saved=[];
 const env={FBIS_POLYMARKET_PREGAME_REST:'true',CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})})},ARCHIVE:{head(){},async get(){counts.reads++;const text=JSON.stringify(manifest);return {size:Buffer.byteLength(text),body:new Response(text).body};},async put(k,text){counts.writes++;saved.push(JSON.parse(text));}}};
 return {game,event,counts,saved,env,sport};
}
function run(s,change,{listChange}={}){return collectBoundedPolymarketRest(s.env,{sport:s.sport,now,slot,fetchImpl:async url=>{s.counts.calls++;const isDetail=new URL(url).searchParams.has('slug');return Response.json({events:[isDetail?change(structuredClone(s.event)):listChange?listChange(structuredClone(s.event)):s.event]});}});}
const oversized=e=>({...e,markets:Array.from({length:201},(_,i)=>({...e.markets[0],slug:i?'discarded-'+i:e.markets[0].slug,bestAskQuote:{value:'.99'},marketSides:[{...e.markets[0].marketSides[0],id:'discarded-'+i}]}))});
for(const sport of ['cbb','cfb'])test(`${sport} rejects whole optional oversized detail and preserves unchanged list price/binding`,async()=>{
 const s=fixture(sport),result=await run(s,oversized);
 assert.deepEqual(s.counts,{reads:1,writes:1,calls:2});assert.equal(result.selected.length,1);assert.equal(result.selected[0].displayBinding.sourceOutcomeId,'long');
 assert.equal(result.receipt.matchedEvents,1);assert.equal(result.receipt.candidates,1);assert.equal(result.errors.length,1);assert.equal(result.errors[0].code,'PROVIDER_MARKET_CAPACITY');assert.equal(result.errors[0].marketCount,201);assert.equal(result.errors[0].marketLimit,200);
 assert.deepEqual(s.saved[0].detailOmissions,result.receipt.detailOmissions);assert.equal(s.saved[0].referenceSnapshot.quotes.length,1);assert.equal(s.saved[0].referenceSnapshot.quotes[0].bestAsk,.6);assert.equal(s.saved[0].referenceSnapshot.roster[0].displayBinding.sourceOutcomeId,'long');assert.equal(s.saved[0].complete,false);
});
test('legacy optional detail overflow remains fatal without publishing',async()=>{const s=fixture();s.env.FBIS_POLYMARKET_PREGAME_REST='false';await assert.rejects(run(s,oversized),/PROVIDER_MARKET_CAPACITY/);assert.equal(s.counts.writes,0);});
for(const sport of ['cbb','cfb'])test(`${sport} list overflow remains fatal`,async()=>{const s=fixture(sport);await assert.rejects(run(s,e=>e,{listChange:oversized}),/PROVIDER_MARKET_CAPACITY/);assert.deepEqual(s.counts,{reads:1,writes:0,calls:1});});
for(const [label,change,error] of [
 ['missing markets array',e=>({...e,markets:null}),/PROVIDER_MARKET_CAPACITY/],
 ['array-like markets',e=>({...e,markets:{length:201}}),/PROVIDER_MARKET_CAPACITY/],
 ['too many sides',e=>({...e,markets:[{...e.markets[0],marketSides:Array.from({length:5},()=>e.markets[0].marketSides[0])}]}),/PROVIDER_SIDE_CAPACITY/],
 ['wrong slug even with oversize',e=>({...oversized(e),slug:'cbb-wrong'}),/PROVIDER_EVENT_SLUG_MISMATCH/],
 ['conflicting valid identity',e=>({...e,markets:[{...e.markets[0],marketSides:[{...e.markets[0].marketSides[0],id:'conflict'}]}]}),/AMBIGUOUS_PROVIDER_CONTRACT/],
])test(`${label} cannot use optional overflow handling`,async()=>{const s=fixture();await assert.rejects(run(s,change),error);assert.equal(s.counts.writes,0);});
test('oversized detail body still fails byte budget before omission handling',async()=>{const s=fixture();await assert.rejects(run(s,e=>({...oversized(e),extra:'x'.repeat(2097152)})),/UNIT_LIMIT/);assert.equal(s.counts.writes,0);assert.equal(s.counts.calls,2);});
test('exactly200 source markets retain the existing24-market inspection boundary',async()=>{const s=fixture(),result=await run(s,e=>({...e,markets:Array.from({length:200},(_,i)=>({...e.markets[0],slug:i?'valid-'+i:e.markets[0].slug}))}));assert.equal(result.selected.length,24);assert.equal(result.errors.length,0);assert.equal(result.receipt.detailOmissions,undefined);assert.equal(s.saved[0].detailOmissions,undefined);});
test('one rejected detail does not mutate valid later details or exceed four total calls',async()=>{
 const s=fixture(),events=Array.from({length:3},(_,i)=>({...s.event,id:'event-'+i,slug:'cbb-event-'+i,markets:[{...s.event.markets[0],slug:'ml-'+i}]}));let skipped=false;
 const result=await collectBoundedPolymarketRest(s.env,{sport:'cbb',now,slot,fetchImpl:async url=>{s.counts.calls++;const slug=new URL(url).searchParams.get('slug');if(!slug)return Response.json({events});const e=structuredClone(events.find(e=>e.slug===slug));if(!skipped){skipped=true;return Response.json({events:[oversized(e)]});}e.markets.push({slug:'total-'+e.id,active:true,closed:false,sportsMarketType:'cbb_full_game_total',sportsMarketTypeV2:'TOTAL',line:145.5,bestAskQuote:{value:'.53'},bestBidQuote:{value:'.51'},marketSides:[{id:'over-'+e.id,long:true,description:'Over'},{id:'under-'+e.id,long:false,description:'Under'}]});return Response.json({events:[e]});}});
 assert.deepEqual(s.counts,{reads:1,writes:1,calls:4});assert.equal(result.errors.length,1);assert.equal(result.selected.filter(r=>r.market_family==='moneyline').length,3);assert.equal(result.selected.filter(r=>r.market_family==='total').length,2);assert.ok(s.saved[0].referenceSnapshot.quotes.filter(q=>q.marketSlug.startsWith('ml-')).every(q=>q.bestAsk===.6));
});
