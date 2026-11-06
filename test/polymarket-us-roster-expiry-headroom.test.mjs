import test from 'node:test';
import assert from 'node:assert/strict';
import {eligiblePublishedCandidates} from '../functions/lib/boundedPolymarketRoster.js';
const now=Date.parse('2026-11-06T23:30:00Z');
const row=(ageMs)=>({sport:'cbb',market_family:'total',source_market_id:'cbb-'+ageMs,
 collected_at:new Date(now-ageMs).toISOString(),displayBinding:{period:'first_half'}});
test('expired first-half contract cannot invalidate independently fresh contracts',()=>{
 const mixed=[row(14*60000),row(10*60000),row(3*60000)];
 const chosen=eligiblePublishedCandidates(mixed,now);
 assert.equal(chosen.length,2);
 assert.deepEqual(chosen.map(x=>x.source_market_id),['cbb-600000','cbb-180000']);
 assert.ok(chosen.every(x=>Date.parse(x.collected_at)+900000>now+120000));
});
test('future timestamps and cutoff-near expiry are rejected',()=>{
 assert.equal(eligiblePublishedCandidates([row(-1000),row(780000),row(900000)],now).length,0);
});
