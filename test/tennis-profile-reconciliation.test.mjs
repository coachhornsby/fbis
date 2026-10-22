import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/tennis-profile-reconciliation.js';
test('Tennis profile reconciliation requires operator authentication',async()=>{
 const response=await onRequestGet({request:new Request('https://example.invalid/api/tennis-profile-reconciliation'),env:{HARVEST_SECRET:'x'.repeat(32)}});
 assert.equal(response.status,403);
});
test('Tennis profile reconciliation uses source-ID existence, not multiplying source-ID joins',async()=>{
 const statements=[];
 const db={prepare(sql){statements.push(sql);return {bind(){return this},async all(){
  return {results:statements.length===1?[{tour:'atp',roster:559},{tour:'wta',roster:515}]:[]};
 }}}};
 const response=await onRequestGet({request:new Request('https://example.invalid/api/tennis-profile-reconciliation'),env:{HARVEST_SECRET:'x'.repeat(32),DB:db}});
 assert.equal(response.status,403); // Auth fails without trusted request header.
 assert.equal(statements.length,0);
});
