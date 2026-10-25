import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {calculateTennisFreeShadow,FREE_TENNIS_SHADOW_VERSION}
 from '../functions/lib/tennisFreeShadowModel.js';
const at='2026-10-25T21:00:00Z',start='2026-10-26T10:00:00Z';
const event={match_id:'wta-example',tour:'wta',source:'WTA_OFFICIAL',
 completion_state:'SCHEDULED',player1_id:'tennis:wta:p1',
 player2_id:'tennis:wta:p2',match_time:start,observed_at:'2026-10-25T20:00:00Z',
 surface:'hard',raw_artifact_key:'tennis/official-schedule/wta/raw/abc.json',
 provenance_json:JSON.stringify({source:'WTA_OFFICIAL',rawHash:'a'.repeat(64),
  isEstimatedStartTime:false,blockedReason:null})};
const person=(id,serve=.62,ret=.42)=>({ok:true,fbisPlayerId:id,identityLinkedAt:'2026-10-24T20:00:00Z',
 asOf:at,researchStats:{tour:'wta',matches:6,latestObservedAt:'2026-10-25T20:30:00Z',
 overall:{servePoints:600,returnPoints:550,firstWon:Math.round(serve*600),
 secondWon:0,returnPointsWonPct:ret}}});
const elo=(id,overall,hard)=>({tour:'wta',source:'TENNIS_ABSTRACT_CURRENT_ELO_RESEARCH_ONLY',
 player_key:id,overall_elo:overall,hard_elo:hard,source_hash:'b'.repeat(64),
 reportDate:'2026-10-19',retrievedAt:'2026-10-21T20:00:00Z'});
const ctx={event,one:person(event.player1_id),two:person(event.player2_id,.60,.40),
 elo1:elo('p1',1900,1920),elo2:elo('p2',1800,1800),
 now:new Date(at)};
test('fixed research challenger produces coherent strictly pre-start forecast',()=>{
 const r=calculateTennisFreeShadow(ctx);
 assert.equal(r.ok,true);assert.equal(r.modelId,FREE_TENNIS_SHADOW_VERSION);
 assert.ok(r.p1>.5);assert.ok(Math.abs(r.p1+r.p2-1)<1e-12);
 assert.equal(r.calibrated,false);assert.equal(r.contractTradingAuthorized,false);
 assert.equal(r.inputs.elo.usesSurface,true);
});
test('rejects stale, mismatched, post-start or missing evidence',()=>{
 const bad=[
  {...ctx,now:new Date(start)},
  {...ctx,event:{...event,source:'ESPN'}},
  {...ctx,event:{...event,provenance_json:'{}'}},
  {...ctx,one:person(event.player1_id,.62,.42),two:{...ctx.two,fbisPlayerId:'wrong'}},
  {...ctx,one:{...ctx.one,researchStats:{...ctx.one.researchStats,matches:2}}},
  {...ctx,elo1:{...ctx.elo1,source_hash:'c'.repeat(64)}},
  {...ctx,elo1:{...ctx.elo1,retrievedAt:'2026-10-26T10:01:00Z'}},
  {...ctx,event:{...event,provenance_json:JSON.stringify({source:'WTA_OFFICIAL',
    rawHash:'a'.repeat(64),isEstimatedStartTime:true})}}
 ];
 for(const scenario of bad)assert.equal(calculateTennisFreeShadow(scenario).ok,false);
});
test('migration prevents retroactive probability edits, deletion and trading authorization',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT)');
 db.exec(readFileSync(new URL('../migrations/0127_tennis_free_shadow_forecasts.sql',import.meta.url),'utf8'));
 const sql=`INSERT INTO tennis_free_shadow_forecasts(
 snapshot_id,canonical_event_id,tour,model_id,player1_id,player2_id,
 surface,event_source,event_observed_at,event_raw_artifact_key,forecast_at,
 event_start_time,p1_win,p2_win,input_hash,input_json,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
 db.prepare(sql).run('s1','e1','wta',FREE_TENNIS_SHADOW_VERSION,
 'p1','p2','hard','WTA_OFFICIAL',at,'tennis/official-schedule/wta/raw/a',at,start,.6,.4,
 'x'.repeat(64),'{}',at);
 assert.throws(()=>db.exec("UPDATE tennis_free_shadow_forecasts SET p1_win=.5 WHERE snapshot_id='s1'"));
 assert.throws(()=>db.exec("DELETE FROM tennis_free_shadow_forecasts WHERE snapshot_id='s1'"));
 assert.throws(()=>db.exec("UPDATE tennis_free_shadow_forecasts SET contract_trading_authorized=1"));
 assert.throws(()=>db.prepare(sql).run('s2','e1','wta',FREE_TENNIS_SHADOW_VERSION,
 'p1','p2','hard','WTA_OFFICIAL',at,'x',at,start,.55,.45,
 'z'.repeat(64),'{}',at));
 db.close();
});
