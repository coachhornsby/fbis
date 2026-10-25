import test from 'node:test';
import assert from 'node:assert/strict';
import {assessFbisCoverage} from '../scripts/lib/fbisCoveragePolicy.mjs';
const now=Date.parse('2026-10-24T20:00:00Z'),start='2026-10-25T00:00:00Z';
const game={id:'1',sport:'nba',start,model:{projTotal:225},market:{total:224.5,collectedAt:'2026-10-24T19:59:00Z'}};
const model={canonicalEventId:'1',canonicalPlayerId:'nba:espn:123',canonical_market:'points',period:'full_game',independent:true,fbis_projection:22};
const contract={...model,provider:'Kalshi',contractId:'KX-1',side:'yes',identityVerified:true,start_time:start,collectedAt:'2026-10-24T19:59:00Z',priceVerified:true,marketAvailable:true};
test('complete, current, independently projected fixtures pass',()=>{
 const result=assessFbisCoverage({board:{games:[game]},models:{nba:{ok:true,rows:[model]}},contracts:{nba:{ok:true,rows:[contract]}},now});
 assert.equal(result.ok,true);assert.equal(result.summary.props,1);
});
test('each missing model, game market and verified exchange quote is visible',()=>{
 const result=assessFbisCoverage({board:{games:[{...game,model:null,market:null}]},models:{nba:{ok:true,rows:[]}},contracts:{nba:{ok:true,rows:[{...contract,priceVerified:false,marketAvailable:false}]}},now});
 assert.deepEqual(new Set(result.incidents.map(x=>x.code)),new Set(['GAME_PROJECTION_MISSING','GAME_CURRENT_MARKET_UNVERIFIED','PROP_PROJECTION_MISSING','PROP_CURRENT_ODDS_UNVERIFIED']));
});
test('final and future-outside-horizon games are not mislabeled as current-market failures',()=>{
 const result=assessFbisCoverage({board:{games:[{...game,start:'2026-10-24T19:00:00Z'},{...game,start:'2026-10-28T00:00:00Z'}]},models:{},contracts:{},now});
 assert.equal(result.ok,true);assert.equal(result.summary.games,0);
});
test('no synthetic odds or fake projection injected by evaluation',()=>{
 const raw={board:{games:[{...game,model:null,market:null}]},models:{},contracts:{}};
 assessFbisCoverage({...raw,now});
 assert.equal(raw.board.games[0].market,null);
 assert.equal(raw.board.games[0].model,null);
});

test('stale or unclocked game-line references never count as current',()=>{
 const stale=assessFbisCoverage({board:{games:[{...game,market:{total:224.5,collectedAt:'2026-10-24T01:00:00Z'}}]},now});
 assert.equal(stale.summary.missingGameMarkets,1);
 const missing=assessFbisCoverage({board:{games:[{...game,market:{total:224.5}}]},now});
 assert.equal(missing.summary.missingGameMarkets,1);
});

test('paired fresh PinnOdds research receipts count as captured game reference, not made-up execution odds',()=>{
 const board={games:[{...game,market:null,pinnoddsResearch:{pairedMarkets:['spread','total'],
  latestCapturedAt:'2026-10-24T19:59:00Z',providerTimestampVerified:false,
  offers:[{marketFamily:'total',line:224.5,decimalOdds:1.9,capturedAt:'2026-10-24T19:59:00Z'}]}}]};
 const result=assessFbisCoverage({board,now});
 assert.equal(result.summary.missingGameMarkets,0);
 const stale=assessFbisCoverage({board:{games:[{...board.games[0],pinnoddsResearch:{
 ...board.games[0].pinnoddsResearch,latestCapturedAt:'2026-10-24T07:59:00Z',
 offers:[{marketFamily:'total',line:224.5,decimalOdds:1.9,capturedAt:'2026-10-24T07:59:00Z'}]}}]},now});
 assert.equal(stale.summary.missingGameMarkets,1);
});

test('independent model-only props remain visible as unpriced, not fabricated contracts',()=>{
 const projected={sport:'nba',canonicalEventId:'1',canonicalPlayerId:'nba:espn:123',
  canonical_market:'points',period:'full_game',start_time:start,independent:true,
  fbis_projection:22};
 const r=assessFbisCoverage({board:{games:[]},
  models:{nba:{ok:true,rows:[projected]}},contracts:{nba:{ok:true,rows:[]}},now});
 assert.equal(r.summary.modelPropsWithoutMarket,1);
 assert.equal(r.incidents[0].code,'PROP_MARKET_NOT_OFFERED');
 assert.equal(r.incidents[0].remedy,'NO_VERIFIED_SOURCE_CONTRACT; DO_NOT_INFER_PRICE');
});
