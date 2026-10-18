import test from 'node:test';import assert from 'node:assert/strict';import {chicagoDayBounds} from '../functions/lib/chicagoDayBounds.js';
test('Chicago sports day includes Sunday night games after UTC midnight',()=>{const x=chicagoDayBounds('2026-10-18');assert.equal(x.start,'2026-10-18T05:00:00.000Z');assert.equal(x.end,'2026-10-19T05:00:00.000Z');});
test('Chicago day bounds handle the 25-hour fall-back sports day',()=>{const x=chicagoDayBounds('2026-11-01');assert.equal((Date.parse(x.end)-Date.parse(x.start))/3600000,25);});
