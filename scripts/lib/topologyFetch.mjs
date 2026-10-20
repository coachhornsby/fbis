/**
 * Shared topology POST helper for ops scripts.
 * Raises undici headers/body timeouts above AbortSignal so CFB-sized
 * Pages Function calls are not killed by the default 300s headersTimeout.
 */
import { Agent, fetch as undiciFetch } from "undici";

export function createTopologyClient({
  base = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev",
  secret = process.env.HARVEST_SECRET || "",
  timeoutMs = 360_000,
  retries = 3,
} = {}) {
  const requestTimeoutMs = Math.min(540_000, Math.max(30_000, Number(timeoutMs) || 360_000));
  const dispatcher = new Agent({
    connectTimeout: 30_000,
    headersTimeout: requestTimeoutMs + 15_000,
    bodyTimeout: requestTimeoutMs + 15_000,
    keepAliveTimeout: 10_000,
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function errorText(error) {
    const parts = [error?.message, error?.cause?.message, error?.cause?.code, error?.code];
    return parts.filter(Boolean).join(" | ");
  }

  function isRetryable(error, status) {
    if ([502, 503, 504, 520, 522, 524].includes(status)) return true;
    const msg = errorText(error);
    return /INVALID_JSON_HTTP_50[234]|HTTP_50[234]|HTTP_52[024]|AbortError|TimeoutError|timeout|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|fetch failed/i.test(msg);
  }

  async function postTopology(operation, extra = {}, { retries: opRetries = retries } = {}) {
    if (!secret) throw new Error("HARVEST_SECRET_REQUIRED");
    let lastError = null;
    for (let attempt = 0; attempt <= opRetries; attempt += 1) {
      try {
        const response = await undiciFetch(`${base}/api/database-topology`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-harvest-secret": secret,
            "cache-control": "no-cache",
          },
          body: JSON.stringify({ operation, ...extra }),
          signal: AbortSignal.timeout(requestTimeoutMs),
          dispatcher,
        });
        const text = await response.text();
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          const err = new Error(`TOPOLOGY_${operation}_INVALID_JSON_HTTP_${response.status}`);
          if (isRetryable(err, response.status) && attempt < opRetries) {
            lastError = err;
            await sleep(1500 * (attempt + 1));
            continue;
          }
          throw err;
        }
        if (response.status === 403) throw new Error("TOPOLOGY_FORBIDDEN");
        if (!response.ok) {
          const err = new Error(
            `TOPOLOGY_${operation}_HTTP_${response.status}_${body?.error || body?.reason || "ERROR"}`
          );
          if (isRetryable(err, response.status) && attempt < opRetries) {
            lastError = err;
            await sleep(1500 * (attempt + 1));
            continue;
          }
          throw err;
        }
        return body;
      } catch (error) {
        lastError = error;
        if (isRetryable(error, 0) && attempt < opRetries) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error(`TOPOLOGY_${operation}_FAILED`);
  }

  return { postTopology, requestTimeoutMs };
}
