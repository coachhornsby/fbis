/**
 * FBIS Kalshi account reader. Private data never crosses into the public board.
 * Strict GET allowlist; no order creation, amendment, cancellation or transfers.
 * Kalshi API keys: https://docs.kalshi.com/getting_started/api_keys
 * This implementation intentionally accepts the recommended PKCS#8 Ed25519 keys.
 */
export const KALSHI_BASE = "https://external-api.kalshi.com";
export const KALSHI_REST_PREFIX = "/trade-api/v2";
export const KALSHI_ACCOUNT_PATHS = Object.freeze({
  balance: "/trade-api/v2/portfolio/balance",
  positions: "/trade-api/v2/portfolio/positions",
  orders: "/trade-api/v2/portfolio/orders",
  fills: "/trade-api/v2/portfolio/fills",
});
export const KALSHI_PRIVATE_CHANNELS = Object.freeze(["fill", "market_positions", "user_orders"]);
const decoder = new TextEncoder();

function pemBytes(pem) {
  const trimmed = String(pem || "").replace(/\\n/g, "\n").trim();
  if (!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(trimmed)) {
    throw new Error("kalshi-ed25519-pkcs8-secret-unconfigured");
  }
  const raw = trimmed.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error("kalshi-invalid-private-key");
  return Uint8Array.from(atob(raw), c => c.charCodeAt(0));
}

export async function kalshiSignedHeaders({ keyId, privateKeyPem, method = "GET", path, timestamp = Date.now(), webCrypto = crypto } = {}) {
  if (!Object.values(KALSHI_ACCOUNT_PATHS).includes(path) && path !== "/trade-api/ws/v2") {
    throw new Error("kalshi-read-path-not-allowed");
  }
  if (method !== "GET" || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error("kalshi-read-method-not-allowed");
  }
  if (!keyId || typeof keyId !== "string") throw new Error("kalshi-key-id-unconfigured");
  const der = pemBytes(privateKeyPem);
  try {
    const key = await webCrypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
    const data = decoder.encode(String(timestamp) + method + path);
    const bytes = new Uint8Array(await webCrypto.subtle.sign({ name: "Ed25519" }, key, data));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return {
      "KALSHI-ACCESS-KEY": keyId,
      "KALSHI-ACCESS-SIGNATURE": btoa(binary),
      "KALSHI-ACCESS-TIMESTAMP": String(timestamp),
    };
  } finally {
    der.fill(0);
  }
}

const dollars = value => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const trimmed = v => v == null ? null : String(v).slice(0, 180);
const secondsToIso = v => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const pickDate = v => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

