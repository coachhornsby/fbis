import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAtpCompletedSingles} from '../functions/lib/tennisAtpOfficialResultContract.js';
const match={source:'ATP_OFFICIAL',matchId:'atp-123',player1Id:'p1',player2Id:'p2',
 winnerId:'p1',matchType:'SINGLES',status:'FINAL',startAt:'2026-10-22T10:00:00Z',
 surface:'hard',bestOf:3,sets:[[6,4],[7,5]]};
const options={sourceApproved:true,observedAt:new Date('2026-10-22T13:00:00Z')};
test('requires explicit ATP commercial/source approval and verified normal final',()=>{
 assert.equal(verifyAtpCompletedSingles(match,options).verified,true);
 assert.equal(verifyAtpCompletedSingles(match).reason,'ATP_SOURCE_AUTHORITY_NOT_APPROVED');
 assert.equal(verifyAtpCompletedSingles({...match,source:'ESPN'},options).verified,false);
 assert.equal(verifyAtpCompletedSingles({...match,winnerId:'p2'},options).verified,false);
 assert.equal(verifyAtpCompletedSingles({...match,sets:[[6,4],[6,6]]},options).verified,false);
 assert.equal(verifyAtpCompletedSingles({...match,retired:true},options).verified,false);
 assert.equal(verifyAtpCompletedSingles({...match,matchType:'DOUBLES'},options).verified,false);
 assert.equal(verifyAtpCompletedSingles({...match,startAt:'2026-10-23T10:00:00Z'},options).verified,false);
});
test('best-of-five ATP results verify only three completed winning sets',()=>{
 const grand={...match,bestOf:5,sets:[[6,4],[4,6],[6,3],[6,4]]};
 assert.equal(verifyAtpCompletedSingles(grand,options).verified,true);
 assert.equal(verifyAtpCompletedSingles({...grand,sets:[[6,4],[4,6],[6,3]]},options).verified,false);
});
