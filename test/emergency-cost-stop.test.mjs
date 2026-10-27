import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../functions/_middleware.js';
import {onSchedule} from '../functions/_scheduled.js';
import worker,{PausedSession} from '../services/emergency-stop/worker.mjs';
const forbidden=new Proxy({}, {get(){throw Error('External access during freeze');}});
test('maintenance blocks every method and never calls downstream or bindings',async()=>{
 for(const method of ['GET','POST','PUT','DELETE','OPTIONS']){
 const r=await onRequest({request:new Request('https://fbis.test/api/harvest',{method}),env:forbidden,next(){throw Error('downstream called');}});
 assert.equal(r.status,503);assert.equal(r.headers.get('x-fbis-state'),'COST_STOP_20261027');
 }
});
test('scheduled work and worker HTTP remain inert',async()=>{
 assert.equal((await onSchedule({env:forbidden})).executed,false);
 assert.equal((await worker.fetch(new Request('https://x/start'),forbidden)).status,503);
 await worker.scheduled({},forbidden);
});
test('durable session clears alarm without deleting stored evidence',async()=>{
 let deleted=0;const s=new PausedSession({storage:{async deleteAlarm(){deleted++;}}});
 await s.alarm();assert.equal((await s.fetch()).status,503);assert.equal(deleted,2);
 let closed=false;s.webSocketMessage({close(){closed=true;}});assert.equal(closed,true);
});
