import test from 'node:test';import assert from 'node:assert/strict';import {sharedVenueFetchAge} from '../src/lib/sharedVenueFetchAge.js';
const c=(at,label='Fetched 52m ago')=>({observedAtMs:at,observedLabel:label});
test('one venue age only for exactly matching capture clocks and status labels',()=>{
 assert.equal(sharedVenueFetchAge([{cells:[c(1000),c(1000),{price:'—'}]}]),'Fetched 52m ago');
 assert.equal(sharedVenueFetchAge([{cells:[c(1000),c(1001)]}]),null);
 assert.equal(sharedVenueFetchAge([{cells:[c(1000),c(1000,'Status checked 52m ago')]}]),null);
 assert.equal(sharedVenueFetchAge([{cells:[c(NaN)]}]),null);
 assert.equal(sharedVenueFetchAge([]),null);
 assert.equal(sharedVenueFetchAge([{cells:[{lines:[c(1000),c(1000)]},c(1001)]}]),null);
});
