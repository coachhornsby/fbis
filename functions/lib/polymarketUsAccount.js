import { signedPolymarketUsAccountGetHeaders, POLY_US_ACCOUNT_READ_PATHS } from "./polymarketUsSignedWs.js";

const HOST = "https://api.polymarket.us";
const PATH = Object.freeze({
  balances: "/v1/account/balances",
  positions: "/v1/portfolio/positions",
  activities: "/v1/portfolio/activities",
  orders: "/v1/orders/open",
});
const bounded = (v, max = 180) => v == null ? null : String(v).slice(0, max);
const amount = v => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v && typeof v === "object" ? v.value : v);
  return Number.isFinite(n) ? n : null;
};
const iso = v => v && Number.isFinite(Date.parse(String(v))) ? new Date(v).toISOString() : null;

export async function polymarketAccountGet(kind, env, { fetchImpl = fetch, cursor = null } = {}) {
  const path = PATH[kind];
  if (!path || !POLY_US_ACCOUNT_READ_PATHS.includes(path)) throw new Error("polymarket-account-path-blocked");
  let headers;
  try {
    headers = await signedPolymarketUsAccountGetHeaders({
      keyId: env.POLYMARKET_US_KEY_ID,
      secretKey: env.POLYMARKET_US_SECRET_KEY,
      path,
    });
  } catch {
    return { ok: false, code: "POLYMARKET_SIGNING_FAILED" };
  }
  const url = new URL(path, HOST);
  if (kind === "positions" || kind === "activities") {
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
  }
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(16000),
    });
  } catch {
    return { ok: false, code: "POLYMARKET_CONNECTION_FAILED" };
  }
  if (!response.ok) return { ok: false, code: "POLYMARKET_HTTP_ERROR", status: response.status };
  let body;
  try { body = await response.json(); } catch {
    return { ok: false, code: "POLYMARKET_BAD_RESPONSE" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "POLYMARKET_BAD_RESPONSE" };
  }
  return { ok: true, body };
}

export async function polymarketAccountPages(kind, env, { fetchImpl = fetch, maxPages = 3 } = {}) {
  if (!["positions", "activities"].includes(kind)) throw new Error("polymarket-account-pagination-blocked");
  const rows = [], seen = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const response = await polymarketAccountGet(kind, env, { fetchImpl, cursor });
    if (!response.ok) return response;
    const value = response.body[kind];
    if (kind === "positions" ? !value || typeof value !== "object" || Array.isArray(value) : !Array.isArray(value)) {
      return { ok: false, code: "POLYMARKET_BAD_RESPONSE" };
    }
    rows.push(...(kind === "positions" ? Object.entries(value).map(([slug, position]) => ({ slug, position })) : value));
    if (response.body.eof === true) return { ok: true, rows, complete: true };
    const next = response.body.nextCursor;
    if (!next || typeof next !== "string" || next.length > 1024 || seen.has(next)) {
      return { ok: true, rows, complete: false };
    }
    seen.add(next);
    cursor = next;
  }
  return { ok: true, rows, complete: false };
}

export function polymarketAccountBalance(row) {
  if (!row || typeof row !== "object") return null;
  const currency = bounded(row.currency, 20);
  if (!currency) return null;
  return {
    currency,
    cashBalance: amount(row.currentBalance),
    buyingPower: amount(row.buyingPower),
    assetNotional: amount(row.assetNotional),
    assetAvailable: amount(row.assetAvailable),
    unsettledFunds: amount(row.unsettledFunds),
    openOrdersReserved: amount(row.openOrders),
    lastUpdated: iso(row.lastUpdated),
    // No bank identifiers, pending-withdrawal destinations, or funding records.
  };
}

export function polymarketAccountPosition(item) {
  const p = item?.position;
  if (!p || typeof p !== "object") return null;
  const quantity = amount(p.netPositionDecimal ?? p.netPosition);
  if (!item.slug || p.expired === true || quantity === 0) return null;
  return {
    market: bounded(item.slug),
    label: bounded(p.marketMetadata?.title),
    quantity,
    cashValue: amount(p.cashValue),
    costBasis: amount(p.cost),
    realizedPnl: amount(p.realized),
    updatedAt: iso(p.updateTime),
  };
}

