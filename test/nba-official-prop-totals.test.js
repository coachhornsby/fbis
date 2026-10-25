import test from 'node:test';
import assert from 'node:assert/strict';
import {extractNbaOfficialBoxscore,nbaActualForMarket} from '../functions/lib/nbaOfficialPropTotals.js';
const eventId='401909858',homeId='6',awayId='24';
const finished={header:{competitions:[{id:eventId,status:{type:{name:'STATUS_FINAL',completed:true}},
 competitors:[{team:{id:homeId}},{team:{id:awayId}}]}]},
 boxscore:{players:[{team:{id:homeId},statistics:[{labels:['MIN','FG','3PT','FT','REB','AST','PTS'],
 athletes:[{athlete:{id:'5061568'},stats:['22','4-9','2-5','2-3','5','3','12']}]}]}]}};
test('exact final NBA event and team/athlete IDs produce official P/R/A/3PM',()=>{
 const r=extractNbaOfficialBoxscore(finished,{eventId,homeId,awayId});
 assert.equal(r.ok,true);assert.equal(r.rows.length,1);
 assert.equal(nbaActualForMarket(r.rows[0],'points'),12);
 assert.equal(nbaActualForMarket(r.rows[0],'points_rebounds_assists'),20);
 assert.equal(nbaActualForMarket(r.rows[0],'three_pointers_made'),2);
});
test('NBA fixture abbreviations verify final when team IDs are not populated',()=>{
 const d={...finished,header:{competitions:[{...finished.header.competitions[0],competitors:[{team:{id:homeId,abbreviation:'DAL'}},{team:{id:awayId,abbreviation:'SA'}}]}]}};
 const out=extractNbaOfficialBoxscore(d,{eventId,homeAbbr:'DAL',awayAbbr:'SA'});
 assert.equal(out.ok,true);assert.equal(out.rows.length,1);
 assert.equal(extractNbaOfficialBoxscore(d,{eventId,homeAbbr:'DAL',awayAbbr:'BOS'}).ok,false);
});
test('never use live or wrong game or wrong team stats as actual',()=>{
 const query={eventId,homeId,awayId};
 assert.equal(extractNbaOfficialBoxscore({...finished,header:{competitions:[{...finished.header.competitions[0],status:{type:{name:'STATUS_IN_PROGRESS',completed:false}}}]}},query).ok,false);
 assert.equal(extractNbaOfficialBoxscore(finished,{...query,eventId:'123'}).ok,false);
 assert.equal(extractNbaOfficialBoxscore(finished,{...query,awayId:'27'}).ok,false);
});
test('missing numeric stat and ambiguous duplicate athlete never yield fabricated actual',()=>{
 const r=extractNbaOfficialBoxscore(finished,{eventId,homeId,awayId});
 assert.equal(nbaActualForMarket({...r.rows[0],rebounds:null},'points_rebounds'),null);
 const duplicate={...finished,boxscore:{players:[finished.boxscore.players[0],finished.boxscore.players[0]]}};
 assert.equal(extractNbaOfficialBoxscore(duplicate,{eventId,homeId,awayId}).rows.length,0);
});
