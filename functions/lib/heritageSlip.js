/**
 * Heritage bet-slip parser. Execution book only — never a recommendation classifier.
 * Parse + preview does not write. Confirm is a separate step.
 */

import { americanProfit, americanToImplied } from "./pricing.js";
import { EXECUTION_BOOK } from "./books.js";
import { todayCT } from "./slateEngine.js";

export const HERITAGE_CLV_METHOD = "pin-novig-v1";
export const RISK_TOLERANCE = 0.02;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

export const HERITAGE_FIXTURE_PASTE = `G10904318 | Aug 27 10:06
Los Angeles Dodgers (Y Yamamoto R) vs Atlanta Braves (C Sale L)
Game / Game Winner / Los Angeles Dodgers (Y Yamamoto R)
Risk: $2.00@ +107
To win: $2.14
Current Line: Los Angeles Dodgers +107
https://www.heritagesports.com/event/198257191

G10904312 | Aug 27 10:06
Arizona Diamondbacks (J Cabrera R) vs San Francisco Giants (L Roupp R)
Game / Game Winner / San Francisco Giants (L Roupp R)
Risk: $2.00@ -103
To win: $1.94
Current Line: San Francisco Giants -103

G10904306 | Aug 27 10:06
Milwaukee Brewers (J Misiorowski R) vs New York Mets (S Manaea L)
Game / Run Line / Milwaukee Brewers -1.5
Risk: $2.00@ -107
To win: $1.87
Current Line: Milwaukee Brewers -1.5 (-107)

G10904299 | Aug 27 10:05
Kansas City Royals (N Cameron L) vs Toronto Blue Jays (Spencer Arrighetti R)
Game / Game Winner / Kansas City Royals (N Cameron L)
Risk: $2.00@ -108
To win: $1.85
Current Line: Kansas City Royals -108

G10902289 | Aug 27 07:30
Colorado Rockies (Gabriel Hughes R) vs Washington Nationals (J Irvin R)
Game / Game Winner / Colorado Rockies (Gabriel Hughes R)
Risk: $2.00@ +109
To win: $2.18
Current Line: Colorado Rockies +126`;

export function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;/gi, "-")
    .replace(/&plus;/gi, "+")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function stripMarkdownLinks(text) {
  return String(text || "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2");
}

export function extractHeritageEventId(text) {
  const m = String(text || "").match(/\/(?:event|events)\/(\d{6,})/i) || String(text || "").match(/\bevent(?:\s*id)?[:\s]+(\d{6,})/i);
  return m ? m[1] : null;
}

export function extractTicketId(text) {
  const m = String(text || "").match(/\bG\d{6,}\b/i);
  return m ? m[0].toUpperCase() : null;
}

export function money(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function americanPrice(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[+,]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) < 100) return null;
  return n;
}

export function pointLine(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[+]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function expectedToWin(risk, price) {
  const r = Number(risk);
  const p = Number(price);
  if (!Number.isFinite(r) || !Number.isFinite(p) || p === 0) return null;
  const raw = p > 0 ? (r * p) / 100 : (r * 100) / Math.abs(p);
  return Math.round(raw * 100) / 100;
}

export function validateRiskToWin(risk, toWin, price) {
  const r = money(risk);
  const w = money(toWin);
  const p = americanPrice(price);
  if (r == null || w == null || p == null) {
    return { ok: false, expected: null, delta: null, warning: "missing prices" };
  }
  const expected = expectedToWin(r, p);
  const delta = Math.abs(expected - w);
  const ok = delta <= RISK_TOLERANCE + 1e-9;
  return {
    ok,
    expected,
    delta,
    warning: ok ? null : `risk/to-win off by $${delta.toFixed(2)} vs ${p > 0 ? "+" : ""}${p} (expected $${expected.toFixed(2)})`,
  };
}

export function normalizeHeritageMarket(label) {
  const raw = String(label || "");
  const s = raw.toLowerCase();
  const f5 = /first\s*5|1st\s*5|f5|first five/i.test(s);
  let market = null;
  if (/game winner|moneyline|\bml\b|winner/.test(s) && !/run line|spread|total/.test(s)) market = "ML";
  else if (/run line|spread|\brl\b/.test(s)) market = "SPREAD";
  else if (/total|over\/under|\bo\/u\b|\bou\b/.test(s)) market = "TOTAL";
  else if (/game winner|winner/.test(s)) market = "ML";
  return {
    original: raw.trim(),
    period: f5 ? "F5" : "FULL_GAME",
    market,
    fbisMarket: market == null ? null : f5 ? (market === "ML" ? "F5 ML" : market === "SPREAD" ? "F5 SPREAD" : "F5 TOTAL") : market,
    unsupported: market == null,
  };
}

export function wallTimeToUtcIso(year, month, day, hour, minute, tz = "America/Chicago") {
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value);
    const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    const wanted = Date.UTC(year, month - 1, day, hour, minute);
    utc += wanted - local;
  }
  return new Date(utc).toISOString();
}

