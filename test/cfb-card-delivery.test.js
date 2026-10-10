import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCfbFbisV2Production,promoteCfbFbisV2ToBoard} from '../functions/lib/cfbFbisV2.js';
import {productProjectionBoard} from '../functions/lib/productProjection.js';
import {toBoardGame,boardDateCtForStart} from '../functions/lib/todayBoard.js';
import {buildGameCardViewModel} from '../src/lib/gameCardViewModel.js';

function game(model={projectionKind:'UNAVAILABLE',projHome:null,projAway:null}) {
 return {id:'401860902',sport:'cfb',start:'2026-10-10T22:00:00Z',home:{name:'Oregon State',school:'Oregon State',espnId:'204'},away:{name:'San Diego State',school:'San Diego State',espnId:'21'},status:{live:false,completed:false},odds:{},model,cfbFbisV2Input:{home:{priorOff:25,priorDef:23,gamesPlayed:0},away:{priorOff:29,priorDef:22,gamesPlayed:0}}};
}
for(const prior of [{projectionKind:'UNAVAILABLE',projHome:null,projAway:null},{projectionKind:'FBIS',projHome:17.4,projAway:28.9,projTotal:46.3,projMargin:-11.5}]) {
 test(`fitted CFB projection replaces ${prior.projectionKind} delivery packet without odds`,()=>{
  const g=game(prior),p=projectCfbFbisV2Production(g);
  const promoted=promoteCfbFbisV2ToBoard([{...g,cfbFbisV2:p}]).games[0];
  const card=productProjectionBoard({sport:'cfb',date:'2026-10-10',games:[promoted]}).games[0];
  assert.equal(card.projection.home,p.home);assert.equal(card.projection.away,p.away);
  assert.equal(card.projection.total,p.total);assert.equal(card.projection.margin,p.margin);
  const board=buildGameCardViewModel(toBoardGame(promoted,'cfb'));
  assert.equal(board.projection.available,true);assert.equal(board.projection.home,p.home);assert.equal(board.projection.away,p.away);
  assert.equal(board.projection.total,p.total);assert.equal(board.projection.margin,p.margin);
  assert.equal(card.projection.canQualify,false);assert.equal(promoted.qualificationBlocked,true);
  assert.equal(promoted.cfb.bettingAllowed,false);assert.equal(card.model.state,'PROVISIONAL');
 });
}
test('calendar check keeps a post-midnight UTC game on the correct Central date',()=>{
 assert.equal(boardDateCtForStart('2026-10-11T04:59:00Z'),'2026-10-10');
 assert.equal(boardDateCtForStart('2026-10-11T05:00:00Z'),'2026-10-11');
});

import {hasCurrentProjection} from '../src/lib/currentProjectionValues.js';
import {onRequestGet} from '../functions/api/projections.js';
import {buildSlate} from '../functions/lib/slateEngine.js';
import {buildTodayBoard} from '../functions/lib/todayBoard.js';
import {resetCacheMem,writeCache} from '../functions/lib/cache.js';
import {loadCfbDeepFeatures} from '../functions/lib/cfbDeepFeed.js';
import {loadCfbCurrentForm,loadCfbFeatureFeeds,loadCfbBettingLines,loadCfbPrior} from '../functions/lib/cfbd.js';
import {freezeFromGame} from '../functions/lib/projLedger.js';
import {readFileSync} from 'node:fs';

