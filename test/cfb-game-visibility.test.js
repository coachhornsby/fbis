import test from 'node:test';
import assert from 'node:assert/strict';
import {isFbsVsFbsGame, fbsOnlySlate} from '../functions/lib/cfbGameVisibility.js';
const game = {id:'1',sport:'cfb',start:'2026-10-11T19:00:00Z',home:{espnId:'333'},away:{espnId:'61'},status:{}};
test('verified FBS sides appear; FCS, unknown and unsupported seasons are withheld',()=>{
 assert.equal(isFbsVsFbsGame(game),true);
 for(const away of [{espnId:'61',providerTeamId:null},{espnId:'999999'},{name:'Texas'},{espnId:'61',providerClassification:'FCS',classification:'FBS',classificationSource:'CFBD'}]) assert.equal(isFbsVsFbsGame({...game,away}),false);
 assert.equal(isFbsVsFbsGame({...game,start:'2025-10-11'}),false);
 assert.equal(isFbsVsFbsGame({...game,home:{providerClassification:'FBS',classificationSource:'CFBD'},away:{providerClassification:'FBS',classificationSource:'CFBD'}}),true);
 assert.equal(isFbsVsFbsGame({sport:'nhl'}),true);
});
test('slate counts and ticker exclude withheld CFB cards without mutating input',()=>{
 const hidden={...game,id:'2',away:{espnId:'999999'}};
 const original={sport:'cfb',games:[game,hidden],ticker:[{id:'1'},{id:'2'}]};
 const filtered=fbsOnlySlate(original);
 assert.equal(filtered.games.length,1);assert.equal(filtered.counts.games,1);assert.equal(filtered.ticker.length,1);assert.equal(original.games.length,2);
});
