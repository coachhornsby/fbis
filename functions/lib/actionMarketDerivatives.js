/**
 * ACTION market intelligence derivatives.
 *
 * Derived from immutable observation time series:
 * movement, book disagreement, public-split research, line shopping, CLV, misprice context.
 *
 * Never enters PURE features. Never qualifies or authorizes wagers.
 * Ticket % and money % stay independent; divergence is never labeled "sharp".
 */

import { ACTION_FIREWALL } from "./actionObservationSeries.js";
import { REASON_CODE } from "./canonical/decisionAuthority.js";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Line movement between two snapshot pointers (e.g. OPEN → CURRENT).
 */
export function deriveLineMovement({ openLine = null, currentLine = null, openPrice = null, currentPrice = null } = {}) {
  const o = num(openLine);
  const c = num(currentLine);
  const op = num(openPrice);
  const cp = num(currentPrice);
  return {
    lineDelta: o == null || c == null ? null : c - o,
    priceDelta: op == null || cp == null ? null : cp - op,
    direction:
      o == null || c == null ? null : c > o ? "UP" : c < o ? "DOWN" : "FLAT",
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Book disagreement across concurrent book observations (same market/selection).
 */
export function deriveBookDisagreement(bookRows = []) {
  const lines = bookRows.map((r) => num(r.line ?? r.point)).filter((n) => n != null);
  const prices = bookRows.map((r) => num(r.americanPrice ?? r.price)).filter((n) => n != null);
  if (!lines.length && !prices.length) {
    return { ok: false, reason: "insufficient-books", books: 0, governance: { ...ACTION_FIREWALL } };
  }
  const lineMin = lines.length ? Math.min(...lines) : null;
  const lineMax = lines.length ? Math.max(...lines) : null;
  const priceMin = prices.length ? Math.min(...prices) : null;
  const priceMax = prices.length ? Math.max(...prices) : null;
  return {
    ok: true,
    books: bookRows.length,
    lineMin,
    lineMax,
    lineRange: lineMin == null || lineMax == null ? null : lineMax - lineMin,
    priceMin,
    priceMax,
    priceRange: priceMin == null || priceMax == null ? null : priceMax - priceMin,
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Public-split research — preserve ticket % and money % separately.
 * money−ticket is local research only; never "sharp".
 */
export function derivePublicSplitResearch({ ticketPct = null, moneyPct = null } = {}) {
  const t = num(ticketPct);
  const m = num(moneyPct);
  const divergence = t == null || m == null ? null : m - t;
  return {
    ticketPct: t,
    moneyPct: m,
    moneyMinusTicket: divergence,
    sharpLabel: null, // never invent
    note: "Divergence is research context only — not a sharp/public label",
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Line shopping across books for best executable price (research).
 */
export function deriveLineShopping(bookRows = [], { prefer = "price" } = {}) {
  const scored = bookRows
    .map((r) => ({
      sportsbook: r.sportsbook || r.book || null,
      line: num(r.line ?? r.point),
      americanPrice: num(r.americanPrice ?? r.price),
    }))
    .filter((r) => r.sportsbook && (r.line != null || r.americanPrice != null));
  if (!scored.length) {
    return { ok: false, best: null, books: 0, governance: { ...ACTION_FIREWALL } };
  }
  let best = scored[0];
  for (const row of scored.slice(1)) {
    if (prefer === "price") {
      if ((row.americanPrice ?? -Infinity) > (best.americanPrice ?? -Infinity)) best = row;
    } else if ((row.line ?? -Infinity) > (best.line ?? -Infinity)) {
      best = row;
    }
  }
  return { ok: true, best, books: scored.length, alternatives: scored, governance: { ...ACTION_FIREWALL } };
}

/**
 * Closing line value research vs FINAL_PREGAME / CLOSE pointers.
 * Never fabricates close when missing.
 */
export function deriveClvResearch({
  decisionLine = null,
  decisionPrice = null,
  closeLine = null,
  closePrice = null,
  side = null,
} = {}) {
  const dLine = num(decisionLine);
  const cLine = num(closeLine);
  const dPrice = num(decisionPrice);
  const cPrice = num(closePrice);
  if (cLine == null && cPrice == null) {
    return {
      ok: false,
      reason: "close-unavailable",
      clvLine: null,
      clvPrice: null,
      governance: { ...ACTION_FIREWALL },
    };
  }
  return {
    ok: true,
    side: side || null,
    decisionLine: dLine,
    closeLine: cLine,
    clvLine: dLine == null || cLine == null ? null : dLine - cLine,
    decisionPrice: dPrice,
    closePrice: cPrice,
    clvPrice: dPrice == null || cPrice == null ? null : dPrice - cPrice,
    note: "CLV research only — not wager authority",
    governance: { ...ACTION_FIREWALL },
  };
}

/**
 * Full ACTION research packet from snapshot pointers + book matrix.
 */
export function buildActionMarketResearchPacket({
  open = null,
  current = null,
  decision = null,
  close = null,
  bookRows = [],
  ticketPct = null,
  moneyPct = null,
} = {}) {
  return {
    movement: deriveLineMovement({
      openLine: open?.line,
      currentLine: current?.line,
      openPrice: open?.americanPrice,
      currentPrice: current?.americanPrice,
    }),
    bookDisagreement: deriveBookDisagreement(bookRows),
    publicSplit: derivePublicSplitResearch({ ticketPct, moneyPct }),
    lineShopping: deriveLineShopping(bookRows),
    clv: deriveClvResearch({
      decisionLine: decision?.line,
      decisionPrice: decision?.americanPrice,
      closeLine: close?.line,
      closePrice: close?.americanPrice,
    }),
    firewall: { ...ACTION_FIREWALL },
    canEnterPureGameFeatures: false,
    canEnterPurePlayerFeatures: false,
    canQualify: false,
    canAuthorizeWager: false,
    reasonCodes: [REASON_CODE.ACTION_CANNOT_QUALIFY, REASON_CODE.ACTION_CANNOT_AUTHORIZE],
  };
}
