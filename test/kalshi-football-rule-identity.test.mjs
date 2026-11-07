import test from 'node:test';import assert from 'node:assert/strict';
import {footballRuleIdentity as match} from '../functions/lib/kalshiFootballRuleIdentity.js';
import {matchedKalshiCardQuotes} from '../functions/lib/exchangeCardDelivery.js';
const now=Date.parse('2026-11-07T12:00:00Z'),sport='cfb';
const g={id:'401856740',sport,home_name:'LSU Tigers',away_name:'Alabama Crimson Tide',start:'2026-11-08T00:00:00Z'};
const row=(name,suffix)=>({sport,seriesTicker:'KXNCAAFGAME',eventTicker:'KXNCAAFGAME-26NOV07ALALSU',ticker:'KXNCAAFGAME-26NOV07ALALSU-'+suffix,status:'active',yesLabel:name,yesAskDollars:.5,fetchedAt:new Date(now).toISOString(),rulesPrimary:`If ${name} wins the Alabama vs LSU college football game originally scheduled for Nov 7, 2026, then the market resolves to Yes.`});
const records=[row('Alabama','ALA'),row('LSU','LSU')];
const check=(r=records,f=[g])=>match(r[0],f,r,{sport,now});
test('exact canonical paired game maps research side without provider kickoff or authority',()=>{const v=check();assert.equal(v.fixture.id,g.id);assert.equal(v.side,'away');assert.equal(v.canAuthorizeWager,false);assert.equal(v.providerKickoffVerified,false);});
test('missing, duplicate, mismatched, stale and future counterparts fail closed',()=>{for(const r of [records.slice(0,1),[...records,records[1]],[records[0],{...records[1],ticker:records[0].ticker}],[records[0],{...records[1],fetchedAt:new Date(now-900001).toISOString()}],[records[0],{...records[1],fetchedAt:new Date(now+1).toISOString()}],[records[0],{...records[1],rulesPrimary:records[1].rulesPrimary.replace('Nov 7','Nov 8')}],[records[0],{...records[1],sport:'nfl'}]])assert.equal(check(r),null);});
test('duplicate fixture, wrong date, mascots, invalid time and wrong sport fail closed',()=>{for(const f of [[g,{...g,id:'duplicate'}],[{...g,start:'2026-11-09T00:00:00Z'}],[{...g,home_name:'Tigers'}],[{...g,start:'bad'}],[{...g,sport:'nfl'}]])assert.equal(check(records,f),null);});
test('card delivery uses existing evidence only and retains no-wager reference output',()=>{const v=matchedKalshiCardQuotes([g],{ok:true,sport,seriesTicker:'KXNCAAFGAME',capturedAt:new Date(now).toISOString(),records},null,{sport,now});assert.equal(v[g.id].length,2);assert.ok(v[g.id].every(q=>q.canAuthorizeWager===false&&q.transport==='REST'));});
test('NFL full canonical names require matching pro football paired rules',()=>{
 const fixture={id:'nfl1',sport:'nfl',home_name:'Dallas Cowboys',away_name:'New York Giants',start:'2026-11-07T19:00:00Z'};
 const make=(name,suffix)=>({sport:'nfl',seriesTicker:'KXNFLGAME',eventTicker:'KXNFLGAME-26NOV07NYGDAL',ticker:'KXNFLGAME-26NOV07NYGDAL-'+suffix,status:'active',yesLabel:name,fetchedAt:new Date(now).toISOString(),rulesPrimary:`If ${name} wins the New York Giants vs Dallas Cowboys Pro Football game originally scheduled for Nov 7, 2026, then the market resolves to Yes.`});
 const pair=[make('Dallas Cowboys','DAL'),make('New York Giants','NYG')];
 assert.equal(match(pair[0],[fixture],pair,{sport:'nfl',now}).side,'home');
 assert.equal(match({...pair[0],yesLabel:'Cowboys'},[fixture],pair,{sport:'nfl',now}),null);
});

test('contradictory or malformed occurrence evidence is rejected, never replaced by expiration',()=>{
 for(const occurrenceAt of ['2026-11-09T00:00:00Z','bad'])assert.equal(check(records.map(r=>({...r,occurrenceAt}))),null);
 assert.ok(check(records.map(r=>({...r,occurrenceAt:g.start}))));
 assert.ok(check(records.map(r=>({...r,expectedExpirationAt:'2026-11-09T00:00:00Z'}))));
});