const FIXED='2026-10-10T20:00:00Z';
const rows=[
 {game_id:'401860902',home_name:'Oregon State',away_name:'San Diego State',home_id:'204',away_id:'21',start:'2026-10-10T22:00:00Z',proj_home:17.4,proj_away:28.9},
 {game_id:'401862798',home_name:'Memphis',away_name:'UAB',home_id:'235',away_id:'5',start:'2026-10-10T23:00:00Z',proj_home:35.5,proj_away:15.5},
 {game_id:'401856715',home_name:'Kentucky',away_name:'LSU',home_id:'96',away_id:'99',start:'2026-10-10T23:00:00Z',proj_home:17.7,proj_away:27.1},
];
const events=rows.map(r=>({id:r.game_id,date:r.start,week:{number:7},competitions:[{status:{type:{name:'STATUS_SCHEDULED',state:'pre',completed:false}},competitors:[{homeAway:'home',team:{id:r.home_id,displayName:r.home_name}},{homeAway:'away',team:{id:r.away_id,displayName:r.away_name}}]}]}));
async function fixtureRun(run,{schedule=events,scheduleError=false}={}) {
 const oldFetch=globalThis.fetch,OldDate=globalThis.Date,oldCaches=globalThis.caches;
 const calls=[],writes=[];
 globalThis.Date=class extends OldDate {constructor(...args){super(...(args.length?args:[FIXED]));}static now(){return OldDate.parse(FIXED);}};
 resetCacheMem();
 globalThis.caches={default:{async match(){return null;},async put(){}}};
 globalThis.fetch=async input=>{
  const url=String(input?.url||input); calls.push(url);
  if(/collegefootballdata|parlay|the-odds-api|sharpapi|apify|prizepicks|therundown/i.test(url)) throw new Error('UNAUTHORIZED_PROVIDER_CALL '+url);
  if(url.includes('/scoreboard')) return scheduleError ? new Response('fixture schedule failure',{status:503}) : Response.json({events:schedule});
  if(url.includes('espn.com')&&url.includes('/rankings'))return Response.json({rankings:[]});
  if(url.includes('espn.com')&&url.includes('/roster'))return Response.json({athletes:[]});
  if(url.includes('kalshi.com'))return Response.json({markets:[]});
  if(url.includes('open-meteo.com'))return Response.json({hourly:{time:[]},results:[]});
  throw new Error('UNEXPECTED_FIXTURE_REQUEST '+url);
 };
 const DB={prepare(sql){return {bind(){return this;},async all(){return {results:[]};},async first(){return null;},async run(){writes.push(sql);throw new Error('READ_ONLY_FIXTURE');}};}};
 try {return await run({DB,CFBD_API_KEY:'fixture-only',PARLAY_API_KEY:'fixture-only',THEODDS_API_KEY:'fixture-only',SHARPAPI_API_KEY:'fixture-only',caches:globalThis.caches.default,cfbdCacheOnly:true,cfbdScheduleFallback:false,parlayCacheOnly:true,palCacheOnly:true},calls,writes);}
 finally {globalThis.fetch=oldFetch;globalThis.Date=OldDate;globalThis.caches=oldCaches;resetCacheMem();}
}

test('Models null reporting rejects absence, preserves genuine zero and consumes the tested helper',()=>{
 for(const x of [null,undefined,'',NaN,Infinity])assert.equal(hasCurrentProjection({projection:{home:x,away:20}}),false);
 assert.equal(hasCurrentProjection({projection:{home:0,away:0}}),true);
 const view=readFileSync(new URL('../src/features/models/CurrentProjectionsView.jsx',import.meta.url),'utf8');
 assert.match(view,/hasCurrentProjection as hasProjection/);assert.doesNotMatch(view,/Number\(p\.home\)/);
});

test('real CFB slate -> fitted scores -> handler JSON -> Board and Models contracts, no paid reads or D1 writes',async(t)=>fixtureRun(async(env,calls,writes)=>{
 const slate=await buildSlate('cfb','2026-10-10',env);
 assert.equal(slate.games.length,3);
 const res=await onRequestGet({request:new Request('https://fixture.invalid/api/projections?sport=cfb&date=2026-10-10'),env});
 assert.equal(res.status,200);const dto=await res.json();assert.equal(dto.games.length,3);
 const board=await buildTodayBoard('2026-10-10',env,{focusSport:'cfb',now:Date.now()});
 assert.equal(board.games.length,3);
 for(const g of slate.games){
  const p=g.cfbFbisV2;assert.equal(p.ok,true);assert.equal(p.fittedApplied,true);
  const card=dto.games.find(x=>x.id===g.id);assert.ok(card);
  assert.equal(card.home.id,g.home.canonicalId||g.home.id||null);assert.equal(card.away.id,g.away.canonicalId||g.away.id||null);
  assert.equal(card.projection.home,p.home);assert.equal(card.projection.away,p.away);
  assert.equal(card.projection.margin,p.margin);assert.equal(card.projection.total,p.total);
  assert.equal(card.modelVersion,'CFB-FBIS-v2');assert.equal(card.model.state,g.cfb.projectionState);
  assert.equal(card.model.canQualify,false);assert.equal(card.projection.canQualify,false);
  assert.equal(hasCurrentProjection(card),true);assert.equal(card.market.spread,null);assert.equal(card.market.total,null);
  const b=board.games.find(x=>x.id===g.id),vm=buildGameCardViewModel(b);
  assert.equal(vm.projection.available,true);assert.equal(vm.projection.home,p.home);assert.equal(vm.projection.away,p.away);
  assert.equal(vm.projection.margin,p.margin);assert.equal(vm.projection.total,p.total);
  const frozen=freezeFromGame('2026-10-10',g);
  assert.equal(frozen.projHome,p.home);assert.equal(frozen.projAway,p.away);
  t.diagnostic(JSON.stringify({id:g.id,home:p.home,away:p.away,margin:p.margin,total:p.total,state:g.cfb.projectionState,model:card.modelVersion}));
 }
 assert.deepEqual(writes,[]);
 assert.equal(calls.filter(x=>/collegefootballdata|parlay|the-odds-api|sharpapi|apify|prizepicks|therundown/i.test(x)).length,0);
}));

