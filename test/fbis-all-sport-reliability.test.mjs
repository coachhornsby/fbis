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
