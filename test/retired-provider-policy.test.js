import test from 'node:test';
import assert from 'node:assert/strict';
import { guardProviderFetch, isRetiredProviderSecret } from '../functions/lib/retiredProviderPolicy.js';
import { resolveOddsProviders, providerConfigured } from '../functions/lib/oddsProviderRouter.js';
import { startPaidAcquisition } from '../functions/lib/externalAcquisition.js';
import { readCandidateConfig } from '../functions/lib/actionApifyCandidateConfig.js';
import { allowNewMarketObservation } from '../functions/lib/activeOddsPolicy.js';
import { syncPagesSecretsSkipEmpty } from '../scripts/lib/pagesSecretSync.js';

test('retired transports cannot send credentials or requests; approved hosts still work', async () => {
  const seen=[];
  const guarded=guardProviderFetch(async (url, init) => {seen.push([url,init]); return 'allowed';});
  for (const url of ['https://api.apify.com/v2/acts/x/runs','https://parlay-api.com/v1/sports/nfl/odds',
    'https://api.the-odds-api.com/v4/sports/nfl/odds','https://APIFY.com/v2/users/me']) {
    assert.throws(()=>guarded(url,{headers:{authorization:'test-only'}}),/PROVIDER_RETIRED_BY_OWNER/);
  }
  assert.equal(seen.length,0);
  for (const host of ['api.pinnodds.com','api.elections.kalshi.com','api.polymarket.us','gamma-api.polymarket.com',
    'site.api.espn.com','api.collegefootballdata.com','api.collegebasketballdata.com','kenpom.com','barttorvik.com']) {
    assert.equal(await guarded('https://'+host+'/'), 'allowed');
  }
  assert.equal(seen.length,9);
});

test('old flags cannot launch Apify or access persistence',async()=>{
  const env=new Proxy({},{get(){throw Error('must not touch env');}});
  const r=await startPaidAcquisition(env,{source:'action',fetchImpl(){throw Error('network');}});
  assert.equal(r.status,410);
  assert.equal((await r.json()).canAuthorizeWager,false);
  const cfg=readCandidateConfig({ACTION_APIFY_ENABLED:'true',APIFY_TOKEN:'test-only'});
  assert.equal(cfg.enabled,false);
});

test('explicit legacy fallback order cannot bypass owner policy',async()=>{
  let calls=0;
  const r=await resolveOddsProviders({order:['parlay','theodds','apify'],
    configured:{parlay:true,theodds:true,apify:true},fetchers:{
      parlay:()=>calls++,theodds:()=>calls++,apify:()=>calls++}});
  assert.equal(calls,0);assert.equal(r.failClosed,true);
  assert.equal(providerConfigured({parlayApiKey:'x',theOddsApiKey:'x'}).parlay,false);
});

test('approved exchanges are allowed observations without changing wager authority',()=>{
  for(const source of ['PinnOdds','Kalshi','Kalshi REST','Kalshi WebSocket','Polymarket','Polymarket REST',
    'Polymarket WebSocket','Polymarket US','Polymarket US WebSocket']) assert.equal(allowNewMarketObservation({source}),true);
  for(const source of ['Apify','Parlay','TheOdds']) assert.equal(allowNewMarketObservation({source}),false);
});

test('retired credentials are never republished by secret sync',async()=>{
  const names=['APIFY_TOKEN','ACTION_APIFY_ENABLED','PARLAY_API_KEY','THEODDS_API_KEY'];
  for(const name of names) assert.equal(isRetiredProviderSecret(name),true);
  const written=[];
  const report=await syncPagesSecretsSkipEmpty(Object.fromEntries([...names,'CFBD_API_KEY'].map(n=>[n,'test-only'])),n=>written.push(n));
  assert.deepEqual(written,['CFBD_API_KEY']);assert.equal(report.skipped.length,4);
});
