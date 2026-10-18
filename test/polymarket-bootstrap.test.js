import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {bootstrapPolymarket,projectedPolymarketFixtures} from '../functions/lib/polymarketBootstrap.js';
const now=new Date('2026-10-18T06:00:00Z'),start='2026-10-18T20:00:00Z';
function environment(){
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE games(id TEXT,sport TEXT,start TEXT,home_name TEXT,away_name TEXT,home_abbr TEXT,away_abbr TEXT); CREATE TABLE prediction_snapshots(game_id TEXT,sport TEXT,model_version TEXT,projection_kind TEXT,proj_total REAL,proj_home REAL,proj_away REAL,p_home_final REAL,frozen_at TEXT);`);
 db.prepare('INSERT INTO games VALUES(?,?,?,?,?,?,?)').run('g1','nfl',start,'Denver Broncos','Seattle Seahawks','DEN','SEA');
 const stored=new Map(),writes=[];
 return {db,stored,writes,DB:{prepare(sql){if(sql.startsWith('INSERT'))return{bind(...args){return{async run(){writes.push(args);return{meta:{changes:1}};}}}};
 const stmt=db.prepare(sql);return{bind(...args){return{all:async()=>({results:stmt.all(...args)})}}};}},ARCHIVE:{get:async k=>stored.has(k)?{json:async()=>JSON.parse(stored.get(k))}:null,put:async(k,v)=>{stored.set(k,v)}}};
}
function forecast(e,time='2026-10-18T05:00:00Z'){e.db.prepare('INSERT INTO prediction_snapshots VALUES(?,?,?,?,?,?,?,?,?)').run('g1','nfl','model-v1','FBIS',44,null,null,.62,time);}
test('REST does not acquire markets before an independent pregame forecast',async()=>{
 const e=environment();let calls=0;const result=await bootstrapPolymarket(e,{operation:'catalogue'},{now,fetchImpl:async()=>{calls++;}});
 assert.equal(calls,0);assert.equal(result.projectedFixtures,0);
 forecast(e,'2026-10-18T21:00:00Z');assert.equal((await projectedPolymarketFixtures(e.DB,now)).length,0);
});
test('REST establishes matched contract roster, then actual book clocks and size; replay makes no provider calls',async()=>{
 const e=environment();forecast(e);
 const event={id:'pm-event',startTime:start,homeTeam:{name:'Denver Broncos'},awayTeam:{name:'Seattle Seahawks'},markets:[{slug:'nfl-den-sea',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_MONEYLINE',sportsMarketType:'football_team_full_game_moneyline',marketSides:[{id:'yes',long:true,description:'Denver Broncos',price:'.58'},{id:'no',long:false,description:'Seattle Seahawks',price:'.42'}]}]};
 let calls=0;const fetchImpl=async url=>{calls++;return Response.json(url.pathname==='/v1/events'?{events:[event,{...event,id:'unmatched',homeTeam:{name:'Other'},awayTeam:{name:'Wrong'},markets:[]}]}:{marketData:{marketSlug:'nfl-den-sea',state:'MARKET_STATE_OPEN',transactTime:'2026-10-18T05:59:55Z',bids:[{px:{value:'.56'},qty:'100'}],offers:[{px:{value:'.58'},qty:'100'}]}});};
 const opts={operation:'page',sport:'nfl',slug:'nfl',offset:0,receiptId:'test-run-nfl-0'};
 const page=await bootstrapPolymarket(e,opts,{now,fetchImpl});assert.equal(page.contracts,1);assert.equal(page.bookBatches,1);assert.equal(page.matchedEvents,1);
 assert.ok([...e.stored.keys()].some(k=>k.includes('stream-roster/')));
 const books=await bootstrapPolymarket(e,{operation:'quotes',receiptId:opts.receiptId,batchIndex:0},{now,fetchImpl});assert.equal(books.ok,true);assert.equal(books.inserted,2);
 const latest=e.writes.findLast(row=>row[28]==='yes');assert.equal(latest[29],'2026-10-18T05:59:55.000Z');assert.equal(latest[22],.58);
 await bootstrapPolymarket(e,opts,{now,fetchImpl});await bootstrapPolymarket(e,{operation:'quotes',receiptId:opts.receiptId,batchIndex:0},{now,fetchImpl});assert.equal(calls,2);
});

test('catalogue and page validation use the same independently classified slug scope',async()=>{
 const e=environment();forecast(e);
 const result=await bootstrapPolymarket(e,{operation:'catalogue'},{now,fetchImpl:async()=>Response.json({leagues:[{slug:'nfl',name:'National Football League'},{slug:'fnl',name:'National Football League'}]})});
 assert.deepEqual(result.leagues.map(l=>l.slug),['nfl','fnl']);
 const page=await bootstrapPolymarket(e,{operation:'page',...result.leagues[1],offset:0,receiptId:'alias-page'},{now,fetchImpl:async()=>Response.json({events:[]})});assert.equal(page.itemCount,0);
});

test('catalogue continuation and event pagination have no historical 8-page or 60-event cutoff',async()=>{
 const e=environment();forecast(e);const page=await bootstrapPolymarket(e,{operation:'catalogue',offset:450},{now,fetchImpl:async url=>{assert.equal(url.searchParams.get('offset'),'450');return Response.json({leagues:Array.from({length:50},(_,i)=>({slug:'league-'+i}))});}});assert.equal(page.nextOffset,500);
 const events=await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:200,receiptId:'deep-events'},{now,fetchImpl:async url=>{assert.equal(url.searchParams.get('offset'),'200');return Response.json({events:[]});}});assert.equal(events.nextOffset,null);
});
test('per-game market discovery reaches contracts beyond the first 40 embedded markets',async()=>{
 const e=environment();forecast(e);const event={id:'ev',gameId:123,startTime:start,homeTeam:{name:'Denver Broncos'},awayTeam:{name:'Seattle Seahawks'},markets:[]};
 await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:0,receiptId:'market-parent'},{now,fetchImpl:async()=>Response.json({events:[event]})});
 const result=await bootstrapPolymarket(e,{operation:'markets',parentReceiptId:'market-parent',eventIndex:0,offset:60,receiptId:'market-child'},{now,fetchImpl:async url=>{assert.equal(url.searchParams.get('gameId'),'123');assert.equal(url.searchParams.get('offset'),'60');return Response.json({markets:[{slug:'late-spread',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_SPREAD',marketSides:[{id:'yes',long:true,description:'Denver Broncos',price:'.5'}]}]});}});
 assert.equal(result.contracts,1);assert.equal(result.inventory[0].market,'late-spread');
});
