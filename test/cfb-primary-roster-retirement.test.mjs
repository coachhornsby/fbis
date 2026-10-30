import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestGet} from '../functions/api/cfb-teams.js';
import {SPORT_PREFIX_TABLES,copySportPrefixTables} from '../functions/lib/sportWorkingCopy.js';
const trap={prepare(){throw Error('PRIMARY_MUST_NOT_BE_READ');}};
test('retired CFB roster tables cannot be copied from PRIMARY, including explicit requests',async()=>{
 for(const table of ['cfb_canonical_players','cfb_roster_membership','cfb_player_aliases','cfb_player_provider_ids','cfb_roster_observations']){
 assert.equal(SPORT_PREFIX_TABLES.cfb.includes(table),false);
 const r=await copySportPrefixTables({DB:trap,CFB_DB:trap,SPORT_DB_MODE_CFB:'shadow'},'cfb',{tables:[table]});
 assert.equal(r.reason,'CFB_PRIMARY_ROSTER_RETIRED');assert.equal(r.ok,false);
 }
});
test('CFB team endpoint refuses PRIMARY fallback in shadow mode or with a missing sport binding',async()=>{
 for(const env of [{DB:trap,CFB_DB:{prepare(){}},SPORT_DB_MODE_CFB:'shadow'},{DB:trap,SPORT_DB_MODE_CFB:'sport'}]){
 const r=await onRequestGet({env,request:new Request('https://local/api/cfb-teams')});
 assert.equal(r.status,503);assert.equal((await r.json()).error,'cfb-sport-database-required');
 }
});
