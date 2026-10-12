import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSchedulePage,sanitizeTaskPage } from '../scripts/lib/apifyAuditSanitizer.mjs';

test('Apify schedule audit omits action input, auth data and secret fields',()=>{
 const schedules=sanitizeSchedulePage({total:1,items:[{
   id:'schedule1',name:'sports-refresh',isEnabled:true,cronExpression:'0 * * * *',timeZone:'UTC',
   token:'LEAK_TOKEN',secret:'LEAK_SECRET',
   actions:[{type:'RUN_ACTOR',actorId:'actor1',actorTaskId:'task1',input:{apiToken:'LEAK_TOKEN'},secret:'LEAK_SECRET'}],
 }]});
 const serialized=JSON.stringify(schedules);
 assert.equal(schedules.items[0].actions[0].actorId,'actor1');
 assert.equal(schedules.complete,true);
 assert.doesNotMatch(serialized,/LEAK_TOKEN|LEAK_SECRET|apiToken|input/);
});
test('Apify task audit whitelists names and IDs only',()=>{
 const tasks=sanitizeTaskPage({total:2,items:[{id:'task1',name:'Odds',actId:'actor1',input:{key:'LEAK'},options:{token:'LEAK'}}]});
 assert.equal(tasks.complete,false);
 assert.deepEqual(tasks.items[0],{id:'task1',name:'Odds',actorId:'actor1',createdAt:null,modifiedAt:null});
 assert.doesNotMatch(JSON.stringify(tasks),/LEAK|options|input/);
});
test('failure and unknown pages do not claim an empty successful account',()=>{
 assert.deepEqual(sanitizeSchedulePage({http:403}),{available:false,http:403,total:null,items:[]});
 assert.equal(sanitizeTaskPage(undefined).available,false);
});
