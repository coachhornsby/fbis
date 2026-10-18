import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPinnoddsR2BoardResearch,preferFreshPinnoddsArchive} from '../functions/lib/pinnoddsArchiveBoard.js';
const at=new Date(Date.now()-60_000).toISOString();
const start=new Date(Date.now()+2*3600_000).toISOString();
const offer=(side,odds)=>({source:'PinnOdds',sport:'cfb',eventId:'cfb-game',eventStart:start,marketFamily:'moneyline',side,decimalOdds:odds,period:'full_game',sourceMarketId:'market',sourceOutcomeId:side,sourceObservedAt:null});
const payload={schemaVersion:1,source:'PinnOdds',sportId:5,feed:'prematch',collectedAt:at,ingestionScope:'IMMUTABLE_FULL_BOARD_FETCH_FBISEXISTING_PROJECTIONS_GAME_MARKETS',readOnly:true,canAuthorizeWager:false,rows:[offer('home',1.8),offer('away',2.1)]};
const archive={async get(key){return key.endsWith('board-5-prematch.json')?{json:async()=>payload}:null;}};
test('R2 modeled PinnOdds capture feeds paired non-executable board odds',async()=>{
 const result=await loadPinnoddsR2BoardResearch(archive,{sport:'cfb',games:[{id:'cfb-game'}]});
 assert.equal(result.byGame['cfb-game'].offers.length,2);
 assert.equal(result.byGame['cfb-game'].status,'RESEARCH_REFERENCE_ONLY');
 assert.equal(result.byGame['cfb-game'].providerTimestampVerified,false);
 assert.equal(result.byGame['cfb-game'].canAuthorizeWager,false);
 assert.equal(preferFreshPinnoddsArchive({byGame:{},rows:0},result).byGame['cfb-game'].offers.length,2);
});
test('R2 reader does not show unprojected games, stale captures or kickoff-past quotes',async()=>{
 assert.equal((await loadPinnoddsR2BoardResearch(archive,{sport:'cfb',games:[{id:'other'}]})).rows,0);
 const old={...payload,collectedAt:new Date(Date.now()-30*3600_000).toISOString()};
 const stale={async get(){return {json:async()=>old};}};
 assert.equal((await loadPinnoddsR2BoardResearch(stale,{sport:'cfb',games:[{id:'cfb-game'}]})).rows,0);
});
test('R2 malformed or unauthorized receipts never become a priced market',async()=>{
 const malformed={async get(){return {json:async()=>({...payload,canAuthorizeWager:true})};}};
 assert.equal((await loadPinnoddsR2BoardResearch(malformed,{sport:'cfb',games:[{id:'cfb-game'}]})).rows,0);
});
test('a started game retains an explicitly historical pregame reference only when requested',async()=>{
 const now=Date.now(),kick=new Date(now-3600000).toISOString();
 const previous={...payload,collectedAt:new Date(now-7200000).toISOString(),rows:payload.rows.map(o=>({...o,eventStart:kick}))};
 const archive={async get(key){return key.endsWith('prematch.json')?{json:async()=>previous}:null}};
 assert.equal((await loadPinnoddsR2BoardResearch(archive,{sport:'cfb',games:[{id:'cfb-game'}]})).rows,0);
 const loaded=await loadPinnoddsR2BoardResearch(archive,{sport:'cfb',games:[{id:'cfb-game'}],includeStarted:true});
 assert.equal(loaded.byGame['cfb-game'].pregameReferenceOnly,true);
 assert.equal(loaded.byGame['cfb-game'].offers[0].historicalReference,true);
 assert.equal(loaded.byGame['cfb-game'].canAuthorizeWager,false);
});
