import test from 'node:test';
import assert from 'node:assert/strict';
import {binaryKalshiRows,exchangeContractEconomics,exchangeSeriesMarket,polymarketPropRow} from '../functions/lib/exchangePlayerProps.js';
import {selectivePropRating} from '../functions/lib/selectivePropEdge.js';
import {polymarketUsMarketFamily} from '../functions/lib/polymarketUs.js';
const game={id:'canonical',sport:'nfl',start:'2026-10-23T00:15:00Z',home:{abbr:'CHI'},away:{abbr:'NE'}};
const player={playerName:'Drake Maye',market:'passing_yards',fbisProjection:280,fbisSigma:60,roleConfidence:1,featureEvidence:{targetRole:true,recent5:true,positionDefense:true,snapShare:true,nextGen:true,opponentMatchup:true},targetRole:'QB1'};
const series={ticker:'KXNFLPASSYDS',title:'Pro Football Passing Yards',fee_type:'quadratic',fee_multiplier:1};
const market={ticker:'contract',event_ticker:'KXNFLPASSYDS-26OCT22NECHI',market_type:'binary',status:'active',strike_type:'greater',floor_strike:249.5,title:'Drake Maye: 250+ passing yards',yes_sub_title:'Drake Maye: 250+',yes_ask_dollars:'0.52',yes_ask_size_fp:'20'};
test('Kalshi binary props use the actual strike, current ask, depth and series fee',()=>{
 const now=new Date().toISOString();const rows=binaryKalshiRows(market,series,[player],game,'2026-10-22',now);assert.equal(rows.length,1);const row=rows[0];assert.equal(row.line,249.5);assert.equal(row.venue,'Kalshi');assert.equal(row.contractSide,'YES');assert.equal(row.contractEconomics.priceReady,true);assert.equal(row.contractEconomics.feePerContract,0.02);assert.equal(row.contractEconomics.profitQualified,false);assert.equal(row.canAuthorizeWager,false);assert.ok(!row.ratingExplanation.limits.some(l=>/payout|historical_segment/.test(l.code)));
});
test('Kalshi taker-fee math also covers maker-fee-enabled quadratic series',()=>{
 const rows=binaryKalshiRows(market,{...series,fee_type:'quadratic_with_maker_fees'},[player],game,'2026-10-22',new Date().toISOString());
 assert.equal(rows.length,1);
 assert.equal(rows[0].contractEconomics.feePerContract,0.02);
});
test('scalar, protected, team, season, wrong-player and wrong-event contracts cannot inherit binary pricing',()=>{
 for(const changed of [{custom_strike:{scalar_payout_type:'capped_centicent'}},{title:'Drake Maye receiving yards ladder'},{event_ticker:'KXNFLPASSYDS-26OCT25NECHI'},{title:'Other Player: 250+',yes_sub_title:'Other Player'},{strike_type:'custom'}])assert.equal(binaryKalshiRows({...market,...changed},series,[player],game,'2026-10-22',new Date().toISOString()).length,0);
 assert.equal(exchangeSeriesMarket({...series,ticker:'KXNFLSEASONPASSYDS'},'nfl'),null);
});
test('exchange pricing fails closed on missing fee, stale quote or missing depth',()=>{
 const x={ask:.5,feePerContract:.02,probability:.65,depth:10,observedAt:new Date().toISOString(),calibrationValidated:true};assert.equal(exchangeContractEconomics(x).profitQualified,true);
 for(const changed of [{feePerContract:null},{depth:null},{observedAt:'2000-01-01'},{ask:null},{calibrationValidated:false}])assert.equal(exchangeContractEconomics({...x,...changed}).profitQualified,false);
 assert.equal(exchangeContractEconomics({...x,feePerContract:null}).breakEvenProbability,null);
});
test('Kalshi and Polymarket props ignore PrizePicks tier caps while preserving model restrictions',()=>{
 for(const venue of ['Kalshi','Polymarket US']){const x=selectivePropRating({...player,sport:'nfl',executionVenue:venue,odds_tier:'goblin',line:100});assert.equal(x.stars,3);assert.ok(!x.limits.some(l=>/PAYOUT|historical_segment/.test(l.code)));assert.equal(selectivePropRating({...player,sport:'nfl',executionVenue:venue,line:100,propGate:'HOLD'}).stars,1);}
});
test('Polymarket player totals classify as player props, and display prices never become asks',()=>{
 assert.equal(polymarketUsMarketFamily({sportsMarketTypeV2:'PLAYER_TOTAL_YARDS'}),'player_prop');
 const row=polymarketPropRow({source_market_id:'poly-contract',canonical_event_id:'canonical',period:'full_game',player_name:'Drake Maye',stat_family:'passing_yards',side:'over',line:249.5,contract_price:.5,raw_payload_json:'{}'},[{...game,playerProjectionRows:[player]}]);assert.equal(row.venue,'Polymarket US');assert.equal(row.contractEconomics.ask,null);assert.equal(row.contractEconomics.priceReady,false);assert.equal(polymarketPropRow({canonical_event_id:'canonical',period:'first_half'},[game]),null);
});
