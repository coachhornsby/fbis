import test from 'node:test';import assert from 'node:assert/strict';import{reserveCbbDailyCapture as reserve}from'../scripts/lib/cbbDurableAdmission.mjs';
function bucket(){const data=new Map();return {data,async get(k){return data.has(k)?{text:async()=>data.get(k)}:null;},async put(k,v){if(data.has(k))return null;data.set(k,v);return {};}};}
const now=Date.parse('2026-11-09T21:00:00Z');
test('atomic concurrent claims permit only one source attempt',async()=>{const b=bucket(),r=await Promise.all([reserve({bucket:b,now}),reserve({bucket:b,now})]);assert.equal(r.filter(x=>x.allowed).length,1);});
test('real old-runner capture conservatively consumes first slot, original timestamp retained',async()=>{const b=bucket();const r=await reserve({bucket:b,now,existingCaptureAt:'2026-11-09T12:25:47.231Z',existingCaptureVerified:true,sameDayUnledgeredCaptureCount:1});assert.equal(r.slot,2);assert.equal(JSON.parse([...b.data.values()][0]).startedAt,'2026-11-09T12:25:47.231Z');assert.equal((await reserve({bucket:b,now:now+4*3600000})).reason,'CBB_DAILY_ATTEMPTS_EXHAUSTED');});
test('same-day cooldown does not consume another slot',async()=>{const b=bucket();await reserve({bucket:b,now});assert.equal((await reserve({bucket:b,now:now+3600000})).reason,'CBB_THREE_HOUR_COOLDOWN');assert.equal(b.data.size,1);});
test('previous Central day capture does not consume today capacity',async()=>{assert.equal((await reserve({bucket:bucket(),now,existingCaptureAt:'2026-11-09T05:13:00Z',existingCaptureVerified:true})).slot,1);});
test('unverified evidence and missing durable storage fail closed',async()=>{await assert.rejects(reserve({bucket:bucket(),now,existingCaptureAt:'2026-11-09T12:00Z'}),/UNVERIFIED/);await assert.rejects(reserve({now}),/STORAGE_REQUIRED/);});

test('latest packet alone cannot prove daily unledgered call count',async()=>{await assert.rejects(reserve({bucket:bucket(),now,existingCaptureAt:'2026-11-09T12:00Z',existingCaptureVerified:true}),/UNRECONCILED/);});
