import test from 'node:test';
import assert from 'node:assert/strict';
import {originalSnapshot,gradeOnce} from '../scripts/cfb-weekly-postgame-settle.mjs';
const source={game_id:'100',week:9};
const saved=[{frozen_at:'2026-10-28T14:00:00Z',model_version:'CFB-FBIS-v2',proj_home:21,proj_away:20},{frozen_at:'2026-10-25T12:00:00Z',model_version:'CFB-FBIS-v2',proj_home:28,proj_away:24}];
const final={independent_ncaa_verified:true,ncaa_home:35,ncaa_away:31,ncaa_contest_id:345,ncaa_scoreboard_url:'https://www.ncaa.com/scoreboard/...'};
test('uses original earliest saved prekickoff without postgame recalc',()=>{
 const original=originalSnapshot(saved,'2026-10-27T20:00:00Z');assert.equal(original.proj_home,28);
 const r=gradeOnce({source,original,espn:{reportedFinal:true},verifiedOfficial:final});assert.equal(r.officialVerified,true);assert.equal(r.marginError,0);assert.equal(r.canAuthorizeWager,false);
});
test('fails when original is absent or independent official match unavailable',()=>{
 assert.equal(gradeOnce({source,original:null,espn:{reportedFinal:true},verifiedOfficial:final}).officialVerified,false);
 assert.equal(gradeOnce({source,original:saved[1],espn:{reportedFinal:true},verifiedOfficial:{...final,independent_ncaa_verified:false}}).officialVerified,false);
});
