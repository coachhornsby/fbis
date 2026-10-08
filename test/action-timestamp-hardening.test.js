import test from 'node:test';
import assert from 'node:assert/strict';
import {actionTimestampMs as parse,actionTemporalValidity as valid} from '../functions/lib/actionTemporalValidity.js';
const now=Date.parse('2026-10-08T12:00:00Z');
test('calendar validation uses actual four-digit year, including year zero',()=>{
 for(const s of ['0000-02-29','0004-02-29','2000-02-29','2024-02-29'])assert.ok(Number.isFinite(parse(s+'T00:00:00Z')),s);
 for(const s of ['0100-02-29','1900-02-29','2026-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00'])assert.ok(Number.isNaN(parse(s+'T00:00:00Z')),s);
});
test('offset grammar and equivalent UTC/SQLite timestamps',()=>{
 assert.equal(parse('2026-10-08 12:00:00'),now);
 assert.equal(parse('2026-10-08T07:00:00-05:00'),now);
 assert.equal(parse('2026-10-08T17:30:00+05:30'),now);
 for(const z of ['+24:00','-24:00','+00:60','-12:99'])assert.ok(Number.isNaN(parse('2026-10-08T12:00:00'+z)));
 assert.ok(Number.isFinite(parse('2026-10-08T12:00:00+23:59')));
 for(const s of ['2026-10-08','2026-10-08T12:00:00','2026-10-08T24:00:00Z','2026-10-08T12:00:60Z'])assert.ok(Number.isNaN(parse(s)));
});
test('fractional precision cannot truncate a future observation onto the clock',()=>{
 assert.equal(parse('2026-10-08T12:00:00.123000Z'),now+123);
 assert.equal(parse('2026-10-08T12:00:00.1Z'),now+100);
 for(const s of ['2026-10-08T12:00:00.0001Z','2026-10-08T11:59:00.1234Z'])assert.equal(valid({collectedAt:s},{now}).valid,false);
});
test('invalid clocks, observation ordering, and exact inclusive boundary fail closed',()=>{
 const t='2026-10-08T12:00:00Z';
 for(const clock of [NaN,Infinity,1e20,now+0.5,'bad'])assert.equal(valid({collectedAt:t},{now:clock}).valid,false);
 assert.equal(valid({collectedAt:'2026-10-08T11:50:00Z'},{now}).valid,true);
 assert.equal(valid({collectedAt:'2026-10-08T11:49:59.999Z'},{now}).valid,false);
 assert.equal(valid({collectedAt:'2026-10-08T12:00:00.001Z'},{now}).valid,false);
 assert.equal(valid({collectedAt:'2026-10-08T11:59:00Z',sourceObservedAt:t},{now}).valid,false);
 assert.equal(valid({collectedAt:t,sourceObservedAt:'bad'},{now}).valid,false);
});
