import test from 'node:test';
import assert from 'node:assert/strict';
import {capturePolymarketPage,consumePolymarketPage,reconcilePolymarketPage} from '../functions/lib/polymarketCapture.js';
import {polymarketUsMarketOffers,parsePolymarketUsPrice,classifyPolymarketUsLeague} from '../functions/lib/polymarketUs.js';
function withHistoryShard(env){env.MARKET_HISTORY_2026Q4_DB={prepare(sql){
 if(sql.includes('sqlite_master'))return{bind(){return{async first(){return{ok:1}}}}};
 if(sql==='SELECT 1 AS healthy')return{async all(){return{meta:{size_after:1_000_000_000}}}};
 return env.DB.prepare(sql);
}};return env;}
const at=new Date('2026-10-13T17:00:00Z');
const event={id:'event1',startTime:'2026-10-14T00:00:00Z',homeTeam:{name:'Home'},awayTeam:{name:'Away'},markets:Array.from({length:40},(_,i)=>({slug:'market-'+i,id:'market'+i,sportsMarketType:'baseball_team_full_game_spread',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_SPREAD',line:i/2,marketSides:[{id:'yes-'+i,long:true,description:'Home',quote:{value:'0.6'}},{id:'no-'+i,long:false,description:'Away',quote:{value:'0.4'}}]}))};
function env(){const stored=new Map(),rows=new Map();return{stored,rows,ARCHIVE:{async get(k){return stored.has(k)?{async json(){return JSON.parse(stored.get(k))}}:null},async put(k,v){stored.set(k,v)}},DB:{prepare(sql){return{bind(...args){return{async all(){return{results:[{id:'canonical',sport:'mlb',start:event.startTime,home_name:'Home',away_name:'Away'}]}},async first(){return{n:[...rows.values()].filter(r=>JSON.parse(r[41]).receiptId===args[0]).length}},async run(){const inserted=!rows.has(args[0]);rows.set(args[0],args);return{meta:{changes:inserted?1:0}}}}}}}}};}
test('all forty markets and both sides survive with explicit polarity and no fabricated zero prices',()=>{
 const rows=polymarketUsMarketOffers(event,'mlb');assert.equal(rows.length,80);assert.equal(rows[1].raw.contractLong,false);assert.equal(rows[0].period,'full_game');
 assert.equal(parsePolymarketUsPrice(null),null);assert.equal(parsePolymarketUsPrice(undefined),null);
 for(const [slug,sport] of [['itfm','tennis'],['wcbb','cbb'],['lal','soccer'],['bun','soccer']])assert.equal(classifyPolymarketUsLeague({slug}),sport);
});
test('page archive precedes writes, replay retains capture time and all offers reconcile',async()=>{
 const e=withHistoryShard(env());let calls=0;const fetchImpl=async url=>{calls++;assert.equal(url.searchParams.get('offset'),'20');return new Response(JSON.stringify({events:[event]}));};
 const receipt=await capturePolymarketPage(e,{receiptId:'run-123-mlb-20',kind:'events',slug:'mlb',sport:'mlb',offset:20,fetchImpl,now:at});
 assert.equal(receipt.expectedRows,80);assert.equal(receipt.nextOffset,null);assert.equal(e.rows.size,0);assert.equal(e.stored.size,3);const roster=JSON.parse(e.stored.get('market-sources/polymarket-us/stream-roster/mlb-20.json'));assert.equal(roster.roster.length,40);assert.equal(roster.capturedAt,at.toISOString());
 const replay=await capturePolymarketPage(e,{receiptId:receipt.receiptId,kind:'events',slug:'mlb',sport:'mlb',offset:20,fetchImpl,now:new Date('2026-10-13T18:00:00Z')});assert.equal(calls,1);assert.equal(replay.capturedAt,receipt.capturedAt);
 const consumed=await consumePolymarketPage(e,{receiptId:receipt.receiptId,batchIndex:0});assert.equal(consumed.inserted,80);
 assert.equal((await consumePolymarketPage(e,{receiptId:receipt.receiptId,batchIndex:0})).inserted,0);
 assert.equal((await reconcilePolymarketPage(e,{receiptId:receipt.receiptId})).reconciled,true);
 for(const row of e.rows.values()){assert.equal(row[29],null);assert.equal(row[30],at.toISOString());assert.equal(row[31],'RESEARCH');}
});
test('full catalogue pages require continuation and scope substitution is rejected',async()=>{
 const receipt=await capturePolymarketPage(env(),{receiptId:'catalogue-0',kind:'catalogue',fetchImpl:async()=>new Response(JSON.stringify({leagues:Array.from({length:20},(_,i)=>({slug:'league-'+i}))})),now:at});assert.equal(receipt.nextOffset,20);
 await assert.rejects(capturePolymarketPage(env(),{receiptId:'bad-scope',kind:'events',slug:'mlb',sport:'nfl',now:at}),/INVALID_LEAGUE_SCOPE/);
});


test('bulk page ingestion defers near the D1 cap without deleting archives or retiming observations',async()=>{
 const {onRequestPost}=await import('../functions/api/polymarket-pages.js');
 let probes=0,archiveReads=0;
 const env={HARVEST_SECRET:'capacity-test-secret',DB:{prepare(sql){assert.equal(sql,'SELECT 1 AS healthy');return{bind(){return{async all(){probes++;return{results:[{healthy:1}],meta:{size_after:9_900_000_000}}}}}}}},ARCHIVE:{async get(){archiveReads++;throw Error('must not consume while reserved')}}};
 const request=new Request('https://fbis.test/api/polymarket-pages',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':env.HARVEST_SECRET},body:JSON.stringify({operation:'consume',receiptId:'existing-receipt',batchIndex:0})});
 const response=await onRequestPost({env,request}),body=await response.json();
 assert.equal(response.status,409);assert.equal(body.error,'BULK_WRITE_DEFERRED_CAPACITY');assert.equal(body.archiveRetained,true);assert.equal(body.canAuthorizeWager,false);assert.equal(probes,1);assert.equal(archiveReads,0);
});


test('bulk ingestion cannot assume spare capacity when D1 omits size metadata',async()=>{
 const {onRequestPost}=await import('../functions/api/polymarket-pages.js');
 const env={HARVEST_SECRET:'capacity-test-secret',DB:{prepare(){return{bind(){return{async all(){return{results:[{healthy:1}],meta:{}}}}}}}}};
 const request=new Request('https://fbis.test/api/polymarket-pages',{method:'POST',headers:{'content-type':'application/json','x-harvest-secret':env.HARVEST_SECRET},body:JSON.stringify({operation:'consume',receiptId:'existing-receipt',batchIndex:0})});
 const response=await onRequestPost({env,request});assert.equal(response.status,503);assert.equal((await response.json()).error,'DATABASE_CAPACITY_UNKNOWN');
});
