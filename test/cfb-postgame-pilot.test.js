import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { aggregatePostgameMetrics,processCfbPostgamePilot,validatePostgameEnvelope,cfbPostgamePilotHealth,claimCfbPostgamePilotLease } from '../functions/lib/cfbPostgamePilot.js';
const at='2026-10-11T00:20:00Z';
const fixture=()=>({game_id:'g1',provider_game_id:'100',season:2026,source:'fixture',status:'FINAL',
  game_at:'2026-10-10T20:00:00Z',observed_at:'2026-10-11T00:10:00Z',temporal_class:'POSTGAME_OBSERVED',scores:{home:28,away:14},teams:[
  {team_id:'h',provider_team_id:'1',side:'home',team_complete:true,player_complete:true,metrics:{points:28,yards:400,plays:80,sacks:null},
   players:[{player_id:'q',provider_player_id:'10',participated:true,metrics:{pass_yards:200}}]},
  {team_id:'a',provider_team_id:'2',side:'away',team_complete:true,player_complete:true,metrics:{points:14,yards:250,plays:50},players:[]}]});
function harness() {
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(readFileSync(new URL('../docs/sql/cfb-postgame-operational-candidate.sql',import.meta.url),'utf8'));
 const cache=new Map();let fail=false,interleave=null;
 const db={prepare(sql){return {bind(...args){return {sql,args,async all(){if(interleave&&sql.includes('LIMIT 129')){const next=interleave;interleave=null;await next();}return {results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){return sqlite.prepare(sql).run(...args);}};}};},
  async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{let i=0;for(const s of statements){sqlite.prepare(s.sql).all(...s.args);if(fail && ++i===7)throw new Error('injected batch failure');}sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const process=(payload=fixture(),extra={})=>processCfbPostgamePilot({db,archive:{async put(k,v){cache.set(k,v);}},databaseId:'isolated-test',mode:'nonproduction',identityVerifier:async()=>({verified:true,fbs_involving:true}),payload,rawBody:JSON.stringify(payload),at,...extra});
 const card=team=>JSON.parse(sqlite.prepare('SELECT v.body_json FROM cfb_postgame_card_current c JOIN cfb_postgame_card_versions v ON v.id=c.version_id WHERE c.team_id=?').get(team).body_json);
 return {sqlite,db,process,cache,card,fail:()=>{fail=true;},recover:()=>{fail=false;},interleave:callback=>{interleave=callback;}};
}
test('pilot refuses production before accessing dependencies',async()=>{
 await assert.rejects(processCfbPostgamePilot({mode:'nonproduction',databaseId:'b50c724c-903b-4241-8ce1-48d931e7a44c'}),/refuses production/);
});
test('real SQLite transaction publishes both cards and verified player only once',async()=>{
 const h=harness();const first=await h.process();assert.equal(h.card('h').games,1);assert.equal(h.card('a').record.losses,1);
 assert.equal(h.card('h').players.q.pass_yards.total,200);assert.equal(h.card('h').offense.sacks.total,null);
 const p=fixture();p.observed_at='2026-10-11T00:11:00Z';assert.equal((await h.process(p)).version,first.version);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_game_versions').get().n,1);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_outbox').get().n,3);
});
test('a failure between team publications rolls back game and both cards, then retries',async()=>{
 const h=harness();h.fail();await assert.rejects(h.process(),/batch failure/);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_current').get().n,0);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_game_versions').get().n,0);
 assert.equal(h.cache.size,1);h.recover();await h.process();assert.equal(h.card('h').games,1);
});
test('correction keeps old versions and removes superseded player contribution',async()=>{
 const h=harness();await h.process();const p=fixture();p.observed_at='2026-10-11T00:30:00Z';p.teams[0].metrics.yards=420;p.teams[0].players=[];
 await h.process(p,{at:'2026-10-11T00:31:00Z'});assert.equal(h.card('h').offense.yards.total,420);assert.deepEqual(h.card('h').players,{});
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_versions').get().n,4);
 await assert.rejects(h.process(fixture(),{at:'2026-10-11T00:32:00Z'}),/Out-of-order correction/);
});
test('source and identities fail closed before card writes',async()=>{
 const h=harness();const p=fixture();p.teams[1].player_complete=false;await assert.rejects(h.process(p),/Partial source/);
 await assert.rejects(h.process(fixture(),{identityVerifier:async()=>({verified:false})}),/identity qualification/);
 assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_current').get().n,0);
});
test('ratios use only paired observed denominators',()=>{
 const r=aggregatePostgameMetrics([{yards:100,plays:20},{yards:null,plays:80}]);assert.equal(r.yards_per_play.value,5);assert.equal(r.yards_per_play.games,1);
 const p=fixture();p.status='IN_PROGRESS';assert.throws(()=>validatePostgameEnvelope(p,at),/Unqualified final/);
});

