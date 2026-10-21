import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/tennis-abstract-elo-refresh.js';
const snapshots=[{tour:'atp',report_date:'2026-10-19',source_hash:'a'.repeat(64),player_count:559,retrieved_at:'2026-10-21T20:00:00Z'},
 {tour:'wta',report_date:'2026-10-19',source_hash:'a'.repeat(64),player_count:515,retrieved_at:'2026-10-21T20:00:00Z'}];
const db=rows=>({prepare(){return {all:async()=>({results:rows})};}});
test('source status exposes exact primary/sport shadow parity with no wager authority',async()=>{
 const res=await onRequestGet({env:{DB:db(snapshots),TENNIS_DB:db(snapshots)}});
 const body=await res.json();
 assert.equal(body.ok,true);
 assert.equal(body.shadowParity,true);
 assert.equal(body.researchOnly,true);
 assert.equal(body.canAuthorizeWager,false);
});
test('source status never falsely reports parity for missing WTA shadow',async()=>{
 const res=await onRequestGet({env:{DB:db(snapshots),TENNIS_DB:db(snapshots.slice(0,1))}});
 const body=await res.json();
 assert.equal(body.shadowParity,false);
});

test('shadow parity detects same date/count with different validated source content',async()=>{
 const mismatched=snapshots.map(r=>r.tour==='wta'?{...r,source_hash:'b'.repeat(64)}:r);
 const res=await onRequestGet({env:{DB:db(snapshots),TENNIS_DB:db(mismatched)}});
 const body=await res.json();
 assert.equal(body.shadowParity,false);
});
