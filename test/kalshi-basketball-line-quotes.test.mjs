import test from 'node:test';
import assert from 'node:assert/strict';
import {kalshiBasketballLineRule,matchedKalshiBasketballLineQuotes}
 from '../functions/lib/kalshiBasketballLineQuotes.js';
import {KALSHI_SHADOW_SERIES} from '../functions/lib/kalshiMarketShadow.js';
const now=Date.parse('2026-11-06T18:00:00Z');
const start='2026-11-07T01:00:00Z';
const fixture={id:'wsh-atl',start,home_name:'Atlanta Hawks',away_name:'Washington Wizards',home_abbr:'ATL',away_abbr:'WSH'};
const series={spread:'nba_spread',total:'nba_total',team:'nba_team_total'};
const rules={
 spread:'If Atlanta wins by more than 2.5 points in the Washington vs Atlanta Pro Basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes.',
 total:'If over 228.5 total points are scored in the Washington vs Atlanta Pro Basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes.',
 team:'If Washington scores more than 114.5 points in the Washington vs Atlanta Pro Basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes.',
};
const market=(key,overrides={})=>{
 const sport=series[key],tick=KALSHI_SHADOW_SERIES[sport],eventTicker=tick+'-26NOV06WSHATL';
 return {sport,seriesTicker:tick,eventTicker,ticker:eventTicker+'-CONTRACT',
  status:'active',rulesPrimary:rules[key],
  yesAskDollars:.52,noAskDollars:.49,
  fetchedAt:new Date(now-1000).toISOString(),...overrides};
};
const snapshot=(key,records=[market(key)])=>({ok:true,sport:series[key],
 seriesTicker:KALSHI_SHADOW_SERIES[series[key]],records,capturedAt:new Date(now).toISOString()});
test('NBA/CBB signed source series include game lines and team totals',()=>{
 for(const k of ['nba_spread','nba_total','nba_team_total','cbb_spread','cbb_total','cbb_team_total'])
  assert.equal(typeof KALSHI_SHADOW_SERIES[k],'string');
});
test('venue settlement rules attach the correct full-game sides and half-point thresholds',()=>{
 const spread=matchedKalshiBasketballLineQuotes([fixture],snapshot('spread'),{sourceSport:'nba_spread',now})[fixture.id];
 assert.deepEqual(spread.map(q=>[q.marketFamily,q.side,q.line,q.ask]),[
  ['spread','home',-2.5,.52],['spread','away',2.5,.49]]);
 const total=matchedKalshiBasketballLineQuotes([fixture],snapshot('total'),{sourceSport:'nba_total',now})[fixture.id];
 assert.deepEqual(total.map(q=>[q.side,q.line,q.ask]),[['over',228.5,.52],['under',228.5,.49]]);
 const team=matchedKalshiBasketballLineQuotes([fixture],snapshot('team'),{sourceSport:'nba_team_total',now})[fixture.id];
 assert.deepEqual(team.map(q=>[q.side,q.line,q.ask]),[['away_over',114.5,.52],['away_under',114.5,.49]]);
 assert.ok([...spread,...total,...team].every(q=>q.canAuthorizeWager===false&&q.referenceOnly===true));
});
test('bad event identity/date/clock/series/strike cannot become a card price',()=>{
 const options={sourceSport:'nba_spread',now};
 for(const m of [
  market('spread',{rulesPrimary:rules.spread.replace('Nov 6','Nov 7')}),
  market('spread',{rulesPrimary:rules.spread.replace('2.5','2')}),
  market('spread',{rulesPrimary:'Atlanta wins by 2.5'}),
  market('spread',{fetchedAt:new Date(now-901000).toISOString()}),
  market('spread',{seriesTicker:'KXNBAGAME'}),
  market('spread',{status:'closed'})
 ]){
  assert.deepEqual(matchedKalshiBasketballLineQuotes([fixture],snapshot('spread',[m]),options),{});
 }
 assert.deepEqual(matchedKalshiBasketballLineQuotes([fixture,{...fixture,id:'duplicate'}],snapshot('spread'),options),{});
 assert.deepEqual(matchedKalshiBasketballLineQuotes([{...fixture,away_abbr:'BOS'}],snapshot('spread'),options),{});
});
test('college identity requires resolvable two-team school names and correct date',()=>{
 const sourceSport='cbb_total',ticker='KXNCAAMBTOTAL',g={
  id:'cbb-1',start:'2026-11-07T03:30:00Z',
  home_name:'UCLA Bruins',away_name:'North Florida Ospreys'
 };
 const m={...market('total'),sport:sourceSport,seriesTicker:ticker,
  eventTicker:ticker+'-26NOV06UNFUCLA',ticker:ticker+'-26NOV06UNFUCLA-POINTS',
  rulesPrimary:"If over 151.5 total points are scored in the North Florida vs UCLA men's college basketball game originally scheduled for Nov 6, 2026, then the market resolves to Yes."};
 const s={ok:true,sport:sourceSport,seriesTicker:ticker,records:[m],capturedAt:new Date(now).toISOString()};
 const out=matchedKalshiBasketballLineQuotes([g],s,{sourceSport,now});
 assert.deepEqual(out['cbb-1'].map(q=>[q.side,q.line]),[['over',151.5],['under',151.5]]);
 assert.equal(kalshiBasketballLineRule({...m,rulesPrimary:m.rulesPrimary.replace('UCLA','Unknown Team')},sourceSport),null);
});
