import test from 'node:test';
import assert from 'node:assert/strict';
import soccer from '../workers/soccer-pitchapi-backfill-worker.mjs';
import kalshi from '../services/kalshi-public-collector/index.js';
const blocked=new Proxy({}, {get(){throw Error('UNEXPECTED_RESOURCE_ACCESS');}});
test('unauthenticated backfill and unknown routes do not reserve or touch data',async()=>{
 assert.equal((await soccer.fetch(new Request('https://local/run',{method:'POST'}),{SOCCER_CONTROL_TOKEN:'private',FBIS_ACCOUNT_BUDGET:blocked})).status,401);
 assert.equal((await soccer.fetch(new Request('https://local/missing'),blocked)).status,404);
 assert.equal((await soccer.fetch(new Request('https://local/health'),blocked)).status,200);
 assert.equal((await kalshi.fetch(new Request('https://local/missing'),blocked)).status,404);
});
test('authorized backfill cannot run without budget admission',async()=>{
 await assert.rejects(()=>soccer.fetch(new Request('https://local/run',{method:'POST',headers:{'x-control-token':'private'}}),{SOCCER_CONTROL_TOKEN:'private'}),/ACCOUNT_BUDGET_BINDING_REQUIRED/);
});