export async function kalshiGet(key, env, { params = {}, fetchImpl = fetch, now = Date.now() } = {}) {
  const path = KALSHI_ACCOUNT_PATHS[key];
  if (!path) throw new Error("kalshi-read-path-not-allowed");
  const url = new URL(KALSHI_BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, String(v));
  const headers = await kalshiSignedHeaders({ keyId: env.KALSHI_API_KEY_ID, privateKeyPem: env.KALSHI_PRIVATE_KEY_PEM, path, timestamp: now });
  const r = await fetchImpl(url.toString(), { method: "GET", headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return { ok: false, status: r.status };
  const body = await r.json();
  if (!body || typeof body !== "object") return { ok: false, status: 502 };
  return { ok: true, body };
}

export async function kalshiPaged(key, arrayKey, env, { fetchImpl = fetch, maxPages = 3, params = {} } = {}) {
  let cursor = "", complete = false;
  const items = [], seen = new Set();
  for (let i = 0; i < maxPages; i++) {
    const r = await kalshiGet(key, env, { fetchImpl, params: { ...params, limit: 200, ...(cursor ? { cursor } : {}) } });
    if (!r.ok) return { ok: false, status: r.status };
    if (!Array.isArray(r.body[arrayKey])) return { ok: false, status: 502 };
    items.push(...r.body[arrayKey]);
    cursor = String(r.body.cursor || "");
    if (!cursor) { complete = true; break; }
    if (seen.has(cursor)) break;
    seen.add(cursor);
  }
  return { ok: true, items, complete };
}

export function kalshiPosition(p) {
  return {
    ticker: trimmed(p.ticker),
    exchangeIndex: Number.isInteger(p.exchange_index) ? p.exchange_index : null,
    contracts: dollars(p.position_fp ?? p.position),
    exposureDollars: dollars(p.market_exposure_dollars ?? (p.market_exposure == null ? null : Number(p.market_exposure) / 100)),
    realizedPnlDollars: dollars(p.realized_pnl_dollars ?? (p.realized_pnl == null ? null : Number(p.realized_pnl) / 100)),
    feesPaidDollars: dollars(p.fees_paid_dollars ?? (p.fees_paid == null ? null : Number(p.fees_paid) / 100)),
    lastUpdated: pickDate(p.last_updated_ts),
  };
}
export function kalshiFill(f) {
  return {
    id: trimmed(f.fill_id || f.trade_id),
    ticker: trimmed(f.ticker || f.market_ticker),
    side: trimmed(f.side || f.outcome_side),
    action: trimmed(f.action),
    contracts: dollars(f.count_fp ?? f.count),
    yesPriceDollars: dollars(f.yes_price_dollars ?? (f.yes_price == null ? null : Number(f.yes_price) / 100)),
    feeDollars: dollars(f.fee_cost),
    filledAt: pickDate(f.created_time) || secondsToIso(f.ts),
  };
}
export function kalshiOrder(o) {
  return {
    id: trimmed(o.order_id),
    ticker: trimmed(o.ticker),
    status: trimmed(o.status),
    action: trimmed(o.action),
    side: trimmed(o.side),
    remainingContracts: dollars(o.remaining_count_fp ?? o.remaining_count),
    yesPriceDollars: dollars(o.yes_price_dollars ?? (o.yes_price == null ? null : Number(o.yes_price) / 100)),
    createdAt: pickDate(o.created_time),
  };
}

/** REST is authoritative. WebSocket notifications trigger a fresh REST reconcile. */
export function kalshiPrivateNotification(message) {
  let msg;
  try { msg = typeof message === "string" ? JSON.parse(message) : message; } catch { return null; }
  if (!msg || typeof msg !== "object") return null;
  const type = String(msg.type || "");
  if (!["fill", "market_position", "user_order"].includes(type) || !msg.msg || typeof msg.msg !== "object") return null;
  return { type, ticker: trimmed(msg.msg.market_ticker || msg.msg.ticker), receivedAt: new Date().toISOString(), reconciliationRequired: true };
}
export function kalshiSubscribePrivate(id = 1) {
  return { id, cmd: "subscribe", params: { channels: [...KALSHI_PRIVATE_CHANNELS] } };
}

export async function readKalshiAccount(env, { fetchImpl = fetch } = {}) {
  if (!env?.KALSHI_API_KEY_ID || !env?.KALSHI_PRIVATE_KEY_PEM) {
    return { ok: false, code: "KALSHI_NOT_CONFIGURED" };
  }
  // A failed collection is never presented as a complete or zero-balance account.
  const [balance, positions, orders, fills] = await Promise.all([
    kalshiGet("balance", env, { fetchImpl }),
    kalshiPaged("positions", "market_positions", env, { fetchImpl, params: { settlement_status: "unsettled" } }),
    kalshiPaged("orders", "orders", env, { fetchImpl, params: { status: "resting" } }),
    kalshiPaged("fills", "fills", env, { fetchImpl }),
  ]);
  if (![balance, positions, orders, fills].every(x => x.ok)) {
    return { ok: false, code: "KALSHI_UPSTREAM_FAILED", httpStatuses: [balance,positions,orders,fills].map(x=>x.status||null) };
  }
  const bd = balance.body;
  // Use only documented money fields. portfolio_value is cents; balance_dollars is a dollar string.
  const availableCashDollars = dollars(bd.balance_dollars ?? (bd.balance == null ? null : Number(bd.balance) / 100));
  const positionValueDollars = dollars(bd.portfolio_value_dollars ?? (bd.portfolio_value == null ? null : Number(bd.portfolio_value) / 100));
  if (availableCashDollars == null || positionValueDollars == null) return { ok: false, code: "KALSHI_BALANCE_SCHEMA_CHANGED" };
  return {
    ok: true, provider: "kalshi", readOnly: true, tradingEnabled: false, capturedAt: new Date().toISOString(),
    balanceUpdatedAt: secondsToIso(bd.updated_ts), availableCashDollars, positionValueDollars,
    accountTotalDollars: availableCashDollars + positionValueDollars,
    positions: positions.items.map(kalshiPosition).filter(p => p.ticker && p.contracts !== 0),
    openOrders: orders.items.map(kalshiOrder).filter(o => o.id),
    recentFills: fills.items.map(kalshiFill).filter(f => f.id).slice(0, 100),
    complete: { positions: positions.complete, openOrders: orders.complete, recentFills: fills.complete },
    historyCoverage: "RECENT_ONLY", verifiedReturnsAvailable: false, websocketState: "NOT_CONNECTED",
  };
}
