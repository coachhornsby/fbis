import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet as nhl} from '../functions/api/nhl-intelligence.js';
import {onRequestGet as tennis} from '../functions/api/tennis-match-intelligence.js';
const request=path=>new Request('https://fbis.example'+path);
test('intelligence endpoints validate identity before any database work',async()=>{
 assert.equal((await nhl({request:request('/?id=x%20OR%201'),env:{}})).status,400);
 assert.equal((await tennis({request:request('/?tour=other&home=A&away=B'),env:{}})).status,400);
});
test('NHL strict cutover never falls through to primary when shard unavailable',async()=>{
 const primary={prepare(){throw Error('must not read primary');}};
 const r=await nhl({request:request('/?id=123'),env:{DB:primary,SPORT_DB_MODE_NHL:'sport',SPORT_DB_STRICT_NHL:'true'}});
 assert.equal(r.status,503);assert.equal((await r.json()).ok,false);
});
test('Tennis exact-name ambiguity remains unmatched, no source calls or data writes',async()=>{
 const db={prepare(sql){assert.match(sql,/SELECT/);return {bind(){return this;},all:async()=>({results:[{canonical_name:'A'},{canonical_name:'A'}]})};}};
 const r=await tennis({request:request('/?tour=atp&home=A&away=B'),env:{DB:db}}),d=await r.json();
 assert.equal(d.home.state,'IDENTITY_AMBIGUOUS');assert.equal(d.home.profiles.length,0);assert.equal(d.canAuthorizeWager,false);
});
test('Tennis missing database and query failure are explicit and fail closed',async()=>{
 assert.equal((await tennis({request:request('/?tour=wta&home=A&away=B'),env:{}})).status,503);
 const r=await tennis({request:request('/?tour=wta&home=A&away=B'),env:{DB:{prepare(){throw Error('offline');}}}});
 assert.equal((await r.json()).reason,'TENNIS_RESEARCH_READ_FAILED');
});
