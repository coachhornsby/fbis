/**
 * Read-only Kalshi exchange state. Never infer permission to wager, market
 * availability or quote-source health from a trading-active response.
 * All values here come from the documented GET /exchange/status contract.
 */
export const KALSHI_EXCHANGE_STATUS_URL =
  "https://external-api.kalshi.com/trade-api/v2/exchange/status";
const isoOrNull = value => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
};
const booleanOrNull = value => typeof value === "boolean" ? value : null;

export function normalizeKalshiExchangeStatus(body, {observedAt = new Date().toISOString()} = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.exchange_active !== "boolean"
    || typeof body.trading_active !== "boolean") return null;
  const exchangeIndices = Array.isArray(body.exchange_index_statuses)
    ? body.exchange_index_statuses.slice(0, 24)
      .filter(i => i && Number.isInteger(i.exchange_index) && i.exchange_index >= 0
        && typeof i.exchange_active === "boolean" && typeof i.trading_active === "boolean")
      .map(i => ({
        index: i.exchange_index,
        description: typeof i.description === "string" ? i.description.slice(0, 100) : null,
        exchangeActive: i.exchange_active,
        tradingActive: i.trading_active,
        transfersActive: booleanOrNull(i.intra_exchange_transfers_active),
      }))
    : [];
  return {
    exchangeActive: body.exchange_active,
    tradingActive: body.trading_active,
    transfersActive: booleanOrNull(body.intra_exchange_transfers_active),
    estimatedResumeAt: isoOrNull(body.exchange_estimated_resume_time),
    exchangeIndices,
    indexCoverage: Array.isArray(body.exchange_index_statuses)
      ? body.exchange_index_statuses.length > 24 ? "TRUNCATED_TO_24" : "PROVIDER_REPORTED" : "NOT_PROVIDED",
    observedAt,
    informationOnly: true,
    canAuthorizeWager: false,
    executionEligible: false,
  };
}
function retryAfterSeconds(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(14400, Math.ceil(n));
  const asTime = Date.parse(raw);
  return Number.isFinite(asTime)
    ? Math.min(14400, Math.max(0, Math.ceil((asTime - Date.now())/1000)))
    : null;
}
export async function fetchKalshiExchangeStatus({fetchImpl = fetch, now = new Date()} = {}) {
  let response;
  try {
    response = await fetchImpl(KALSHI_EXCHANGE_STATUS_URL, {
      method: "GET",
      headers: {accept: "application/json"},
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return {ok: false, code: "KALSHI_STATUS_CONNECTION_FAILED"};
  }
  if (!response.ok) return {
    ok: false,
    code: response.status === 429 ? "KALSHI_STATUS_RATE_LIMITED" : "KALSHI_STATUS_HTTP_ERROR",
    httpStatus: response.status,
    rateLimited: response.status === 429,
    retryAfterSeconds: response.status === 429 ? retryAfterSeconds(response) : null,
  };
  let body;
  try {body = await response.json();} catch {
    return {ok: false, code: "KALSHI_STATUS_BAD_RESPONSE"};
  }
  const status = normalizeKalshiExchangeStatus(body, {observedAt: now.toISOString()});
  if (!status) return {ok: false, code: "KALSHI_STATUS_SCHEMA_CHANGED"};
  return {ok: true, status};
}
