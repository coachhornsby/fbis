import test from 'node:test';
import assert from 'node:assert/strict';
import {toBoardGame} from '../functions/lib/todayBoard.js';
const game={id:'tennis-test',sport:'tennis',start:'2026-10-25T20:00:00Z',
 status:'scheduled',home:{name:'Test Player A'},away:{name:'Test Player B'},
 projectionKind:'FBIS',pureProjectionAvailable:true,
 tennisProjection:{eventIntegrity:{valid:true},player1WinProb:.58,player2WinProb:.42}};
test('verified PURE tennis probabilities are delivered as model-available without team scores',()=>{
 const board=toBoardGame(game,'tennis',Date.parse('2026-10-25T18:00:00Z'));
 assert.equal(board.projectionUnavailable,false);
 assert.equal(board.projHome,null);
 assert.equal(board.projAway,null);
});
test('exchange-only listing cannot inherit projection availability',()=>{
 const input={...game,pureProjectionAvailable:false,
  tennisProjection:{...game.tennisProjection,eventIntegrity:{valid:false}}};
 const board=toBoardGame(input,'tennis',Date.parse('2026-10-25T18:00:00Z'));
 assert.equal(board.projectionUnavailable,true);
});
