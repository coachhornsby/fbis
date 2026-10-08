import test from 'node:test';
import assert from 'node:assert/strict';
import {buildNflWagerIntelligence} from '../functions/lib/nflWagerDecision.js';
import {summarizeActionForDecision} from '../functions/lib/nbaWagerDecision.js';
import * as tennis from '../functions/api/tennis-v2-snapshot.js';
import {spawnSync} from 'node:child_process';
import {actionTemporalValidity,actionTimestampMs,currentActionRows,historicalActionRows} from '../functions/lib/actionTemporalValidity.js';
import {currentActionDisplay} from '../functions/lib/actionDisplayFreshness.js';
import {loadWnbaActionRows} from '../functions/lib/wnbaWagerDecision.js';
import {buildBoardActionIntel,attachActionIntelToGames} from '../functions/lib/boardActionIntel.js';
const now=Date.parse('2026-10-08T03:00:00Z');
test('NFL stale consensus is unavailable before packet derivation',()=>{
 const out=buildNflWagerIntelligence({actionIntel:{collectedAt:'2026-09-24T12:00:00Z',consensus:{spreadHome:-3,total:45}}},{margin:7,total:49},{decisionAt:now});
 assert.equal(out.current.spread,null);assert.equal(out.current.total,null);assert.equal(out.edgeTrajectory.totalCurrent,null);
});

for(const [label,at,valid] of [
 ['fresh','2026-10-08T02:59:00Z',true],
 ['exact boundary','2026-10-08T02:50:00Z',true],
 ['one millisecond beyond boundary','2026-10-08T02:49:59.999Z',false],
 ['missing',null,false],['malformed','bad',false],
 ['date-only','2026-10-08',false],['overflow date','2026-02-30T02:59:00Z',false],
 ['future','2026-10-08T03:00:00.001Z',false],
 ['offset timezone','2026-10-07T21:59:00-05:00',true],
 ['SQLite UTC','2026-10-08 02:59:00',true],
 ['unzoned ISO','2026-10-08T02:59:00',false]
])test(`ACTION timestamp validity: ${label}`,()=>{
 const result=actionTemporalValidity({collectedAt:at},{now});assert.equal(result.valid,valid);
 assert.equal(result.collectedAt,at);
});

test('publication or provider time cannot replace missing acquisition time',()=>{
 const at='2026-10-08T02:59:00Z';
 const intel=buildBoardActionIntel({created_at:at,source_observed_at:at,observed_at:at,consensus_json:'{"total":45}'});
 assert.equal(intel.collectedAt,null);
 assert.equal(currentActionDisplay({actionIntel:{collectedAt:at,observedAt:'2026-10-08T03:01:00Z',consensus:{total:45}}},now).actionIntel,null);
 assert.equal(currentActionDisplay({actionIntel:intel,sentiment:{source:'ACTION',collectedAt:at}},now).actionIntel,null);
 for(const sourceObservedAt of ['bad','2026-09-24T12:00:00Z','2026-10-08T03:01:00Z'])
  assert.equal(actionTemporalValidity({collectedAt:at,sourceObservedAt},{now}).valid,false);
});

test('fresh NFL evidence and timezone history remain usable without fabricating absent quotes',()=>{
 const game={market:{provider:'PINNACLE',total:47},actionIntel:{collectedAt:'2026-10-08T02:59:00Z',consensus:{spreadHome:-3,total:45},lineHistory:[
  {market:'spread',selection:'home',line:-2,collectedAt:'2026-10-07T20:00:00Z',providerTimestamp:'2026-10-07T20:00:00Z'},
  {market:'spread',selection:'home',line:-3,collectedAt:'2026-10-07T21:59:00-05:00',providerTimestamp:'2026-10-07T21:59:00-05:00'},
  {market:'spread',selection:'home',line:-99,collectedAt:'2026-10-08T03:01:00Z'},
  {market:'spread',selection:'home',line:-80,collectedAt:'2026-10-08T02:59:00Z',snapshotType:'CLOSE'}
 ]}};
 const out=buildNflWagerIntelligence(game,{margin:7,total:49},{decisionAt:now});
 assert.equal(out.current.spread,-3);assert.equal(out.opening.spread,-2);
 assert.equal(out.current.total,45);assert.equal(out.closeUsedAsDecisionInput,false);assert.equal(out.actionMayCreateBet,false);
 const missing=buildNflWagerIntelligence({...game,actionIntel:null},{margin:7,total:49},{decisionAt:now});
 assert.equal(missing.current.total,null);assert.equal(missing.current.spread,null);
 assert.equal(currentActionDisplay({...game,actionIntel:{collectedAt:'bad'}},now).market,game.market);
});

test('historical research retains original evidence with an explicit historical label',()=>{
 const row={collected_at:'2026-09-24T12:00:00Z',line:45};
 assert.deepEqual(currentActionRows([row],{now}),[]);
 const history=historicalActionRows([row],{now});
 assert.equal(history[0].temporalUse,'HISTORICAL_RESEARCH');assert.equal(history[0].collected_at,row.collected_at);
 assert.equal(history[0].line,45);assert.equal(row.temporalUse,undefined);
});

test('fresh NBA context accepted and invalid current values remain unavailable',()=>{
 const row={market_type:'total',selection:'OVER',line:45,collected_at:'2026-10-08T02:59:00Z'};
 const opts={decisionAt:'2026-10-08T03:00:00Z',marketType:'total',side:'OVER'};
 assert.equal(summarizeActionForDecision([row],opts).currentLine,45);
 for(const at of [null,'bad','2026-10-08T03:01:00Z','2026-09-24T12:00:00Z']){
  const out=summarizeActionForDecision([{...row,collected_at:at}],opts);
  assert.equal(out.available,false);assert.equal(out.currentLine,undefined);
  assert.equal(out.canDirectlyQualify,false);assert.equal(out.canAuthorize,false);
 }
});