export function polymarketAccountActivity(row) {
  if (!row || row.type !== "ACTIVITY_TYPE_TRADE" || !row.trade) return null;
  const t = row.trade;
  const market = bounded(t.marketSlug);
  const id = bounded(t.id);
  if (!market || !id) return null;
  return {
    id, market,
    at: iso(t.updateTime || t.createTime),
    quantity: amount(t.qtyDecimal ?? t.qty),
    price: amount(t.price),
    costBasis: amount(t.costBasis),
    realizedPnl: amount(t.realizedPnl),
    state: bounded(t.state, 50),
    side: bounded(t.outcomeSide || t.side, 20),
    action: bounded(t.intent || t.action, 20),
    orderId: bounded(t.orderId || t.orderID),
    fee: amount(t.feeAmount ?? t.fee),
  };
}

export function polymarketAccountOrder(o) {
  if (!o || typeof o !== "object" || !o.id) return null;
  return {
    id: bounded(o.id),
    market: bounded(o.marketSlug),
    marketTitle: bounded(o.marketMetadata?.title),
    side: bounded(o.side, 50),
    outcome: bounded(o.outcomeSide, 50),
    intent: bounded(o.intent, 50),
    price: amount(o.price),
    remaining: amount(o.leavesQuantity),
    createdAt: iso(o.createTime || o.insertTime),
  };
}

export async function readPolymarketUsAccount(env, { fetchImpl = fetch } = {}) {
  if (!env?.POLYMARKET_US_KEY_ID || !env?.POLYMARKET_US_SECRET_KEY) {
    return { ok: false, code: "POLYMARKET_NOT_CONFIGURED" };
  }
  const keys = ["balances", "positions", "activities", "orders"];
  const results = await Promise.all([
    polymarketAccountGet("balances", env, { fetchImpl }),
    polymarketAccountPages("positions", env, { fetchImpl }),
    polymarketAccountPages("activities", env, { fetchImpl }),
    polymarketAccountGet("orders", env, { fetchImpl }),
  ]);
  if (!results.every(r => r.ok)) {
    return {
      ok: false,
      code: results.some(r => r.code === "POLYMARKET_SIGNING_FAILED") ? "POLYMARKET_SIGNING_FAILED"
        : results.some(r => r.code === "POLYMARKET_CONNECTION_FAILED") ? "POLYMARKET_CONNECTION_FAILED"
        : "POLYMARKET_UPSTREAM_FAILED",
      failures: Object.fromEntries(keys.map((key, i) => [key, results[i].ok ? null : {
        code: results[i].code || "POLYMARKET_UNKNOWN_ERROR",
        status: results[i].status || null,
      }])),
    };
  }
  const balances = results[0].body.balances, orders = results[3].body.orders;
  if (!Array.isArray(balances) || !Array.isArray(orders)) {
    return { ok: false, code: "POLYMARKET_BAD_RESPONSE" };
  }
  const safeBalances = balances.map(polymarketAccountBalance).filter(Boolean);
  if (!safeBalances.length) return { ok: false, code: "POLYMARKET_BALANCE_SCHEMA_CHANGED" };
  return {
    ok: true, provider: "polymarket_us", readOnly: true, tradingEnabled: false,
    capturedAt: new Date().toISOString(), balances: safeBalances,
    positions: results[1].rows.map(polymarketAccountPosition).filter(Boolean),
    openOrders: orders.map(polymarketAccountOrder).filter(Boolean).slice(0, 300),
    recentTrades: results[2].rows.map(polymarketAccountActivity).filter(Boolean).slice(0, 100),
    complete: { positions: results[1].complete, recentTrades: results[2].complete, openOrders: true },
    // Do not infer total net worth by adding cash and assetNotional without a provider
    // reconciliation contract, or combine currencies/exchanges.
    accountTotalVerified: false,
    historyCoverage: "RECENT_ONLY", websocketState: "NOT_CONNECTED",
  };
}
