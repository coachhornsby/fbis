import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSoccerTeamBranding, resolveSoccerBrand } from '../functions/lib/soccerTeamBranding.js';
import { buildMatchupFactors } from '../functions/lib/matchupFactors.js';
import { buildGameCardViewModel } from '../src/lib/gameCardViewModel.js';
import { toBoardGame } from '../functions/lib/todayBoard.js';

test('soccer branding reaches board cards without modifying model identities', () => {
 const game={id:'branding-test',sport:'soccer',soccerLeague:'uefa.champions',start:'2026-10-17T19:00:00Z',
  home:{id:'pitch-83',name:'Barcelona',abbr:'—'},away:{id:'pitch-123',name:'Galatasaray',abbr:'—'},
  soccerFbisV2:{ok:true},soccerFbisV3:{ok:true},model:{projHome:2,projAway:1}};
 const enriched=attachSoccerTeamBranding([game])[0];
 assert.equal(enriched.home.id,'pitch-83');
 assert.match(enriched.home.logo,/soccer\/500\/83\.png/);
 assert.ok(enriched.home.color);assert.ok(enriched.away.logo);assert.ok(enriched.away.altColor);
 const board=toBoardGame(enriched,'soccer');
 assert.equal(board.home.sport,'soccer');assert.equal(board.soccerLeague,'uefa.champions');
 assert.deepEqual(board.soccerFbisV2,{ok:true});
 const card=buildGameCardViewModel(board);
 assert.equal(card.units.unit,'GOALS');assert.ok(card.home.logoAvailable);assert.equal(card.home.sport,'soccer');
});
test('exact competition-scoped branding rejects unknown and ambiguous names',()=>{
 assert.equal(resolveSoccerBrand({name:'Manchester'},'eng.1'),null);
 const source={leagues:{x:[{id:'1',name:'United'},{id:'2',name:'United'}]}};
 assert.equal(resolveSoccerBrand({name:'United'},'x',source),null);
 assert.equal(resolveSoccerBrand({name:'Unlisted Team'},'eng.1'),null);
});
test('soccer missing rest inputs never become an even zero-day measurement',()=>{
 const factors=buildMatchupFactors({sport:'soccer',home:{abbr:'BAR'},away:{abbr:'GAL'},
  soccerFbis:{ok:true,home:2,away:1,pBttsYes:.6,diagnostics:{homeRestDays:null,awayRestDays:null}}});
 assert.ok(!factors.some(f=>f.id==='rest'));assert.ok(factors.some(f=>f.id==='expected-goals'));
});
