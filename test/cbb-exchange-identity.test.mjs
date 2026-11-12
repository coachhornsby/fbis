import test from 'node:test';import assert from 'node:assert/strict';
import {matchPolymarketUsEvent,polymarketUsCanonicalSide} from '../functions/lib/polymarketUs.js';
const g={id:'cbb-1',sport:'cbb',start:'2026-11-06T21:00Z',away_name:'Massachusetts Minutemen',home_name:'Boston College Eagles',away_abbr:'MASS',home_abbr:'BC'};
const event={title:'UMass vs. Boston College',startTime:g.start,markets:[{marketSides:[{team:{name:'UMass'}},{team:{name:'Boston College'}}]}]};
const orientedOffer={sport:'cbb',marketFamily:'moneyline',side:'UMass',homeTeam:'Boston College',awayTeam:'UMass',raw:{providerSide:{team:{name:'UMass'}},contractLong:true}};
test('CBB provider school alias joins to exact independent fixture and outcome',()=>{
 assert.equal(matchPolymarketUsEvent(event,[g],'cbb').id,g.id);
 assert.equal(polymarketUsCanonicalSide(orientedOffer,g),'away');
 assert.equal(polymarketUsCanonicalSide({...orientedOffer,side:'Eagles'},g),'away');
 assert.equal(matchPolymarketUsEvent(event,[{...g,away_name:'Virginia Cavaliers',away_abbr:'UVA'}],'cbb').id,null);
 assert.equal(matchPolymarketUsEvent(event,[g,{...g,id:'other'}],'cbb').id,null);
});

test('CBB home/away is never inferred on a neutral or provider-unverified market',()=>{
 assert.equal(polymarketUsCanonicalSide({...orientedOffer,homeTeam:null},g),null);
 assert.equal(polymarketUsCanonicalSide(orientedOffer,{...g,neutralSite:true}),null);
 assert.equal(polymarketUsCanonicalSide({...orientedOffer,raw:{...orientedOffer.raw,providerNeutralSite:true}},g),null);
 assert.equal(polymarketUsCanonicalSide({...orientedOffer,raw:{...orientedOffer.raw,contractLong:false}},g),null);
 assert.equal(polymarketUsCanonicalSide({...orientedOffer,homeTeam:'UMass',awayTeam:'Boston College'},g),null);
 const mich={...g,id:'mich-uconn-2026-11-06',home_name:'Michigan Wolverines',away_name:'UConn Huskies',neutralSite:true};
 assert.equal(polymarketUsCanonicalSide({sport:'cbb',marketFamily:'moneyline',side:'Michigan',raw:{providerSide:{team:{name:'Michigan'}},contractLong:true}},mich),null);
});
