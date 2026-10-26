import test from 'node:test';
import assert from 'node:assert/strict';
import {certifyTimeline} from '../scripts/cfb-phase5-ncaa-timeline.mjs';
const sample={data:{playbyplay:{periods:[1,2,3,4].map(n=>({periodNumber:n,playbyplayStats:[{plays:[{homeScore:n===4?31:7,visitorScore:n===4?17:0}]}]}))}}};
const final={independent_ncaa_verified:true,ncaa_home:31,ncaa_away:17};
test('official four quarters, unique periods and terminal score qualify timeline',()=>{
 const x=certifyTimeline(sample,final,'1');assert.equal(x.officialTimelineConsistent,true);assert.equal(x.allPossessionBoundariesIndependentlyCertified,false);
});
test('official source cannot certify a missing quarter',()=>{
 const x=certifyTimeline({data:{playbyplay:{periods:sample.data.playbyplay.periods.slice(1)}}},final,'1');
 assert.ok(x.issues.includes('REGULATION_PERIOD_MISSING'));
});
test('terminal score mismatch fails instead of silently trusting ESPN',()=>{
 const x=certifyTimeline(sample,{...final,ncaa_home:35},'1');assert.ok(x.issues.includes('OFFICIAL_PBP_TERMINAL_SCORE_MISMATCH'));
});
