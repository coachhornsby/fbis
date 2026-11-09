import test from 'node:test';import assert from 'node:assert/strict';
import {captureCfbdCore,normalizeCfbdCorePacket} from '../scripts/lib/cfbdCoreSource.mjs';
const now=Date.parse('2026-11-09T05:00:00Z'),capturedAt=new Date(now).toISOString(),responseSha256='a'.repeat(64);
const row={team:'Texas',year:2026,rating:20,offense:12,defense:-7,specialTeams:1,throughWeek:10,throughSeasonType:'regular'};
const options={year:2026,capturedAt,responseSha256};
test('one bounded CFBD read preserves actual fields and exact canonical identity without model influence',async()=>{
 let calls=0,reserved=0;const r=await captureCfbdCore({key:'test-key',now,reserve:k=>{assert.equal(k,'CFBD');reserved++;},fetchFn:async(url,opts)=>{
  calls++;assert.equal(url,'https://api.collegefootballdata.com/ratings/core?year=2026');assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Authorization,'Bearer test-key');return new Response(JSON.stringify([row]));
 }});assert.equal(calls,1);assert.equal(reserved,1);assert.equal(r.packet.rows[0].canonicalId,'cfb-251');assert.equal(r.packet.rows[0].defense,-7);assert.equal(r.packet.rows[0].throughWeek,10);assert.equal(r.packet.modelInfluence,'NONE_SOURCE_ONLY');assert.equal(r.packet.canAuthorizeWager,false);assert.equal(r.receipt.rows,undefined);assert.ok(!JSON.stringify(r).includes('test-key'));
});
test('missing CORE components and week stay missing; rating is never decomposed',()=>{
 const p=normalizeCfbdCorePacket([{team:'Texas',rating:20}],options),r=p.rows[0];
 assert.equal(r.offense,null);assert.equal(r.defense,null);assert.equal(r.throughWeek,null);assert.equal(r.seasonEvidence,'REQUEST_SCOPED');assert.equal(r.modelEligible,false);assert.equal(r.providerUpdatedAt,null);
});
test('wrong season and unknown identity rejected, duplicate identity fails closed',()=>{
 const p=normalizeCfbdCorePacket([{...row,year:2025},{...row,team:'Unverified University'}],options);assert.equal(p.acceptedRows,0);assert.equal(p.rejectedRows,2);assert.throws(()=>normalizeCfbdCorePacket([row,row],options),/DUPLICATE/);
});
test('empty response is unavailable evidence, never zero ratings',()=>{
 const p=normalizeCfbdCorePacket([],options);assert.equal(p.state,'EMPTY_NOT_ZERO');assert.deepEqual(p.rows,[]);
});
test('redirect, upstream failure, invalid JSON and oversized response fail without retry',async()=>{
 for(const response of [new Response('',{status:302}),new Response('',{status:429}),new Response('bad'),new Response('[]',{headers:{'content-length':'3000001'}})]){
  let calls=0;await assert.rejects(captureCfbdCore({key:'test',now,fetchFn:async()=>{calls++;return response;}}));assert.equal(calls,1);
 }
});
test('missing credential or invalid year makes no request',async()=>{
 for(const args of [{year:2026},{key:'test',year:9999}])await assert.rejects(captureCfbdCore({...args,fetchFn:()=>{throw Error('unexpected network');}}));
});
