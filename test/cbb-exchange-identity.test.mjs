import test from 'node:test';import assert from 'node:assert/strict';
import {matchPolymarketUsEvent,polymarketUsCanonicalSide} from '../functions/lib/polymarketUs.js';
const g={id:'cbb-1',sport:'cbb',start:'2026-11-06T21:00Z',away_name:'Massachusetts Minutemen',home_name:'Boston College Eagles',away_abbr:'MASS',home_abbr:'BC'};
const event={title:'UMass vs. Boston College',startTime:g.start,markets:[{marketSides:[{team:{name:'UMass'}},{team:{name:'Boston College'}}]}]};
test('CBB provider school alias joins to exact independent fixture and outcome',()=>{
 assert.equal(matchPolymarketUsEvent(event,[g],'cbb').id,g.id);
 assert.equal(polymarketUsCanonicalSide({sport:'cbb',marketFamily:'moneyline',side:'UMass',raw:{providerSide:{team:{name:'UMass'}}}},g),'away');
 assert.equal(polymarketUsCanonicalSide({sport:'cbb',marketFamily:'moneyline',side:'Eagles',raw:{providerSide:{team:{name:'UMass'}}}},g),'away');
 assert.equal(matchPolymarketUsEvent(event,[{...g,away_name:'Virginia Cavaliers',away_abbr:'UVA'}],'cbb').id,null);
 assert.equal(matchPolymarketUsEvent(event,[g,{...g,id:'other'}],'cbb').id,null);
});
