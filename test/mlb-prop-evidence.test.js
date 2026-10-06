import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("MLB product rows expose prospective provenance required for calibration",()=>{
  const src=fs.readFileSync(new URL("../functions/lib/productProjection.js",import.meta.url),"utf8");
  for(const field of ["modelSource","modelVersion","sourceObservedAt","stateAsOf","eventId","opponent","eventStartAt","projectionSnapshotAt","canAuthorizeWager"]){
    assert.match(src,new RegExp(field));
  }
});

test("MLB prop evidence capture remains fail-closed and temporal",()=>{
  const src=fs.readFileSync(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  assert.match(src,/MLB_PROP_PROMOTION_GATE_VERSION/);
  assert.match(src,/SOURCE_AFTER_STATE/);
  assert.match(src,/STATE_AFTER_PROJECTION/);
  assert.match(src,/MARKET_AFTER_DECISION/);
  assert.match(src,/POST_START_SNAPSHOT/);
  assert.match(src,/can_qualify,can_authorize_wager/);
  assert.match(src,/VALUES\([\s\S]*0,0,/);
});

test("MLB prop evidence supports required settlement markets and no fantasy score",()=>{
  const src=fs.readFileSync(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  for(const market of ["strikeouts","pitcher_outs","walks_allowed","hits_allowed","earned_runs","pitch_count","hits","total_bases","home_runs","runs","rbis","walks","hits_runs_rbis"]){
    assert.match(src,new RegExp("\\\""+market+"\\\""));
  }
  assert.doesNotMatch(src,/SUPPORTED_MARKETS[^;]*fantasy_score/s);
  assert.match(src,/MLB_STATS_FINAL/);
});

test("MLB evidence workflow is bounded and restartable",()=>{
  const src=fs.readFileSync(new URL("../.github/workflows/mlb-prop-evidence.yml",import.meta.url),"utf8");
  assert.match(src,/for shard in 0 1 2/);
  assert.match(src,/shards:3/);
  assert.match(src,/limitGames:6/);
  assert.match(src,/operation:"capture"/);
  assert.match(src,/operation:"settle"/);
});


test("MLB accepted evidence also writes the canonical prospective ledger",()=>{
  const src=fs.readFileSync(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  assert.match(src,/INSERT OR IGNORE INTO fbis_prospective_evidence/);
  assert.match(src,/FBIS-PROSPECTIVE-EVIDENCE-v1/);
  assert.match(src,/stateBeforeWeight:true/);
  assert.match(src,/rawProjectionDistanceCanPromote:false/);
});


test("MLB evidence distinguishes offer snapshots from independent model units",()=>{
  const api=fs.readFileSync(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  const migration=fs.readFileSync(new URL("../migrations/0072_mlb_prop_independent_unit.sql",import.meta.url),"utf8");
  assert.match(api,/projectionUnitKey/);
  assert.match(api,/COUNT\(DISTINCT projection_unit_key\) independent_projection_units/);
  assert.match(api,/book_over_price,book_under_price,priced/);
  assert.match(migration,/projection_unit_key/);
});


test("MLB settlement conversion math is exact for outs, total bases, and H+R+RBI",async()=>{
  const {inningsToOuts,playerActual}=await import("../functions/api/mlb-prop-evidence.js");
  assert.equal(inningsToOuts("6.2"),20);
  assert.equal(inningsToOuts("5.1"),16);
  assert.equal(inningsToOuts("7.0"),21);
  assert.equal(inningsToOuts("4.3"),null);
  const hitter={position:{abbreviation:"3B"},stats:{batting:{hits:3,doubles:1,triples:1,homeRuns:1,runs:2,rbi:4,strikeOuts:1,baseOnBalls:2}}};
  assert.equal(playerActual(hitter,"total_bases"),9);
  assert.equal(playerActual(hitter,"hits_runs_rbis"),9);
  assert.equal(playerActual(hitter,"strikeouts"),1);
  const pitcher={position:{abbreviation:"P"},stats:{pitching:{inningsPitched:"6.2",strikeOuts:8,baseOnBalls:2,hits:5,earnedRuns:2,numberOfPitches:101}}};
  assert.equal(playerActual(pitcher,"pitcher_outs"),20);
  assert.equal(playerActual(pitcher,"strikeouts"),8);
  assert.equal(playerActual(pitcher,"walks_allowed"),2);
  assert.equal(playerActual(pitcher,"hits_allowed"),5);
  assert.equal(playerActual(pitcher,"earned_runs"),2);
  assert.equal(playerActual(pitcher,"pitch_count"),101);
});

test("MLB evidence status reports offer and independent settlement counts separately",()=>{
  const src=fs.readFileSync(new URL("../functions/api/mlb-prop-evidence.js",import.meta.url),"utf8");
  assert.match(src,/offer_snapshots/);
  assert.match(src,/independent_projection_units/);
  assert.match(src,/settled_offer_snapshots/);
  assert.match(src,/settled_independent_units/);
  assert.match(src,/actual_value_mismatch_units/);
});
