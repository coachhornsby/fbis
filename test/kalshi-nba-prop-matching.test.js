import test from 'node:test';
import assert from 'node:assert/strict';
import {mapKalshiPlayerContract} from '../functions/lib/propProviderAdapters.js';

const capturedAt='2026-10-20T15:00:24.703Z';
const games=[
 {sport:'nba',id:'401909088',date:'2026-10-20',start:'2026-10-20T19:00Z',
  home_abbr:'DET',away_abbr:'BOS',home_name:'Detroit Pistons',away_name:'Boston Celtics'},
 {sport:'nba',id:'401909089',date:'2026-10-20',start:'2026-10-20T23:00Z',
  home_abbr:'NY',away_abbr:'PHI',home_name:'New York Knicks',away_name:'Philadelphia 76ers'},
 {sport:'nba',id:'401909090',date:'2026-10-20',start:'2026-10-21T01:30Z',
  home_abbr:'SA',away_abbr:'OKC',home_name:'San Antonio Spurs',away_name:'Oklahoma City Thunder'},
];
const players=[
 {sport:'nba',player_id:'5104157',player_name:'Victor Wembanyama',team_key:'SAS'},
 {sport:'nba',player_id:'3934672',player_name:'Jalen Brunson',team_key:'NYK'},
 {sport:'nba',player_id:'w-1',player_name:'Jayson Tatum',team_key:'BOS'},
];
function market(series,name,threshold,description,fixture='Oklahoma City vs San Antonio',athlete='Victor Wembanyama'){
 return {ticker:`${series}-26OCT20-TEST`,event_ticker:'KXNBAEVENT-26OCT20',
  rules_primary:`If ${athlete} records ${threshold}+ ${description} in the ${fixture} Pro Basketball game originally scheduled for Oct 20, 2026, then the market resolves to Yes.`,
  strike_type:'greater',floor_strike:threshold-.5,custom_strike:{basketball_player:'kalshi-athlete-verified'},status:'active',yes_ask_dollars:'0.4200',yes_ask_size_fp:'14'};
}
test('five production NBA rule forms map without downgrading research-only quote authority',()=>{
 const cases=[
  ['KXNBAPTS',30,'points','points'],
  ['KXNBAREB',8,'rebounds','rebounds'],
  ['KXNBAAST',6,'assists','assists'],
  ['KXNBA3PT',5,'made three-pointers','three_pointers_made'],
  ['KXNBAPRA',45,'combined points, rebounds, and assists','points_rebounds_assists'],
 ];
 for(const [series,threshold,description,canonical]of cases){
  const p=mapKalshiPlayerContract(market(series,'Victor Wembanyama',threshold,description),
   {games,players,seriesTicker:series,capturedAt});
  assert.equal(p?.rejected,undefined,`${series} ${p?.reason}`);
  assert.equal(p.canonicalEventId,'401909090');
  assert.equal(p.canonicalPlayerId,'nba:espn:5104157');
  assert.equal(p.team,'SAS');assert.equal(p.opponent,'OKC');
  assert.equal(p.canonical_market,canonical);
  assert.equal(p.identityVerified,true);
  assert.equal(p.priceVerified,false);assert.equal(p.purchaseAsk,null);
  assert.equal(p.canQualify,false);assert.equal(p.canAuthorizeWager,false);
 }
});
test('NY fixture alias independently reconciles to NYK canonical roster',()=>{
 const m=market('KXNBAPTS','Jalen Brunson',25,'points','Philadelphia vs New York','Jalen Brunson');
 const p=mapKalshiPlayerContract(m,{games,players,seriesTicker:'KXNBAPTS',capturedAt});
 assert.equal(p.rejected,undefined);
 assert.equal(p.canonicalEventId,'401909089');assert.equal(p.team,'NYK');assert.equal(p.opponent,'PHI');
});
test('verified registry handles non-mismatched BOS/DET names',()=>{
 const m=market('KXNBAPTS','Jayson Tatum',20,'points','Boston vs Detroit','Jayson Tatum');
 const p=mapKalshiPlayerContract(m,{games,players,seriesTicker:'KXNBAPTS',capturedAt});
 assert.equal(p.rejected,undefined);assert.equal(p.canonicalEventId,'401909088');
});
test('fail closed on unidentified player, contradictory fixture identity, wrong date and unapproved rule wording',()=>{
 const base=market('KXNBA3PT','Victor Wembanyama',5,'made three-pointers');
 const ctx={games,players,seriesTicker:'KXNBA3PT',capturedAt};
 assert.equal(mapKalshiPlayerContract({...base,custom_strike:{}},ctx).reason,'PLAYER_ROSTER_IDENTITY_UNRESOLVED');
 assert.equal(mapKalshiPlayerContract({...base,rules_primary:base.rules_primary.replace('made three-pointers','three-point fantasy points')},ctx).reason,'STAT_DEFINITION_MISMATCH');
 assert.equal(mapKalshiPlayerContract({...base,rules_primary:base.rules_primary.replace('Oct 20, 2026','Oct 21, 2026')},ctx).reason,'EXACT_EVENT_UNRESOLVED');
 assert.equal(mapKalshiPlayerContract(base,{...ctx,games:[{...games[2],home_abbr:'LAL'}]}).reason,'EXACT_EVENT_UNRESOLVED');
 assert.equal(mapKalshiPlayerContract(base,{...ctx,players:[...players,players[0]]}).rejected,undefined);
 assert.equal(mapKalshiPlayerContract(base,{...ctx,players:[...players,{...players[0],player_id:'duplicate'}]}).reason,'PLAYER_ROSTER_IDENTITY_UNRESOLVED');
});
