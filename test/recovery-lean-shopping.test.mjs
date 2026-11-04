import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryLeanShopping} from '../src/lib/recoveryLeanShopping.js';

const now=Date.parse('2026-11-04T15:34:00Z');
const date='2026-11-04',start='2026-11-04T23:00:00Z';
const captured='2026-11-04T15:32:00Z';
function game(sport='cbb',margin=7,total=147){
 return {id:'401999123',sport,date,start,status:'scheduled',home:{espnId:'3',name:'Home Team',abbr:'HOME'},
 away:{espnId:'2',name:'Away Team',abbr:'AWAY'},projectionUnavailable:false,projectionMaturity:'RESEARCH',
 recoveryVerifiedProjection:{awayScore:70,homeScore:70+margin,margin,total,modelId:'FBIS-RESEARCH',expiresAt:'2026-11-04T20:00:00Z'},
 recoveryVerifiedOffers:[]};
}
function q(g,book,family,side,line,odds,extras={}){
 return {sport:g.sport,date:g.date,eventId:g.id,marketFamily:family,period:'full_game',side,line,americanOdds:odds,
 source:book,marketState:'open',sourceObservedAt:captured,...extras};
}
test('CBB side: best American price only at the same model-lean spread',()=>{
 const g=game();
 g.recoveryVerifiedOffers=[
  q(g,'Heritage','spread','home',-4.5,-110),
  q(g,'BetOnline','spread','home',-4.5,-105),
  q(g,'OtherBook','spread','home',-5.5,+140)
 ];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.state,'MODEL_MARKET_COMPARISON');
 assert.equal(r.lean.label,'HOME -4.5');assert.equal(r.lean.differencePoints,2.5);
 assert.equal(r.book.book,'BetOnline');assert.equal(r.book.american,-105);
 assert.equal(r.bookCount,2);assert.equal(r.bookComparison,'BEST_PRICE_AT_SAME_LINE');
 assert.equal(r.canAuthorizeWager,false);
});
test('Model winner differs from ATS lean when market spread is larger',()=>{
 const g=game('cbb',3,144);
 g.recoveryVerifiedOffers=[q(g,'Heritage','spread','away',+7,-110),q(g,'BetOnline','spread','away',+7,-105)];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(g.recoveryVerifiedProjection.margin>0,true);
 assert.equal(r.lean.side,'away');assert.equal(r.lean.label,'AWAY +7.0');
 assert.equal(r.book.book,'BetOnline');
});
test('NBA prefers an over total when side gap is beneath display threshold',()=>{
 const g=game('nba',1,227);
 g.recoveryVerifiedOffers=[
  q(g,'Heritage','spread','home',-1.5,-110),
  q(g,'Heritage','total','over',223,-110),
  q(g,'BetOnline','total','over',223,-105),
  q(g,'OtherBook','total','over',221,+115)
 ];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.lean.family,'total');assert.equal(r.lean.label,'OVER 223.0');
 assert.equal(r.book.book,'BetOnline');assert.equal(r.bookCount,2);
});
test('Under total can be selected without a side lean',()=>{
 const g=game('nfl',0,39);
 g.recoveryVerifiedOffers=[q(g,'Heritage','total','under',43,-110),q(g,'BookB','total','under',43,-105)];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.lean.side,'under');assert.equal(r.lean.label,'UNDER 43.0');
});
test('CFB allows the full-game research comparison but not a wager',()=>{
 const g=game('cfb',5.5,64);
 g.recoveryVerifiedOffers=[q(g,'Heritage','spread','home',-2,-110)];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.lean.side,'home');assert.equal(r.canAuthorizeWager,false);
});
test('Missing current model or expired projection never creates a lean',()=>{
 const g=game();g.recoveryVerifiedOffers=[q(g,'Heritage','spread','home',-4,-110)];
 assert.equal(recoveryLeanShopping({...g,recoveryVerifiedProjection:null},{now}).state,'NO_CURRENT_MODEL');
 g.recoveryVerifiedProjection.expiresAt='2026-11-04T14:00:00Z';
 assert.equal(recoveryLeanShopping(g,{now}).state,'NO_CURRENT_MODEL');
});
test('No valid price cannot become a model side or best bookmaker',()=>{
 const g=game();g.recoveryVerifiedOffers=[q(g,'Heritage','spread','home',-4,-110,{sourceObservedAt:'2026-11-04T14:00:00Z'})];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.state,'NO_VERIFIED_PRICES');assert.equal(r.book,null);assert.equal(r.lean,null);
});
test('First-half, wrong-event, wrong-date, wrong-sport, exchange, suspended and stale prices are rejected',()=>{
 const g=game();
 g.recoveryVerifiedOffers=[
  q(g,'BookA','spread','home',-4,-110,{period:'first_half'}),
  q(g,'BookA','spread','home',-4,-110,{eventId:'999'}),
  q(g,'BookA','spread','home',-4,-110,{date:'2026-11-03'}),
  q(g,'BookA','spread','home',-4,-110,{sport:'nba'}),
  q(g,'Kalshi','spread','home',-4,-110),
  q(g,'BookA','spread','home',-4,-110,{marketState:'suspended'}),
  q(g,'BookA','spread','home',-4,-110,{sourceObservedAt:'2026-11-04T15:20:00Z'}),
  q(g,'BookA','spread','home',-4,-110,{homeId:'999'})
 ];
 const r=recoveryLeanShopping(g,{now});assert.equal(r.verifiedQuotes,0);assert.equal(r.book,null);
});
test('Prices must be real American or convertible decimal odds',()=>{
 const g=game();
 g.recoveryVerifiedOffers=[q(g,'BookA','spread','home',-4.5,null,{decimalOdds:1.95})];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.book.book,'BookA');assert.ok(r.book.american<=-100);
});
test('Quoted total vs score total is not a probability or moneyline decision',()=>{
 const g=game('nba',0,230);g.recoveryVerifiedOffers=[q(g,'BookA','total','over',224,-105)];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.lean.family,'total');assert.equal(r.book.american,-105);
 assert.equal(Object.hasOwn(r,'ev'),false);assert.equal(Object.hasOwn(r,'pWin'),false);
});
test('A started game never claims a fresh pregame best price',()=>{
 const g=game();g.status='live';g.recoveryVerifiedOffers=[q(g,'BookA','spread','home',-4,-110)];
 const r=recoveryLeanShopping(g,{now});assert.equal(r.state,'NOT_PREGAME');
});
test('No supported difference shows no lean rather than inventing one',()=>{
 const g=game('cbb',0.5,147);g.recoveryVerifiedOffers=[
  q(g,'Heritage','spread','home',-0.5,-110),
  q(g,'Heritage','total','over',147,-110)
 ];
 const r=recoveryLeanShopping(g,{now});
 assert.equal(r.state,'NO_VERIFIED_LEAN');assert.equal(r.book,null);
});
