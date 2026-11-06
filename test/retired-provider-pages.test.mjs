import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../deploy/board/functions/_middleware.js';

test('retired Pages endpoints reject every method before bindings or fallback',async()=>{
  for(const method of ['GET','POST','PUT','DELETE'])for(const path of [
    '/api/apify-acquire','/api/apify-account-refresh','/api/action-daily-async',
    '/api/action-apify-collect','/api/parlay/collect','/api/theodds/collect','/api/the-odds-api/collect']){
    const r=await onRequest({request:new Request('https://example.com'+path,{method}),
      next(){throw Error('must not reach application');},get env(){throw Error('must not reach bindings');}});
    assert.equal(r.status,410);
    assert.equal((await r.json()).error,'PROVIDER_RETIRED_BY_OWNER');
  }
});
test('board, approved providers and private gates retain their existing handlers',async()=>{
  for(const path of ['/','/api/public/sports/nba/2026-11-06','/api/private/cbb/2026-11-06',
    '/api/kalshi-account','/api/polymarket-account','/api/pinnodds-markets']){
    const expected=new Response('existing handler');
    assert.equal(await onRequest({request:new Request('https://example.com'+path),next:()=>expected}),expected);
  }
});
