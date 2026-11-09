import test from 'node:test';import assert from 'node:assert/strict';
import {retainedCfbExchangeFixtures as parse} from '../functions/lib/cfbFutureExchangeFixtures.js';
import {CFB_FUTURE_EXCHANGE_PACKETS as packets} from '../functions/lib/cfbFutureExchangePackets.js';
import {matchedKalshiCardQuotes,readExchangeCardQuotes} from '../functions/lib/exchangeCardDelivery.js';
const date='2026-11-14',now=Date.parse('2026-11-09T06:00:00Z'),packet=packets[date];
test('retained official schedule keeps original clocks and only future identities',()=>{const p=parse(packet,{date,now});assert.equal(p.fixtures.length,56);assert.equal(p.state,'RETAINED_OFFICIAL_SCHEDULE');assert.equal(p.capturedAt,packet.generatedAt);assert.equal(p.expiresAt,packet.expiresAt);assert.equal(p.canAuthorizeWager,false);assert.equal(parse(packet,{date,now:Date.parse('2026-11-15T12:00Z')}).fixtures.length,0);});
test('malformed identity, duplicate, future source time, wrong scope and authority fail closed',()=>{
 for(const mutate of [p=>p.games.push(p.games[0]),p=>p.games[0].sport='cbb',p=>p.games[0].capturedAt='2026-11-09T06:00Z',p=>p.games[0].home.espnId=p.games[0].away.espnId,p=>p.games[0].start='invalid',p=>p.games[0].source='UNVERIFIED',p=>p.canAuthorizeWager=true,p=>p.generatedAt='2026-11-10T00:00Z',p=>p.expiresAt='2026-11-20T00:00Z']){const p=structuredClone(packet);mutate(p);assert.equal(parse(p,{date,now}).fixtures.length,0);}
 assert.equal(parse(packet,{date:'2026-11-13',now}).fixtures.length,0);
});
test('future official identity joins paired rules but never fabricates price or fresh time',()=>{
 const fixtures=parse(packet,{date,now}).fixtures,g=fixtures.find(g=>g.home_name==='Iowa State Cyclones');assert.ok(g);
 const at='2026-11-09T04:52:36.698Z',records=['Iowa State','Cincinnati'].map((name,i)=>({sport:'cfb',seriesTicker:'KXNCAAFGAME',eventTicker:'KXNCAAFGAME-26NOV14CINISU',ticker:'KXNCAAFGAME-26NOV14CINISU-'+i,status:'active',yesLabel:name,yesAskDollars:i?.4:.62,fetchedAt:at,rulesPrimary:`If ${name} wins the Cincinnati vs Iowa State college football game originally scheduled for Nov 14, 2026, then the market resolves to Yes.`}));
 const by=matchedKalshiCardQuotes(fixtures,{ok:true,sport:'cfb',seriesTicker:'KXNCAAFGAME',capturedAt:at,records},null,{sport:'cfb',now,retainLastObserved:true,retainedOfficialSchedule:true});assert.equal(by[g.id].length,2);assert.ok(by[g.id].every(q=>q.stale&&q.receivedAt===at&&q.canAuthorizeWager===false));
});
test('retained schedule cannot bypass missing admission or cause storage access',async()=>{let reads=0;await assert.rejects(()=>readExchangeCardQuotes({ARCHIVE:{get(){reads++;}}},{sport:'cfb',date,now,futureCfbPacket:packet}),/ACCOUNT_BUDGET/);assert.equal(reads,0);});

