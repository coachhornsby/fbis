/** Retry only read-only receipt transport failures; no D1 writes or source changes. */
const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

export async function getArchivedReceipt({fetchFn = fetch, url, headers, body, maxAttempts = 5, pause = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8) throw Error('INVALID_RECEIPT_RETRY_BOUND');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchFn(url, {
        method: 'POST', headers, body,
        signal: AbortSignal.timeout(120000),
      });
      if (response.status === 404 || response.status === 413) return null;
      if (response.ok) return await response.json();
    } catch (error) {
      if (attempt === maxAttempts) throw new Error('RECEIPT_TRANSPORT_EXHAUSTED', {cause: error});
      await pause(Math.min(12000, 1000 * 2 ** (attempt - 1)));
      continue;
    }
    if (!RETRYABLE_HTTP.has(response.status)) throw Error('RECEIPT_HTTP_' + response.status);
    if (attempt === maxAttempts) throw Error('RECEIPT_HTTP_RETRIES_EXHAUSTED_' + response.status);
    await pause(Math.min(12000, 1000 * 2 ** (attempt - 1)));
  }
  throw Error('RECEIPT_UNEXPECTED_RETRY_EXIT');
}
