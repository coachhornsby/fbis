/**
 * Book capability keys — one job each. Never mix them.
 *
 * Heritage  = supported EXECUTION provider (only becomes EXECUTION_MARKET when listed
 *             in operatorExecutionBooks — never assumed by default)
 * Pinnacle  = REFERENCE market (optional research benchmark — never required for board/ops)
 * Kalshi    = public sentiment only (never a betting book)
 *
 * Do not treat Pinnacle as synonymous with "the market." Prefer execution + consensus.
 * isExecutionBook() means "this key is an execution-capable provider," not
 * "this book is currently configured for the operator."
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

/** Display coerce only. Never rewrite a quote's price onto a different point. */
export function runLine(sport, point, { f5 = false } = {}) {
  if (point == null || !Number.isFinite(Number(point))) return null;
  const n = Number(point);
  if (!BASEBALL.has(sport)) return n;
  const want = f5 ? 0.5 : 1.5;
  if (Math.abs(n) === want) return n;
  return null;
}

export function pairSpreadSides(homeRows, awayRows) {
  for (const h of homeRows || []) {
    if (h.point == null || !validAmerican(h.price)) continue;
    const want = -Number(h.point);
    const a = (awayRows || []).find((r) => Number(r.point) === want && validAmerican(r.price));
    if (a) return { home: h, away: a, point: Number(h.point) };
  }
  return null;
}

export function pairTotalSides(overRows, underRows) {
  for (const o of overRows || []) {
    if (o.point == null || !validAmerican(o.price)) continue;
    const u = (underRows || []).find((r) => Number(r.point) === Number(o.point) && validAmerican(r.price));
    if (u) return { over: o, under: u, point: Number(o.point) };
  }
  return null;
}

/** Exact baseball run line only. No fallback onto an alternate. */
export function pickExactRunLinePair(homeRows, awayRows, sport, { f5 = false } = {}) {
  const paired = pairSpreadSides(homeRows, awayRows);
  if (!paired) return null;
  if (!BASEBALL.has(sport)) return paired;
  const want = f5 ? 0.5 : 1.5;
  if (Math.abs(paired.point) !== want) {
    const hWant = (homeRows || []).filter((r) => Math.abs(Number(r.point)) === want);
    const aWant = (awayRows || []).filter((r) => Math.abs(Number(r.point)) === want);
    return pairSpreadSides(hWant, aWant);
  }
  return paired;
}

export function pickRunLineRow(rows, sport, { f5 = false } = {}) {
  if (!rows?.length) return null;
  if (!BASEBALL.has(sport)) return rows[0];
  const want = f5 ? 0.5 : 1.5;
  return rows.find((r) => Math.abs(Number(r.point)) === want) || null;
}