export function parseHeritageTimestamp(raw, yearHint) {
  const s = String(raw || "");
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\s+(\d{1,2}):(\d{2})/);
  if (!m) return { iso: null, date: null, raw: s.trim() };
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3] || yearHint || todayCT().slice(0, 4));
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (!month) return { iso: null, date: null, raw: s.trim() };
  const iso = wallTimeToUtcIso(year, month, day, hour, minute);
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { iso, date, raw: s.trim(), timezone: "America/Chicago" };
}

function stripPitcher(name) {
  return String(name || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePitcher(paren) {
  const inner = String(paren || "").replace(/[()]/g, "").trim();
  if (!inner) return null;
  const hand = /\b([LRS])\b$/i.exec(inner);
  return {
    name: inner.replace(/\b[LRS]\b$/i, "").trim(),
    hand: hand ? hand[1].toUpperCase() : null,
    raw: inner,
  };
}

export function parseCurrentLine(text, market) {
  const s = String(text || "").replace(/^current line:\s*/i, "").trim();
  if (!s) return { team: null, line: null, price: null, raw: "" };
  const priceM = s.match(/([+-]\d{3,5})\s*$/);
  const price = priceM ? americanPrice(priceM[1]) : null;
  let rest = priceM ? s.slice(0, priceM.index).trim() : s;
  rest = rest.replace(/\s*\(\s*([+-]\d{3,5})\s*\)\s*$/, (_, p) => {
    return "";
  }).trim();
  const lineM = rest.match(/([+-]?\d+(?:\.\d+)?)\s*(?:at)?\s*$/i);
  let line = null;
  if (market === "SPREAD" || market === "TOTAL") {
    if (lineM && Math.abs(Number(lineM[1])) < 100) {
      line = pointLine(lineM[1]);
      rest = rest.slice(0, lineM.index).trim();
    }
  }
  const ou = rest.match(/\b(over|under)\b/i);
  return {
    team: stripPitcher(rest) || null,
    sideWord: ou ? ou[1].toUpperCase() : null,
    line,
    price: price || americanPrice((s.match(/([+-]\d{3,5})/) || [])[1]),
    raw: s,
  };
}

export function parseSelection(sel, market) {
  const raw = String(sel || "").trim();
  const cleaned = stripPitcher(raw);
  let line = null;
  let side = null;
  let team = cleaned;
  const ou = cleaned.match(/^(over|under)\s+([+-]?\d+(?:\.\d+)?)/i);
  if (ou) {
    side = ou[1].toUpperCase();
    line = pointLine(ou[2]);
    team = null;
  } else {
    const lm = cleaned.match(/^(.*?)(?:\s+([+-]?\d+(?:\.\d+)?))$/);
    if (lm && market !== "ML" && Math.abs(Number(lm[2])) < 100) {
      team = lm[1].trim();
      line = pointLine(lm[2]);
    }
  }
  return { selectedTeam: team || null, selectedSide: side, executionLine: market === "ML" ? null : line, pickRaw: raw };
}

export function parseHeritageTicket(block, { yearHint } = {}) {
  const cleaned = stripMarkdownLinks(decodeEntities(block)).replace(/\r/g, "").trim();
  const warnings = [];
  const ticketId = extractTicketId(cleaned);
  const sourceEventId = extractHeritageEventId(cleaned);
  const sourceUrl = (cleaned.match(/https?:\/\/\S+/i) || [])[0] || null;
  if (!ticketId) warnings.push("missing ticket ID");

  const ts = parseHeritageTimestamp(cleaned, yearHint);
  const lines = cleaned.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  let matchupLine = lines.find((l) => /\bvs\.?\b/i.test(l) && !/^current line/i.test(l) && !/^g\d+/i.test(l)) || "";
  const vs = matchupLine.split(/\bvs\.?\b/i);
  const listedA = stripPitcher(vs[0] || "");
  const listedB = stripPitcher(vs[1] || "");
  const pitcherA = parsePitcher((matchupLine.match(/\(([^)]+)\)/) || [])[1]);
  const parens = [...matchupLine.matchAll(/\(([^)]+)\)/g)].map((m) => parsePitcher(m[1]));

  const marketLine = lines.find((l) => /game\s*\/|first\s*5|run line|game winner|total/i.test(l)) || "";
  const parts = marketLine.split("/").map((p) => p.trim()).filter(Boolean);
  const marketLabel = parts.slice(0, 2).join(" / ") || marketLine;
  const selectionRaw = parts.slice(2).join(" / ") || parts[1] || "";
  const market = normalizeHeritageMarket(marketLabel + " " + marketLine);

  const riskLine = cleaned.match(/risk:\s*\$?\s*([\d.]+)\s*@\s*([+-]?\d+)/i)
    || cleaned.match(/\$\s*([\d.]+)\s*@\s*([+-]?\d+)/);
  const risk = riskLine ? money(riskLine[1]) : money((cleaned.match(/risk:\s*\$?\s*([\d.]+)/i) || [])[1]);
  const execPrice = riskLine ? americanPrice(riskLine[2]) : americanPrice((cleaned.match(/@\s*([+-]?\d{3,5})/) || [])[1]);
  const toWin = money((cleaned.match(/to win:\s*\$?\s*([\d.]+)/i) || [])[1]);
  const currentRaw = (cleaned.match(/current line:\s*(.+)/i) || [])[1] || "";
  const current = parseCurrentLine(currentRaw, market.market);

  const teams = { away: listedA, home: listedB };
  const sel = parseSelection(selectionRaw || current.team, market.market);
  if (market.market === "ML") sel.executionLine = null;
  if (market.market === "SPREAD" && sel.executionLine == null && current.line != null) sel.executionLine = current.line;

  if (market.unsupported) warnings.push("unsupported market");
  if (execPrice == null) warnings.push("missing prices");
  const riskCheck = validateRiskToWin(risk, toWin, execPrice);
  if (riskCheck.warning) warnings.push(riskCheck.warning);

  const payout = risk != null && toWin != null ? Math.round((risk + toWin) * 100) / 100 : null;

  return {
    externalTicketId: ticketId,
    executionBook: EXECUTION_BOOK,
    executedAt: ts.iso,
    timezone: "America/Chicago",
    date: ts.date,
    sport: "mlb",
    sourceEventId,
    sourceUrl,
    matchupText: `${listedA} vs ${listedB}`.trim(),
    awayTeam: listedA || null,
    homeTeam: listedB || null,
    awayPitcher: parens[0] || pitcherA,
    homePitcher: parens[1] || null,
    marketOriginal: market.original,
    market: market.fbisMarket,
    period: market.period,
    selectedSide: sel.selectedSide === "AMBIGUOUS" ? null : sel.selectedSide,
    selectedTeam: sel.selectedTeam,
    executionLine: sel.executionLine,
    executionPrice: execPrice,
    riskAmount: risk,
    toWinAmount: toWin,
    potentialPayout: payout,
    currency: "USD",
    heritageCurrentLine: current.line,
    heritageCurrentPrice: current.price,
    heritageCurrentRaw: current.raw || null,
    warnings,
    rawText: cleaned,
    parseOk: Boolean(ticketId && execPrice != null && risk != null),
  };
}

