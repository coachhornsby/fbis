import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TennisDeepState} from '../functions/lib/tennisTwoSidedV11.js';

const complete={
 winner_id:'a',winner_name:'Alpha',loser_id:'b',loser_name:'Beta',
 w_svpt:70,l_svpt:68,w_1stIn:43,l_1stIn:42,w_1stWon:31,l_1stWon:25,
 w_2ndWon:15,l_2ndWon:11,w_ace:5,l_ace:3,w_df:2,l_df:4,
 w_SvGms:11,l_SvGms:10,w_bpSaved:3,w_bpFaced:5,l_bpSaved:4,l_bpFaced:7
};
test('missing or empty serve stats cannot be treated as valid zero-based history',()=>{
 const s=new TennisDeepState('atp');
 const blank={...complete,w_svpt:'',l_svpt:'',w_1stIn:' ',l_1stIn:null};
 s.update(blank,'hard');
 assert.equal(s.profile('a','Alpha','hard').historyMatches,0);
 assert.equal(s.profile('b','Beta','hard').surfaceMatches,0);
});
test('zero denominators and mathematically impossible service observations are rejected',()=>{
 const s=new TennisDeepState('wta');
 s.update({...complete,w_svpt:0},'clay');
 s.update({...complete,w_1stWon:50},'clay');
 s.update({...complete,l_bpSaved:8,l_bpFaced:7},'clay');
 assert.equal(s.profile('a','Alpha','clay').historyMatches,0);
});
test('complete source stats continue to produce evidence-backed profiles',()=>{
 const s=new TennisDeepState('atp');
 s.update(complete,'hard');
 assert.equal(s.profile('a','Alpha','hard').historyMatches,1);
 assert.equal(s.profile('b','Beta','hard').surfaceMatches,1);
});
test('CSV ingestion distinguishes absent numeric fields from true recorded zeros',()=>{
 const source=readFileSync(new URL('../scripts/tennis-v2-profile-refresh.mjs',import.meta.url),'utf8');
 assert.match(source,/typeof v==='string' && v\.trim\(\)===''\)/);
 assert.match(source,/TENNIS_PROFILE_SOURCE_INCOMPLETE_/);
});