test('cache-only CFBD misses do not acquire data, and a cached deep feed stays intact',async()=>fixtureRun(async(env,calls)=>{
 const reject=()=>{throw new Error('must-not-fetch');};
 for(const load of [loadCfbCurrentForm,loadCfbFeatureFeeds,loadCfbBettingLines,loadCfbPrior,loadCfbDeepFeatures]) await load(env,{fetchFn:reject,now:Date.now()});
 assert.deepEqual(calls,[]);
 const payload={byEspnId:{'204':{offensePpa:0.2}},bySchool:{},meta:{records:1,asOf:'2026-10-10T19:00:00Z'}};
 await writeCache('cfb-deep-v2-2026',payload,env.caches,7200000);
 assert.deepEqual(await loadCfbDeepFeatures(env,{fetchFn:reject,now:Date.now()}),payload);
}));

test('empty schedule returns an explicit empty response, never a manufactured card',async()=>fixtureRun(async(env)=>{
 const res=await onRequestGet({request:new Request('https://fixture.invalid/api/projections?sport=cfb&date=2026-10-10'),env});
 assert.equal(res.status,200);assert.deepEqual((await res.json()).games,[]);
},{schedule:[]}));

test('CFB API filters weekly schedule dates exactly like the Central-time Board',async()=>fixtureRun(async(env)=>{
 const res=await onRequestGet({request:new Request('https://fixture.invalid/api/projections?sport=cfb&date=2026-10-10'),env});
 const out=await res.json();assert.equal(out.games.length,1);assert.equal(out.games[0].id,events[0].id);
},{schedule:[{...events[0],date:'2026-10-11T04:59:00Z'},{...events[1],date:'2026-10-11T05:00:00Z'}]}));

for(const field of ['home','away','margin','total'])test(`malformed fitted ${field} fails promotion`,()=>{
 const g=game(),p=projectCfbFbisV2Production(g);
 for(const x of [null,undefined,NaN,Infinity,'']){
  const input={...g,cfbFbisV2:{...p,[field]:x}};
  assert.equal(promoteCfbFbisV2ToBoard([input]).meta.promoted,0);
 }
});

test('snapshot identities and stale/duplicate checkpoints cannot become a display fallback',()=>{
 const g=game(),old={...g,id:'different-game',checkpoint:'CLOSE',frozenAt:'2026-09-01',projHomeScore:99,projAwayScore:98};
 const out=promoteCfbFbisV2ToBoard([g,old]);assert.equal(out.meta.promoted,0);
 assert.equal(productProjectionBoard({sport:'cfb',games:out.games}).games[0].projection.home,null);
});


test('failed schedule stays an API error, not a successful empty slate',async()=>fixtureRun(async(env)=>{
 const res=await onRequestGet({request:new Request('https://fixture.invalid/api/projections?sport=cfb&date=2026-10-10'),env});
 assert.equal(res.status,502);const body=await res.json();assert.equal(body.ok,false);assert.equal(body.error,'projection-board-unavailable');assert.match(body.detail,/503/);
},{scheduleError:true}));

for(const status of [{live:false,completed:false},{live:true,completed:false},{live:false,completed:true}])test(`projection display does not rewrite game lifecycle ${JSON.stringify(status)}`,()=>{
 const g=game();g.status=status;const p=projectCfbFbisV2Production(g);
 const x=promoteCfbFbisV2ToBoard([{...g,cfbFbisV2:p}]).games[0];
 const card=productProjectionBoard({sport:'cfb',games:[x]}).games[0];
 assert.equal(card.projection.home,p.home);assert.equal(card.gameState.live,status.live);assert.equal(card.gameState.completed,status.completed);
 assert.equal(x.cfb.bettingAllowed,false);
});
