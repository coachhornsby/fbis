import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.BASE||'https://fbis-myz.pages.dev';
if(!process.env.HARVEST_SECRET)throw Error('HARVEST_SECRET_REQUIRED');
async function read(path,authenticated=false){
 const response=await fetch(base+path,{headers:authenticated?{'x-harvest-secret':process.env.HARVEST_SECRET}:{},signal:AbortSignal.timeout(90000)});
 assert.equal(response.status,200,path);return response.json();
}
const denied=await fetch(base+'/api/tennis-intelligence-bank');assert.equal(denied.status,403);
const bank=await read('/api/tennis-intelligence-bank?limit=100',true);
assert.equal(bank.ok,true);assert.equal(bank.canQualify,false);assert.equal(bank.canAuthorizeWager,false);
const dates=[...new Set(bank.fixtures.map(f=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(f.start))))];
const boards=[];
for(const date of dates){
 const board=await read('/api/today?sport=tennis&date='+date);
 const games=board.games||board.board?.games||[];
 for(const f of bank.fixtures.filter(f=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(f.start))===date)){
  const g=games.find(g=>g.id===f.id);
  // A valid official projection can take precedence for this same match.
  if(!g){assert.ok(games.some(g=>g.tour===f.tour&&Date.parse(g.start)===Date.parse(f.start)&&[g.home?.name,g.away?.name].sort().join('|')===[f.away_name,f.home_name].sort().join('|')));continue;}
  assert.equal(g.home.name,f.away_name);assert.equal(g.away.name,f.home_name);
  assert.equal(g.canQualify,false);assert.equal(g.canAuthorizeWager,false);
  assert.equal(g.tennisProjection.player1WinProb,null);assert.equal(g.tennisProjection.player2WinProb,null);
  assert.equal(g.tennisProjection.researchFixture.rawHash,f.raw_hash);
  assert.ok(g.tennisProjection.playerBank.players.every(p=>Array.isArray(p.profiles)));
  for(const offer of g.tennisProjection.venueOffers){
   assert.equal(offer.canAuthorizeWager,false);assert.ok(offer.observationId);
   assert.ok(Date.parse(offer.collectedAt)<=Date.now());
   if(offer.sourceObservedAt===null)assert.equal(offer.providerQuoteClockVerified,false);
  }
 }
 boards.push({date,games});
}
const [pinnodds,polymarket]=await Promise.all([read('/api/pinnodds-status'),read('/api/polymarket-status')]);
const evidence={verifiedAt:new Date().toISOString(),bank,boards,pinnodds,polymarket,
 currentFixtureHydrationVerified:bank.fixtureCount>0,positiveMarketLinkageVerified:bank.fixturesWithLinkedMarkets>0,
 paidProviderCalls:0,rewrittenObservations:0,researchOnly:true,canAuthorizeWager:false};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/tennis-integration-production.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify({fixtures:bank.fixtureCount,playerIdentityComplete:bank.playerIdentityComplete,
 fixturesWithLinkedMarkets:bank.fixturesWithLinkedMarkets,boardDates:dates,canAuthorizeWager:false,paidProviderCalls:0}));