test('WNBA direct DB reader validates inputs before context calculations',async()=>{
 const fresh={collected_at:'2026-10-08T02:59:00Z',line:45};
 const db={prepare(){return {bind(){return {all:async()=>({results:[fresh,{...fresh,collected_at:'bad'},{...fresh,collected_at:'2026-09-24T12:00:00Z'}]})};}};}};
 assert.deepEqual(await loadWnbaActionRows(db,'event',{decisionAt:now}),[fresh]);
});

test('Tennis actual SQL admits research-window boundary, rejects stale/future and sorts offsets chronologically',async()=>{
 const rows=[['old','2026-10-07T12:00:00.000Z'],['boundary','2026-10-07T19:00:00Z'],['before','2026-10-07T18:59:59.999Z'],['utc','2026-10-08T02:59:00Z'],['offset','2026-10-07T21:59:00-05:00'],['future','2026-10-08T03:00:00.001Z'],['missing',null],['bad','bad']];
 let originalCounterexample;
 const db={prepare(sql){return {bind(...params){return {async all(){
  const code=`import sqlite3,json,sys\nx=json.load(sys.stdin);c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row\ncols=['id','action_game_id','fbis_event_id','sport','league','home_team','away_team','start_time','consensus_json','public_betting_json','market_quality_json','line_movement_json','raw_payload_hash','source_observed_at','observed_at','collected_at','created_at','is_live']\nc.execute('CREATE TABLE shadow_market_observations ('+','.join(k+' TEXT' for k in cols)+')')\nfor id,at in x['rows']:c.execute('INSERT INTO shadow_market_observations (id,action_game_id,sport,collected_at,is_live) VALUES (?,?,?,?,?)',(id,id,'atp',at,'0'))\nprint(json.dumps({'rows':[dict(r) for r in c.execute(x['sql'],x['params'])],'oldAccepted':c.execute(\"SELECT '2026-10-07T12:00:00.000Z' >= datetime('2026-10-08T03:00:00Z','-8 hours')\").fetchone()[0]}))`;
  const r=spawnSync('python3',['-c',code],{input:JSON.stringify({sql,params,rows}),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const out=JSON.parse(r.stdout);originalCounterexample=out.oldAccepted;return {results:out.rows};
 } }; } }; } };
 const out=await tennis.latestActionRows(db,{hours:8,now});
 assert.equal(originalCounterexample,1);assert.deepEqual(out.map(r=>r.id).sort(),['boundary','offset','utc']);
 assert.equal(actionTimestampMs(out.find(r=>r.id==='offset').collected_at),actionTimestampMs(out.find(r=>r.id==='utc').collected_at));
});

test('Tennis ACTION auto decision fails closed before any DB/model operation',async()=>{
 const db={prepare(){throw Error('must not derive from stale input');}};
 const out=await tennis.autoDecisionForMarket(db,{provider:'ACTION_APIFY',collected_at:'2026-10-07T19:00:00Z',observed_at:'2026-10-07T19:00:00Z'},{now});
 assert.deepEqual(out,{inserted:false,reason:'ACTION_CAPTURE_NOT_CURRENT'});
});

test('shared attachment rejects preattached stale inputs even without a DB',async()=>{
 const game={market:{provider:'PINNACLE',total:47},actionIntel:{collectedAt:'2026-09-24T12:00:00Z',consensus:{total:45}}};
 const out=await attachActionIntelToGames([game],null,{now});
 assert.equal(out.games[0].actionIntel,null);assert.equal(out.games[0].market,game.market);
});

test('source observation after acquisition is temporally invalid',()=>{
 assert.equal(actionTemporalValidity({collectedAt:'2026-10-08T02:58:00Z',sourceObservedAt:'2026-10-08T02:59:00Z'},{now}).valid,false);
});

test('Tennis validates ACTION quotes before priors and preserves unrelated sources',()=>{
 const other={source:'PINNACLE',p1Price:-120,p2Price:110};
 const fresh={source:'ACTION_APIFY',p1Price:-120,p2Price:110,collectedAt:'2026-10-08T02:59:00Z',observedAt:'2026-10-08T02:59:00Z'};
 const stale={...fresh,collectedAt:'2026-09-24T12:00:00Z',observedAt:'2026-09-24T12:00:00Z'};
 assert.deepEqual(tennis.currentTennisQuotes([other,fresh,stale,{...fresh,observedAt:null}],now),[other,fresh]);
 assert.equal(other.collectedAt,undefined);assert.equal(fresh.collectedAt,'2026-10-08T02:59:00Z');
});
test('NBA rejects stale ACTION before summary derivation',()=>{
 const out=summarizeActionForDecision([{market_type:'total',selection:'OVER',line:45,collected_at:'2026-09-24T12:00:00Z'}],{decisionAt:new Date(now).toISOString(),marketType:'total',side:'OVER'});
 assert.equal(out.available,false);
});
test('Tennis research reader compares chronological timestamps',async()=>{
 assert.equal(typeof tennis.latestActionRows,'function');
 let sql,params;const db={prepare(s){sql=s;return {bind(...p){params=p;return {async all(){return {results:[]};}};}};}};
 await tennis.latestActionRows(db,{hours:8,now});
 assert.match(sql,/julianday\(collected_at\)/);assert.doesNotMatch(sql,/collected_at >= datetime/);
 assert.ok(params.includes('2026-10-07T19:00:00.000Z'));assert.ok(params.includes('2026-10-08T03:00:00.000Z'));
});
