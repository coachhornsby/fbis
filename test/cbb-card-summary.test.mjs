import test from 'node:test';import assert from 'node:assert/strict';
import {cbbCardSummary,validateCbbCardSummary} from '../functions/lib/cbbCardSummary.js';
const now=Date.parse('2026-11-06T16:00Z'),date='2026-11-06';
const packet={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',generatedAt:'2026-11-06T15:00Z',expiresAt:'2026-11-06T22:00Z',captures:{kenpom:'2026-11-06T14:59Z'},secret:'DO_NOT_SEND',rawRatings:[{adjO:123}],events:[{eventId:'123',date,start:'2026-11-06T21:00Z',homeId:'cbb-1',awayId:'cbb-2',neutralSite:true,contract:{raw:'DO_NOT_SEND'},primary:{home:74,away:70,margin:4,total:144,modelId:'CBB-KENPOM-RATINGS-v1',possessions:69,hca:0}}]};
test('board summary exposes only derived scores and source labels, without authentication or raw inputs',()=>{const p=cbbCardSummary(packet,{date,now});assert.equal(p.events.length,1);assert.equal(p.events[0].primary.home,74);assert.equal(p.canAuthorizeWager,false);assert.ok(!JSON.stringify(p).includes('DO_NOT_SEND'));assert.ok(!JSON.stringify(p).includes('possessions'));assert.ok(!JSON.stringify(p).includes('rawRatings'));assert.equal(validateCbbCardSummary(p,{date,now}).visibility,'CBB_CARD_SUMMARY');});
test('cross-date, duplicate and unknown-model packets cannot populate a card',()=>{for(const mutate of [p=>p.events[0].date='2026-11-05',p=>p.events.push(p.events[0]),p=>p.events[0].primary.modelId='UNVERIFIED']){const p=structuredClone(packet);mutate(p);assert.throws(()=>cbbCardSummary(p,{date,now}));}});

test('Torvik comparison and source evidence stay out of public summary',()=>{const p=structuredClone(packet);p.torvikProvenance={secret:'TORVIK_PRIVATE',receipts:[{sha256:'x'}]};p.captures.torvik='2026-11-06T14:59Z';p.events[0].comparison={home:80,away:70,margin:10,total:150,attribution:'TORVIK_PRIVATE'};const result=cbbCardSummary(p,{date,now});assert.equal(result.events[0].comparison,undefined);assert.equal(result.torvikProvenance,undefined);assert.equal(result.captures.torvik,undefined);assert.ok(!JSON.stringify(result).includes('TORVIK_PRIVATE'));});

test('expired CBB summaries retain only historical pregame events, without fresh authority',()=>{
 const p=structuredClone(packet);p.expiresAt='2026-11-06T15:59Z';
 assert.equal(cbbCardSummary(p,{date,now}).events.length,0);
 const later=Date.parse('2026-11-06T23:00Z');
 const x=cbbCardSummary(p,{date,now:later});
 assert.equal(x.events.length,1);assert.equal(x.expiresAt,p.expiresAt);assert.equal(x.canAuthorizeWager,false);
 p.generatedAt='2026-11-06T21:01Z';p.expiresAt='2026-11-06T22:00Z';
 assert.equal(cbbCardSummary(p,{date,now:later}).events.length,0);
});
