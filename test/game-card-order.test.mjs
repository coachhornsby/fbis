import test from 'node:test';
import assert from 'node:assert/strict';
import {sortGameCards,wagerGameKey,hasLinkedWager,readWagerMarks} from '../src/lib/gameCardOrder.js';
const game=(id,status,start='2026-11-07T01:00:00Z',sport='nba')=>({id,sport,status,start});
test('wagers first, then live, upcoming, unavailable statuses, completed; input untouched',()=>{
 const games=[game('done','final','2026-11-07T00:00Z'),game('next','scheduled','2026-11-07T03:00Z'),game('wager','scheduled','2026-11-07T04:00Z'),game('live','live'),game('unknown','unverified')];
 const original=[...games],marked=new Set([wagerGameKey(games[2])]);
 assert.deepEqual(sortGameCards(games,{marked}).map(g=>g.id),['wager','live','next','unknown','done']);assert.deepEqual(games,original);
});
test('live wagers before future and completed wagers; chronological within a group',()=>{
 const a=game('a','scheduled','2026-11-07T03:00Z'),b=game('b','scheduled','2026-11-07T02:00Z'),c=game('c','live'),d=game('d','final');
 assert.deepEqual(sortGameCards([a,b,c,d],{marked:new Set([a,b,c,d].map(wagerGameKey))}).map(g=>g.id),['c','b','a','d']);
});
test('executed links are recognized; strategies, wrong sport/event and model picks are not wagers',()=>{
 const g=game('1','scheduled');const bet={gameId:'1',sport:'nba',result:'OPEN'};
 assert.ok(hasLinkedWager({...g,myBets:[bet]}));
 for(const patch of [{gameId:'2'},{sport:'nhl'},{isSimulation:true},{mode:'paper'},{population:'strategy'}])assert.equal(hasLinkedWager({...g,myBets:[{...bet,...patch}]}),false);
 assert.equal(hasLinkedWager({...g,rec:{pick:'home'},lean:{},canAuthorizeWager:true}),false);
});
test('marks are date/sport/event scoped and safely survive reload without exposing account data',()=>{
 const g=game('1','live'),key=wagerGameKey(g);assert.notEqual(key,wagerGameKey({...g,sport:'nhl'}));assert.notEqual(key,wagerGameKey({...g,start:'2026-11-08T01:00Z'}));
 const storage={getItem:()=>JSON.stringify([key,'bad',null])};assert.deepEqual([...readWagerMarks(storage)],[key]);
 assert.equal(readWagerMarks({getItem:()=>{throw Error('blocked')}}).size,0);
 assert.equal(readWagerMarks({getItem:()=>'{malformed'}).size,0);
});
