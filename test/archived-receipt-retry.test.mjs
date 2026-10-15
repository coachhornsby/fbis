import test from 'node:test';
import assert from 'node:assert/strict';
import {getArchivedReceipt} from '../scripts/lib/archived-receipt-retry.mjs';
const args = (fetchFn, extra = {}) => ({fetchFn, url: 'https://example.test/receipt', headers: {'x-harvest-secret': 'test'}, body: '{}', pause: async () => {}, ...extra});

test('network ECONNRESET and 503 retry read-only POST, then return exact receipt', async () => {
  let calls = 0;
  const data = {receiptId: 'a', offers: [{raw: {providerMarketId: 'm1'}}]};
  const result = await getArchivedReceipt(args(async (_url, options) => {
    assert.equal(options.method, 'POST');
    calls++;
    if (calls === 1) throw Object.assign(Error('read ECONNRESET'), {code: 'ECONNRESET'});
    if (calls === 2) return new Response('temporary', {status: 503});
    return Response.json(data);
  }));
  assert.deepEqual(result, data);
  assert.equal(calls, 3);
});

test('missing and oversized archived receipts remain unavailable without retry', async () => {
  for (const status of [404, 413]) {
    let calls = 0;
    assert.equal(await getArchivedReceipt(args(async () => {calls++; return new Response('', {status});})), null);
    assert.equal(calls, 1);
  }
});

test('auth failures abort without retry or falling back to unverified data', async () => {
  let calls = 0;
  await assert.rejects(getArchivedReceipt(args(async () => {calls++; return new Response('', {status: 403});})), /RECEIPT_HTTP_403/);
  assert.equal(calls, 1);
});

test('repeated transient network failures fail closed after bounded attempts', async () => {
  let calls = 0;
  await assert.rejects(getArchivedReceipt(args(async () => {calls++; throw Error('reset');}, {maxAttempts: 3})), /RECEIPT_TRANSPORT_EXHAUSTED/);
  assert.equal(calls, 3);
});

test('repeated HTTP 429 fails closed after bounded attempts', async () => {
  let calls = 0;
  await assert.rejects(getArchivedReceipt(args(async () => {calls++; return new Response('', {status: 429});}, {maxAttempts: 2})), /RECEIPT_HTTP_RETRIES_EXHAUSTED_429/);
  assert.equal(calls, 2);
});

test('invalid bound cannot create an unlimited retry loop', async () => {
  await assert.rejects(getArchivedReceipt(args(async () => Response.json({}), {maxAttempts: 100})), /INVALID_RECEIPT_RETRY_BOUND/);
});
