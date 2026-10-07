import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWithColdStart, MIN_COLD_START_MATCHES } from '../tennis/tennisColdStart.mjs';

const row=(i)=>({
  date:`2026-09-${String(i+1).padStart(2,'0')}`, surface:'Hard',
  aces:5+i%2, doubleFaults:2, svGms:10,
  servePtsWonPct:0.64, returnPtsWonPct:0.36
});

test('cold start fails closed when live history is unavailable', async()=>{
  const r=await resolveWithColdStart({fetchRecentMatches:async()=>[]},null,'Unknown Player',{surface:'Hard',liveSource:'fake'});
  assert.equal(r.player,null);
  assert.equal(r.insufficient,true);
  assert.equal(r.reason,'insufficient_observed_live_history');
});

test('cold start requires observed live match sample and marks provenance', async()=>{
  const rows=Array.from({length:MIN_COLD_START_MATCHES},(_,i)=>row(i));
  const r=await resolveWithColdStart({fetchRecentMatches:async()=>rows},null,'Observed Player',{surface:'Hard',liveSource:'fake'});
  assert.equal(r.insufficient,false);
  assert.equal(r.coldStart,true);
  assert.equal(r.player._coldStart,true);
  assert.equal(r.player._sampleMatches,MIN_COLD_START_MATCHES);
  assert.equal(r.player._profileSource,'live-observed');
  assert.equal(r.player._liveSource,'fake');
  assert.ok(r.player.surfaces.Hard.servePtsWonPct>0);
});

test('existing historical profile bypasses cold start', async()=>{
  const known={name:'Indexed',surfaces:{ALL:{n:25}}};
  const r=await resolveWithColdStart({fetchRecentMatches:async()=>{throw new Error('should not call');}},known,'Indexed',{});
  assert.equal(r.player,known);
  assert.equal(r.coldStart,false);
});
