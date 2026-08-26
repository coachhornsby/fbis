/**
 * Book roles — one job each. Never mix them.
 *
 * Heritage  = execution (where tickets are actually placed)
 * Pinnacle  = sharp / fair / CLV (always the market layer)
 * Kalshi    = public sentiment only (never a betting book)
 */

export const EXECUTION_BOOK = "Heritage";
export const SHARP_BOOK = "Pinnacle";
export const SENTIMENT_BOOK = "Kalshi";

export const SENTIMENT_KEYS = new Set(["kalshi", "polymarket", "robinhood"]);
export const SHARP_KEYS = new Set(["pinnacle"]);
export const EXECUTION_KEYS = new Set([
  "heritage",
  "heritagesports",
  "heritagesports_nonguaranteed",
  "heritage_sports",
]);

/** F5 quotes may be missing at Pinnacle; never pull them from prediction markets. */
export const F5_QUOTE_KEYS = new Set([
  "pinnacle",
  "fanduel",
  "draftkings",
  "bovada",
  "betmgm",
  "caesars",
]);

export const BASEBALL = new Set(["mlb"]);

export function bookKey(book) {
  return String(book?.key || book || "").toLowerCase();
}

export function isSentimentBook(key) {
  return SENTIMENT_KEYS.has(bookKey(key));
}

export function isSharpBook(key) {
  return SHARP_KEYS.has(bookKey(key));
}

export function isExecutionBook(key) {
  return EXECUTION_KEYS.has(bookKey(key));
}

export function isPricingBook(key) {
  return Boolean(bookKey(key)) && !isSentimentBook(key);
}

export function isF5QuoteBook(key) {
  return F5_QUOTE_KEYS.has(bookKey(key)) && !isSentimentBook(key);
}

export function validAmerican(price) {
  const n = Number(price);
  return Number.isFinite(n) && n !== 0 && Math.abs(n) <= 50000;
}

export function runLine(sport, point, { f5 = false } = {}) {
  if (point == null || !Number.isFinite(Number(point))) return null;
  const n = Number(point);
  const sign = n === 0 ? 1 : Math.sign(n);
  if (BASEBALL.has(sport)) return sign * (f5 ? 0.5 : 1.5);
  return n;
}

export function pickRunLineRow(rows, sport, { f5 = false } = {}) {
  if (!rows?.length) return null;
  if (!BASEBALL.has(sport)) return rows[0];
  const want = f5 ? 0.5 : 1.5;
  const hit =
    rows.find((r) => Math.abs(Number(r.point)) === want) ||
    rows.find((r) => Math.abs(Number(r.point)) === (f5 ? 1 : 1)) ||
    rows[0];
  return hit ? { ...hit, point: runLine(sport, hit.point, { f5 }) } : null;
}
