import test from 'node:test';
import assert from 'node:assert/strict';
import {bootstrapWriteTarget} from '../functions/api/polymarket-bootstrap.js';

test('bootstrap prefers MARKET_HISTORY when primary size is full or unknown',()=>{
 const history={prepare(){return {};}};
 assert.equal(bootstrapWriteTarget({DB:{},MARKET_HISTORY_DB:history},9_900_000_000).store,'MARKET_HISTORY');
 assert.equal(bootstrapWriteTarget({DB:{},MARKET_HISTORY_DB:history},0).store,'MARKET_HISTORY');
 assert.equal(bootstrapWriteTarget({DB:{},MARKET_HISTORY_DB:history},undefined).store,'MARKET_HISTORY');
 assert.equal(bootstrapWriteTarget({DB:{},MARKET_HISTORY_DB:history},7_000_000_000).store,'PRIMARY');
 assert.equal(bootstrapWriteTarget({DB:{}},9_900_000_000).blocked,'REST_WRITE_CAPACITY_UNAVAILABLE');
});