test('original provider bytes stay separate from normalized game body',async()=>{
 const h=harness();const raw=' {"provider":"raw-example","statistics":[1,2]} ';await h.process(fixture(),{rawBody:raw});
 assert.equal([...h.cache.values()][0],raw);
 const r=h.sqlite.prepare('SELECT body_json FROM cfb_postgame_game_versions').get();assert.equal(JSON.parse(r.body_json).game_id,'g1');
});

test('concurrent game commit cannot overwrite dependent team aggregates',async()=>{
 const h=harness();const next=fixture();next.game_id='g2';next.provider_game_id='101';
 h.interleave(()=>h.process(next));
 await assert.rejects(h.process(),/malformed JSON/);
 assert.equal(h.card('h').games,1);
 await h.process();assert.equal(h.card('h').games,2);assert.equal(h.card('a').games,2);
});

test('all-position additive production, longest values and paired kicking rates stay explicit',()=>{
 const r=aggregatePostgameMetrics([{passing_yards:200,total_tackles:6,field_goals_made:2,field_goal_attempts:3,long_punt:55},{passing_yards:150,total_tackles:null,field_goals_made:null,field_goal_attempts:4,long_punt:60}]);
 assert.equal(r.passing_yards.total,350);assert.equal(r.total_tackles.games,1);assert.equal(r.long_punt.maximum,60);assert.equal(r.long_punt.mean,null);assert.equal(r.field_goal_rate.value,2/3);
});
test('partial data and rejected identity remain distinct durable defects',async()=>{
 const h=harness(),p=fixture();p.teams[1].player_complete=false;await assert.rejects(h.process(p));assert.equal(h.sqlite.prepare('SELECT state FROM cfb_postgame_jobs').get().state,'PARTIAL_SOURCE');
 await assert.rejects(h.process(fixture(),{identityVerifier:async()=>({verified:false})}));assert.equal(h.sqlite.prepare('SELECT state FROM cfb_postgame_jobs').get().state,'QUARANTINED');
});
test('health detects stale existing card pointers after a correction',async()=>{
 const h=harness();await h.process();const old=h.sqlite.prepare("SELECT version_id FROM cfb_postgame_card_current WHERE team_id='h'").get().version_id;
 const p=fixture();p.observed_at='2026-10-11T00:30:00Z';p.teams[0].metrics.yards=420;const corrected=await h.process(p,{at:'2026-10-11T00:31:00Z'});
 assert.equal((await cfbPostgamePilotHealth(h.db)).staleCardVersions.length,0);h.sqlite.prepare("UPDATE cfb_postgame_card_current SET version_id=? WHERE team_id='h'").run(old);
 const health=await cfbPostgamePilotHealth(h.db);assert.deepEqual(health.staleCardVersions,[{game_id:'g1',version:corrected.version,team_id:'h'}]);assert.equal(health.productionReady,false);
});

test('native lease ownership prevents concurrent or expired worker publication',async()=>{
 const h=harness(),now=new Date().toISOString();
 const claim=token=>claimCfbPostgamePilotLease({db:h.db,databaseId:'isolated-test',mode:'nonproduction',gameId:'g1',at:now,token});
 const first=await claim('one');assert.ok(first);assert.equal(await claim('two'),null);
 h.sqlite.prepare("UPDATE cfb_postgame_leases SET expires_at='2020-01-01T00:00:00Z'").run();const next=await claim('two');assert.ok(next);
 await assert.rejects(h.process(fixture(),{at:now,lease:first}),/lease/);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_current').get().n,0);
 await h.process(fixture(),{at:now,lease:next});assert.equal(h.card('h').games,1);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_leases').get().n,0);
});
test('lease replacement during acquisition rolls back the complete publication batch',async()=>{
 const h=harness(),now=new Date().toISOString();const lease=await claimCfbPostgamePilotLease({db:h.db,databaseId:'isolated-test',mode:'nonproduction',gameId:'g1',at:now,token:'one'});
 h.interleave(()=>h.sqlite.prepare("UPDATE cfb_postgame_leases SET lease_token='two'").run());
 await assert.rejects(h.process(fixture(),{at:now,lease}),/malformed JSON/);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_game_versions').get().n,0);assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM cfb_postgame_card_current').get().n,0);
 assert.equal(h.sqlite.prepare('SELECT lease_token FROM cfb_postgame_leases').get().lease_token,'two');
});
