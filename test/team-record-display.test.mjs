import test from'node:test';import assert from'node:assert/strict';
import{teamRecordDisplay}from'../src/lib/teamRecordDisplay.js';import{scoreboardGames}from'../functions/lib/publicBoardSnapshot.js';
const at='2026-11-09T15:00:00Z',clock=Date.parse(at),record={recordType:'SU',verified:true,teamId:'1',source:'ESPN_SCOREBOARD',sourceScope:'overall',capturedAt:at,wins:3,losses:1};
test('only matching source-reported overall and explicit verified ATS records render',()=>{
 assert.deepEqual(teamRecordDisplay({espnId:'1',record:'3-1',ats:'4-0'},clock),[]);
 assert.equal(teamRecordDisplay({espnId:'1',verifiedRecords:{su:record}},clock)[0].text,'3-1');
 for(const change of [{teamId:'2'},{verified:false},{wins:-1},{sourceScope:'conference'},{capturedAt:'2026-11-10T00:00Z'}])assert.equal(teamRecordDisplay({espnId:'1',verifiedRecords:{su:{...record,...change}}},clock).length,0);
 const ats={...record,recordType:'ATS',source:'Verified test fixture',sourceScope:'against_the_spread',pushes:1};assert.equal(teamRecordDisplay({espnId:'1',verifiedRecords:{ats}},clock)[0].text,'3-1-1');assert.equal(teamRecordDisplay({espnId:'1',verifiedRecords:{ats:{...ats,pushes:undefined}}},clock).length,0);
});
test('scoreboard preserves one explicit total record without deriving ATS or accepting malformed summaries',()=>{
 const participant=(id,side,records)=>({homeAway:side,records,team:{id,displayName:'Team '+id},score:'0'});
 const payload=records=>({season:{year:2026},events:[{id:'123',date:'2026-11-10T00:00Z',competitions:[{id:'123',date:'2026-11-10T00:00Z',status:{type:{state:'pre'}},competitors:[participant('1','home',records),participant('2','away',[])]}]}]});
 const parse=r=>scoreboardGames(payload(r),{sport:'cbb',date:'2026-11-09',capturedAt:at})[0];
 const g=parse([{type:'total',summary:'3-1'},{type:'home',summary:'2-0'}]);assert.equal(g.home.verifiedRecords.su.wins,3);assert.equal(g.home.verifiedRecords.su.capturedAt,at);assert.equal(g.home.verifiedRecords.ats,undefined);assert.equal(g.away.verifiedRecords.su,null);
 for(const r of [[{type:'total',summary:'3-1 ATS'}],[{type:'conference',summary:'3-1'}],[{type:'total',summary:'3-1'},{type:'total',summary:'4-1'}],{}])assert.equal(parse(r).home.verifiedRecords.su,null);
});
