import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCompletedForm} from '../functions/lib/cfbDeepFeed.js';
const now=Date.parse('2026-11-08T18:00:00Z');
const game={homeTeam:'Ohio State',awayTeam:'Michigan',homePoints:21,awayPoints:14,startDate:'2026-11-07T18:00:00Z'};
test('only verified completed games enter scoring form',()=>{
 for(const patch of [{status:'in_progress'},{completed:false},{status:'scheduled'},{}])
  assert.equal(buildCompletedForm([{...game,...patch}],now).size,0);
 for(const patch of [{status:'final'},{completed:true},{isCompleted:true}])
  assert.equal(buildCompletedForm([{...game,...patch}],now).size,2);
});
test('invalid, missing, future kickoff cannot enter completed form',()=>{
 for(const startDate of [null,'not-a-date','2026-11-09T18:00:00Z'])
  assert.equal(buildCompletedForm([{...game,completed:true,startDate}],now).size,0);
});
test('contradictory completion, impossible dates and exact cutoff fail closed',()=>{
 for(const patch of [{status:'final',completed:false},{completed:true,isCompleted:false},{completed:true,startDate:'2026-02-30T18:00:00Z'},{completed:true,startDate:'2026-11-08T18:00:00Z'}])
  assert.equal(buildCompletedForm([{...game,...patch}],now).size,0);
 assert.equal(buildCompletedForm([{...game,completed:true}],NaN).size,0);
});
