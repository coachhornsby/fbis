import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {bootstrapPolymarket,projectedPolymarketFixtures} from '../functions/lib/polymarketBootstrap.js';
const now=new Date('2026-10-18T06:00:00Z'),start='2026-10-18T20:00:00Z';
function environment(){
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE games(id TEXT,sport TEXT,start TEXT,home_name TEXT,away_name TEXT,home_abbr TEXT,away_abbr TEXT); CREATE TABLE prediction_snapshots(game_id TEXT,sport TEXT,model_version TEXT,projection_kind TEXT,proj_total REAL,proj_home REAL,proj_away REAL,p_home_final REAL,frozen_at TEXT);
 CREATE TABLE tennis_official_matches(match_id TEXT PRIMARY KEY,tour TEXT,source TEXT,match_time TEXT,player1_id TEXT,player2_id TEXT,observed_at TEXT);
 CREATE TABLE tennis_players(fbis_player_id TEXT PRIMARY KEY,tour TEXT,canonical_name TEXT);
 CREATE TABLE tennis_v2_research_decisions(canonical_event_id TEXT,pure_p1 REAL,decision_timestamp TEXT);`);
 db.prepare('INSERT INTO games VALUES(?,?,?,?,?,?,?)').run('g1','nfl',start,'Denver Broncos','Seattle Seahawks','DEN','SEA');
 const stored=new Map(),writes=[];
 return {db,stored,writes,DB:{prepare(sql){if(sql.startsWith('INSERT')||sql.startsWith('UPDATE'))return{bind(...args){return{async run(){writes.push(args);return{meta:{changes:1}};}}}};
 const stmt=db.prepare(sql);return{bind(...args){return{all:async()=>({results:stmt.all(...args)})}}};}},ARCHIVE:{get:async k=>stored.has(k)?{json:async()=>JSON.parse(stored.get(k))}:null,put:async(k,v)=>{stored.set(k,v)}}};
}
function tennisForecast(e,{decision='2026-10-18T05:00:00Z',matchStart=start}={}){
 e.db.prepare(`INSERT OR IGNORE INTO tennis_players VALUES(?,?,?)`).run('tp1','wta','Sonay Kartal');
 e.db.prepare(`INSERT OR IGNORE INTO tennis_players VALUES(?,?,?)`).run('tp2','wta','Magdalena Chwalinska');
 e.db.prepare(`INSERT OR REPLACE INTO tennis_official_matches VALUES(?,?,?,?,?,?,?)`)
  .run('wta_test_match','wta','WTA_OFFICIAL',matchStart,'tp1','tp2','2026-10-18T04:00:00Z');
 e.db.prepare(`DELETE FROM tennis_v2_research_decisions WHERE canonical_event_id=?`).run('wta_test_match');
 e.db.prepare(`INSERT INTO tennis_v2_research_decisions VALUES(?,?,?)`).run('wta_test_match',0.62,decision);
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
 const result=await bootstrapPolymarket(e,{operation:'catalogue'},{now,fetchImpl:async()=>Response.json({sports:[],leagues:[{slug:'nfl',name:'National Football League'},{slug:'fnl',name:'National Football League'}]})});
 assert.deepEqual(result.leagues.map(l=>l.slug),['nfl','fnl']);
 const page=await bootstrapPolymarket(e,{operation:'page',...result.leagues[1],offset:0,receiptId:'alias-page'},{now,fetchImpl:async()=>Response.json({events:[]})});assert.equal(page.itemCount,0);
});

test('catalogue continuation and event pagination have no historical 8-page or 60-event cutoff',async()=>{
 const e=environment();forecast(e);const page=await bootstrapPolymarket(e,{operation:'catalogue',offset:450},{now,fetchImpl:async url=>{if(url.pathname==='/v2/sports')return Response.json({sports:[]});assert.equal(url.searchParams.get('offset'),'450');return Response.json({leagues:Array.from({length:50},(_,i)=>({slug:'league-'+i}))});}});assert.equal(page.nextOffset,500);
 const events=await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:200,receiptId:'deep-events'},{now,fetchImpl:async url=>{assert.equal(url.searchParams.get('offset'),'200');return Response.json({events:[]});}});assert.equal(events.nextOffset,null);
});
test('per-game market discovery reaches contracts beyond the first 40 embedded markets',async()=>{
 const e=environment();forecast(e);const event={id:'ev',gameId:123,startTime:start,homeTeam:{name:'Denver Broncos'},awayTeam:{name:'Seattle Seahawks'},markets:[]};
 await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:0,receiptId:'market-parent'},{now,fetchImpl:async()=>Response.json({events:[event]})});
 const result=await bootstrapPolymarket(e,{operation:'markets',parentReceiptId:'market-parent',eventIndex:0,offset:60,receiptId:'market-child'},{now,fetchImpl:async url=>{assert.equal(url.pathname,'/v1/events/ev');return Response.json({event:{...event,marketCounts:{numMarkets:61},markets:[...Array.from({length:60},()=>({sportsMarketTypeV2:'SPORTS_MARKET_TYPE_PROP'})),{slug:'late-spread',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_SPREAD',marketSides:[{id:'yes',long:true,description:'Denver Broncos',price:'.5'}]}]}});}});
 assert.equal(result.contracts,1);assert.equal(result.inventory[0].market,'late-spread');
});

test('provider sport metadata includes NWSL and excludes cricket premier leagues',async()=>{
 const e=environment();e.db.prepare("UPDATE games SET sport='soccer'").run();forecast(e);e.db.prepare("UPDATE prediction_snapshots SET sport='soccer'").run();
 const r=await bootstrapPolymarket(e,{operation:'catalogue'},{now,fetchImpl:async u=>Response.json(u.pathname==='/v2/sports'?{sports:[{id:2,slug:'soccer'},{id:9,slug:'cricket'}]}:{leagues:[{slug:'nwsl',name:'NWSL',sportId:2},{slug:'etpl',name:'European T20 Premier League',sportId:9}]})});
 assert.deepEqual(r.leagues.map(l=>l.slug),['nwsl']);assert.equal(r.leagues[0].providerSport,'soccer');
});
test('event detail cannot claim completeness when advertised and returned market counts differ',async()=>{
 const e=environment();forecast(e);const event={id:'ev',startTime:start,homeTeam:{name:'Denver Broncos'},awayTeam:{name:'Seattle Seahawks'},markets:[]};
 await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:0,receiptId:'count-parent'},{now,fetchImpl:async()=>Response.json({events:[event]})});
 await assert.rejects(()=>bootstrapPolymarket(e,{operation:'markets',parentReceiptId:'count-parent',eventIndex:0,offset:0,receiptId:'count-child'},{now,fetchImpl:async()=>Response.json({event:{...event,marketCounts:{numMarkets:2},markets:[]}})}),/MARKET_COUNT_MISMATCH/);
});

test('verified league aliases resolve into canonical card sides without crossing league scope',async()=>{
 const {polymarketUsCanonicalSide}=await import('../functions/lib/polymarketUs.js');
 const o={sport:'soccer',marketFamily:'moneyline',side:'Bayer 04 Leverkusen'},g={home_name:'Bayer Leverkusen',away_name:'SC Freiburg'};
 assert.equal(polymarketUsCanonicalSide(o,g,'ger.1'),'home');assert.equal(polymarketUsCanonicalSide(o,g,'esp.1'),null);
 assert.equal(polymarketUsCanonicalSide({...o,side:'Draw'},g,'ger.1'),'draw');
});

test('game-line counter remains authoritative when separately managed prop counters lag',async()=>{
 const e=environment();forecast(e);const event={id:'ev',startTime:start,homeTeam:{name:'Denver Broncos'},awayTeam:{name:'Seattle Seahawks'},markets:[]};
 await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:0,receiptId:'scoped-parent'},{now,fetchImpl:async()=>Response.json({events:[event]})});
 const response={event:{...event,marketCounts:{numMarkets:1,numSpreadsAndTotalsMarkets:1},markets:[{slug:'one-spread',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_SPREAD',marketSides:[{id:'yes',long:true,description:'Denver Broncos',price:'.5'}]},{sportsMarketTypeV2:'SPORTS_MARKET_TYPE_PROP'}]}};
 const page=await bootstrapPolymarket(e,{operation:'markets',parentReceiptId:'scoped-parent',eventIndex:0,offset:0,receiptId:'scoped-child'},{now,fetchImpl:async()=>Response.json(response)});assert.equal(page.contracts,1);
 response.event.marketCounts.numSpreadsAndTotalsMarkets=2;e.stored.delete('market-sources/polymarket-us/bootstrap/scoped-parent-event-0-detail.json');
 await assert.rejects(()=>bootstrapPolymarket(e,{operation:'markets',parentReceiptId:'scoped-parent',eventIndex:0,offset:0,receiptId:'scoped-child-2'},{now,fetchImpl:async()=>Response.json(response)}));
});

test('resume reuses only recent incomplete runs, not completed available inventory or old runs',async()=>{
 const e=environment();forecast(e);const key='market-sources/polymarket-us/coverage/latest.json';
 const report={run:'bootstrap-prior',status:'GAPS',checkedAt:'2026-10-18T05:55:00Z',errors:[{reason:'INTERRUPTED'}]};e.stored.set(key,JSON.stringify(report));
 const resumed=await bootstrapPolymarket(e,{operation:'resume'},{now});assert.equal(resumed.run,report.run);
 e.stored.set(key,JSON.stringify({...report,errors:[],missingEvents:[{id:'unlisted'}]}));assert.equal((await bootstrapPolymarket(e,{operation:'resume'},{now})).run,null);
 e.stored.set(key,JSON.stringify({...report,runStartedAt:'2026-10-18T04:00:00Z'}));assert.equal((await bootstrapPolymarket(e,{operation:'resume'},{now})).run,null);
});

test('projected fixtures include official tennis matches with pregame research decisions',async()=>{
 const e=environment();
 assert.equal((await projectedPolymarketFixtures(e.DB,now)).length,0);
 tennisForecast(e,{decision:'2026-10-18T21:00:00Z'});
 assert.equal((await projectedPolymarketFixtures(e.DB,now)).length,0);
 tennisForecast(e);
 const fixtures=await projectedPolymarketFixtures(e.DB,now);
 assert.equal(fixtures.length,1);
 assert.equal(fixtures[0].id,'wta_test_match');
 assert.equal(fixtures[0].sport,'tennis');
 assert.equal(fixtures[0].tour,'wta');
 const catalogue=await bootstrapPolymarket(e,{operation:'catalogue'},{now,fetchImpl:async u=>Response.json(u.pathname==='/v2/sports'
  ?{sports:[{id:1,slug:'tennis'}]}:{leagues:[{slug:'wta',name:'WTA Tour',sportId:1},{slug:'nfl',name:'NFL',sportId:2}]})});
 assert.deepEqual(catalogue.leagues.map(l=>l.slug),['wta']);
 assert.equal(catalogue.projectedFixtures,1);
 const event={id:'pm-wta',title:'Sonay Kartal vs. Magdalena Chwalinska',startTime:start,seriesSlug:'wta',
  markets:[{slug:'wta-kartal-chwalinska',sportsMarketTypeV2:'SPORTS_MARKET_TYPE_MONEYLINE',
   marketSides:[{id:'yes',long:true,description:'Sonay Kartal',price:'.58'},{id:'no',long:false,description:'Magdalena Chwalinska',price:'.42'}]}]};
 const page=await bootstrapPolymarket(e,{operation:'page',sport:'tennis',slug:'wta',offset:0,receiptId:'tennis-page'},
  {now,fetchImpl:async()=>Response.json({events:[event]})});
 assert.equal(page.matchedEvents,1);assert.equal(page.contracts,1);
 assert.ok([...e.stored.keys()].some(k=>k.includes('stream-roster/')&&k.includes('wta')));
});

test('WTA underscore receipt identities persist without relaxing provider slug validation',async()=>{
 const e=environment();
 forecast(e);
 const receiptId='bootstrap-39527694106-markets-wta_2c913761b13aa933e504a552-0';
 const page=await bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'nfl',offset:0,receiptId},
  {now,fetchImpl:async()=>Response.json({events:[]})});
 assert.equal(page.ok,true);
 assert.equal(page.receiptId,receiptId);
 assert.ok(e.stored.has('market-sources/polymarket-us/bootstrap/'+receiptId+'.json'));
 await assert.rejects(()=>bootstrapPolymarket(e,{operation:'page',sport:'nfl',slug:'invalid_slug',offset:0,receiptId:'bad-slug'},
  {now,fetchImpl:async()=>Response.json({events:[]})}),/INVALID_SCOPE/);
});