export function splitHeritageTickets(text) {
  const cleaned = stripMarkdownLinks(decodeEntities(text)).replace(/\r/g, "");
  const parts = cleaned.split(/(?=^\s*G\d{6,}\b)/im).map((p) => p.trim()).filter(Boolean);
  if (parts.length) return parts;
  const alt = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter((p) => /G\d{6,}/i.test(p));
  return alt;
}

export function parseHeritageSlip(text, opts = {}) {
  const blocks = splitHeritageTickets(text);
  const tickets = blocks.map((b) => parseHeritageTicket(b, opts));
  const seen = new Map();
  for (const t of tickets) {
    const id = t.externalTicketId;
    if (!id) continue;
    if (seen.has(id)) {
      t.warnings = [...(t.warnings || []), "duplicate tickets"];
      t.duplicateInPaste = true;
    } else {
      seen.set(id, t);
      t.duplicateInPaste = false;
    }
  }
  return {
    tickets,
    n: tickets.length,
    totalRisk: round2(tickets.reduce((s, t) => s + (t.riskAmount || 0), 0)),
    totalToWin: round2(tickets.reduce((s, t) => s + (t.toWinAmount || 0), 0)),
    ml: tickets.filter((t) => t.market === "ML").length,
    spread: tickets.filter((t) => t.market === "SPREAD").length,
    total: tickets.filter((t) => t.market === "TOTAL").length,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export async function hashText(text) {
  const data = new TextEncoder().encode(String(text || ""));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function executedBetId(book, ticketId) {
  return `${book || EXECUTION_BOOK}:${String(ticketId || "").toUpperCase()}`;
}

export function strategyMarketOf(ticket) {
  return ticket.market || null;
}

export function fbisSideOf(ticket) {
  if (ticket.selectedSide && ticket.selectedSide !== "AMBIGUOUS") return ticket.selectedSide;
  return null;
}

export function expectedProfit(result, risk, toWin) {
  if (result === "WON") return money(toWin);
  if (result === "LOST") return risk == null ? null : -Math.abs(Number(risk));
  if (result === "PUSH" || result === "VOID") return 0;
  return null;
}