import {CERTIFIED_EXECUTION_JOBS} from '../services/account-budget/executionJobs.mjs';
import {exchangeCardRows} from '../src/lib/exchangeCardRows.js';
const manifest=()=>({version:1,source:'FBIS_COLLECTED_SLATE',sport:'cfb',capturedAt:new Date(now-7200000).toISOString(),expiresAt:new Date(now-3600000).toISOString(),providerTags:['cfb'],fixtures:[]});
function readerEnv(raw,age=60000){
 const fetchedAt=new Date(now-age).toISOString(),reads=[];
 const records=['Iowa State','Cincinnati'].map((name,i)=>({sport:'cfb',seriesTicker:'KXNCAAFGAME',eventTicker:'KXNCAAFGAME-26NOV14CINISU',ticker:'KXNCAAFGAME-26NOV14CINISU-'+i,status:'active',yesLabel:name,yesAskDollars:i?.4:.62,fetchedAt,rulesPrimary:`If ${name} wins the Cincinnati vs Iowa State college football game originally scheduled for Nov 14, 2026, then the market resolves to Yes.`}));
 return {reads,env:{CLOUDFLARE_ACCOUNT_ID:'test',FBIS_ACCOUNT_BUDGET:{getByName:()=>({reserve:async({job})=>({allowed:true,maxUnits:CERTIFIED_EXECUTION_JOBS[job].units,expiresAtMs:Date.now()+120000})})},ARCHIVE:{get:async key=>{reads.push(key);const value=key.includes('fixtures-v1')?raw:key==='kalshi/public-shadow/v1/sports/cfb.json'?{ok:true,sport:'cfb',seriesTicker:'KXNCAAFGAME',capturedAt:fetchedAt,records}:null;return value?{json:async()=>value}:null;}}}};
}
test('future or malformed manifest is never recovered by official schedule fallback',async()=>{
 for(const mutate of [m=>{m.capturedAt=new Date(now+60000).toISOString();m.expiresAt=new Date(now+3660000).toISOString();},m=>m.source='UNKNOWN',m=>m.capturedAt='bad',m=>m.fixtures=[{id:'broken'}]]){
  const raw=manifest();mutate(raw);const s=readerEnv(raw);
  await assert.rejects(readExchangeCardQuotes(s.env,{sport:'cfb',date,now,futureCfbPacket:packet}));assert.equal(s.reads.length,1);
 }
});
test('expired manifest fallback exposes retained schedule in every quote and tooltip independently of price age',async()=>{
 for(const age of [60000,960000]){
  const s=readerEnv(manifest(),age),result=await readExchangeCardQuotes(s.env,{sport:'cfb',date,now,futureCfbPacket:packet});
  assert.equal(s.reads.length,4);assert.ok(s.reads.every(k=>k.startsWith('market-sources/polymarket-us/')||k.startsWith('kalshi/public-shadow/v1/')));
  const g=parse(packet,{date,now}).fixtures.find(g=>g.home_name==='Iowa State Cyclones'),quotes=result.byEvent[g.id];assert.equal(quotes.length,2);
  for(const quote of quotes){assert.equal(quote.stale,age>900000);assert.equal(quote.fixtureEvidence.capturedAt,packet.generatedAt);assert.equal(quote.fixtureEvidence.state,'RETAINED_OFFICIAL_SCHEDULE');assert.equal(quote.sourceObservedAt,null);assert.equal(quote.receivedAt,new Date(now-age).toISOString());assert.equal(quote.canAuthorizeWager,false);}
  const cells=exchangeCardRows({start:g.start,exchangeReferenceQuotes:quotes},now).find(row=>row.venue==='Kalshi'&&row.family==='moneyline').cells;
  for(const cell of cells){assert.match(cell.title,/Matched using retained official schedule captured/);assert.ok(cell.title.includes(packet.generatedAt));assert.match(cell.title,/kickoff\/status not freshly verified/);assert.match(cell.title,/Provider quote time unknown/);assert.equal(cell.stale,age>900000);}
 }
});
test('explicit empty date coverage prevents old schedule resurrection',async()=>{
 const raw=manifest();raw.coverageSource='ESPN_SINGLE_DAY_V1';raw.dateCoverage={[date]:raw.capturedAt};
 const s=readerEnv(raw),result=await readExchangeCardQuotes(s.env,{sport:'cfb',date,now,futureCfbPacket:packet});assert.deepEqual(result.byEvent,{});assert.equal(result.fixtureEvidence,undefined);
});
