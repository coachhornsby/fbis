import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cbbLineShopping} from '../src/lib/cbbSideLineShopping.js';

const now=Date.parse('2026-11-03T17:00:00Z');
const fresh='2026-11-03T16:59:00Z';
const game=()=>({id:'123',sport:'cbb',date:'2026-11-03',start:'2026-11-03T22:00:00Z',status:'scheduled',home:{espnId:'1',name:'Home'},away:{espnId:'2',name:'Away'}});
const projection=(margin=6)=>({primary:{home:77,away:77-margin,margin,total:154-margin},expiresAt:'2026-11-03T19:00:00Z',historical:false});
const offer=(source,side,line,american,options={})=>({source,side,line,americanOdds:american,eventId:'123',marketFamily:'spread',period:'full_game',capturedAt:fresh,...options});

test('model fair spread and ATS side differ from merely picking winner',()=>{
 const g={...game(),cbbVerifiedOffers:[offer('Book A','home',-3.5,-110),offer('Book B','home',-3.5,-105),offer('Book C','home',-3,-120),offer('Book A','away',3.5,-110)]};
 const r=cbbLineShopping(g,projection(),now);
 assert.equal(r.state,'REFERENCE_COMPARISON');
 assert.equal(r.projectedWinner,'home');
 assert.equal(r.side,'home');
 assert.equal(r.fairHomeSpread,-6);
 assert.equal(r.referenceHomeSpread,-3.5);
 assert.equal(r.referenceEdgePoints,2.5);
 assert.equal(r.bestPriceAtReference.source,'Book B');
 assert.equal(r.bestPriceAtReference.american,-105);
 assert.equal(r.referenceBooks,2);
 assert.equal(r.bestLine.source,'Book C');
 assert.equal(r.bestLine.line,-3);
 assert.equal(r.canAuthorizeWager,false);
});

test('favorite can be the non-value side against the market spread',()=>{
 const g={...game(),cbbVerifiedOffers:[offer('Book A','home',-5,-110),offer('Book A','away',5,-110)]};
 const r=cbbLineShopping(g,projection(2),now);
 assert.equal(r.projectedWinner,'home');
 assert.equal(r.side,'away');
 assert.equal(r.referenceSideLine,5);
 assert.equal(r.referenceEdgePoints,3);
 assert.equal(r.bestPriceAtReference.source,'Book A');
});

test('stale, incorrect event, incorrect period, exchange and suspended quotes fail closed',()=>{
 const bad=[
 offer('Book A','home',-3,-110,{eventId:'456'}),
 offer('Book A','home',-3,-110,{capturedAt:'2026-11-03T16:50:00Z'}),
 offer('Book A','home',-3,-110,{capturedAt:'2026-11-03T17:10:00Z'}),
 offer('Book A','home',-3,-110,{period:'first_half'}),
 offer('Book A','home',-3,-110,{marketFamily:'total'}),
 offer('Book A','home',-3,-110,{marketState:'suspended'}),
 offer('Polymarket US','home',-3,-110),
 offer('Kalshi','home',-3,-110),
 offer('Book A','home',-3,0),
 offer('Book A','home',-3,null,{americanOdds:null}),
 offer('Book A','draw',-3,-110),
 offer('Book A','home',500,-110)
 ];
 assert.equal(cbbLineShopping({...game(),market:{venueOffers:bad}},projection(),now).state,'NO_VERIFIED_CURRENT_PRICES');
});

test('historical models never claim a current best quote',()=>{
 const g={...game(),cbbVerifiedOffers:[offer('Book A','home',-3,-110)]};
 assert.equal(cbbLineShopping(g,{...projection(),historical:true},now).state,'HISTORICAL_PROJECTION');
 assert.equal(cbbLineShopping(g,{...projection(),expiresAt:'2026-11-03T15:00:00Z'},now).state,'HISTORICAL_PROJECTION');
 assert.equal(cbbLineShopping({...g,status:'live'},projection(),now).state,'GAME_NOT_PREGAME');
 assert.equal(cbbLineShopping({...g,start:'2026-11-03T15:00:00Z'},projection(),now).state,'GAME_NOT_PREGAME');
});

test('does not borrow prices from a different side and keeps no approval',()=>{
 const g={...game(),cbbVerifiedOffers:[offer('Book A','away',4,-110),offer('Book B','away',4,-115)]};
 const r=cbbLineShopping(g,projection(7),now);
 assert.equal(r.side,'home');
 assert.equal(r.state,'NO_MATCHED_SIDE_QUOTE');
 assert.equal(r.bestPriceAtReference,null);
 assert.equal(r.bestLine,null);
});

test('decimal odds are converted only for valid event-matched full-game sportsbook quotes',()=>{
 const q=offer('PinnOdds','home',-3.5,null,{americanOdds:null,decimalOdds:1.95});
 const r=cbbLineShopping({...game(),cbbVerifiedOffers:[q]},projection(),now);
 assert.equal(r.bestPriceAtReference.american,-105);
 assert.equal(r.referenceBooks,1);
});
