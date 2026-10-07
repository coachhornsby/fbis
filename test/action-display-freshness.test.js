import test from 'node:test';
import assert from 'node:assert/strict';
import {currentActionDisplay} from '../functions/lib/actionDisplayFreshness.js';
const now=Date.parse('2026-10-07T20:00:00Z');
function game(collectedAt){return {model:{homeScore:4},market:{provider:'PINNACLE'},actionIntel:{collectedAt,publicSplits:{ticketPct:80}},publicSplits:{ticketPct:80},sentiment:{source:'ACTION_APIFY',ticketPct:80}};}
test('current ACTION capture remains available within its source ceiling',()=>{const g=game('2026-10-07T19:50:00Z');assert.equal(currentActionDisplay(g,now),g);});
test('stale, unknown, malformed and future captures cannot masquerade as current board intelligence',()=>{for(const at of ['2026-10-07T19:49:59Z',null,'bad','2026-10-07T20:00:01Z']){const g=game(at),out=currentActionDisplay(g,now);assert.equal(out.actionIntel,null);assert.equal(out.publicSplits,null);assert.equal(out.sentiment,null);assert.equal(out.actionFreshness.state,'STALE');assert.equal(out.model,g.model);assert.equal(out.market,g.market);assert.equal(g.publicSplits.ticketPct,80);}});
test('non-ACTION source data remains independent',()=>{const g={sentiment:{source:'OTHER'},publicSplits:{ticketPct:60}};assert.equal(currentActionDisplay(g,now),g);});
