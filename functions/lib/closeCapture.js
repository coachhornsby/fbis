/**
 * Immutable Pinnacle odds capture and same-side CLV.
 * CLOSE = last valid paired Pin market captured BEFORE scheduled start.
 * Post-kickoff snapshots are stored as rejected and never become close.
 * CLV is independent of W/L.
 */

import { americanToImplied, probabilityClv, twoWayMarket } from "./pricing.js";

export const CLV_UNAVAILABLE =
  "No tickets have both a valid Pinnacle entry and close yet.";

export function isPostStart(capturedAt, start) {
  const cap = Date.parse(capturedAt || "");
  const kick = Date.parse(start || "");
  if (!Number.isFinite(cap) || !Number.isFinite(kick)) return false;
  return cap >= kick;
}

export function marketKey(market) {
  const m = String(market || "").toUpperCase();
  if (m === "ML" || m === "H2H" || m === "MONEYLINE") return "ml";
  if (m === "SPREAD" || m === "RL" || m === "RUNLINE" || m === "F5 SPREAD") return m.startsWith("F5") ? "f5spread" : "spread";
  if (m === "TOTAL" || m === "OU" || m === "F5 TOTAL") return m.startsWith("F5") ? "f5total" : "total";
  if (m === "F5 ML") return "f5ml";
  return m.toLowerCase();
}

export function periodOf(market) {
  return String(market || "").toUpperCase().startsWith("F5") ? "f5" : "fg";
}

function finite(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Pack paired Pinnacle markets from a live game into durable odds rows. */
export function packPinOddsRows(game, { capturedAt = new Date().toISOString(), checkpoint = null } = {}) {
  const start = game?.start || null;
  const rejected = isPostStart(capturedAt, start);
  const sport = game?.sport || null;
  const date = game?.date || null;
  const gameId = String(game?.id || "");
  const eventId = game?.parlayId || null;
  const o = game?.odds || {};
  const pin = game?.pin || {};
  const rows = [];
  const pushPair = (market, period, line, sideA, priceA, noVigA, sideB, priceB, noVigB) => {
    const pair = twoWayMarket(priceA, priceB);
    if (!pair.complete) return;
    const nvA = noVigA ?? pair.noVigA;
    const nvB = noVigB ?? pair.noVigB;
    rows.push({
      gameId,
      sport,
      date,
      book: "Pinnacle",
      market,
      period,
      side: sideA,
      line: line ?? null,
      price: finite(priceA),
      implied: americanToImplied(priceA),
      noVig: nvA,
      capturedAt,
      gameStart: start,
      eventId,
      checkpoint,
      rejectedPostStart: rejected ? 1 : 0,
      paired: 1,
    });
    rows.push({
      gameId,
      sport,
      date,
      book: "Pinnacle",
      market,
      period,
      side: sideB,
      line: market === "spread" || market === "f5spread" ? (line != null ? -Number(line) : null) : line ?? null,
      price: finite(priceB),
      implied: americanToImplied(priceB),
      noVig: nvB,
      capturedAt,
      gameStart: start,
      eventId,
      checkpoint,
      rejectedPostStart: rejected ? 1 : 0,
      paired: 1,
    });
  };

  pushPair("ml", "fg", null, "HOME", o.pinHomeMl, pin.ml?.noVigA, "AWAY", o.pinAwayMl, pin.ml?.noVigB);
  pushPair(
    "spread",
    "fg",
    o.pinSpread ?? (o.pinSpreadHomePrice != null ? o.spread : null),
    "HOME",
    o.pinSpreadHomePrice,
    pin.spread?.noVigA,
    "AWAY",
    o.pinSpreadAwayPrice,
    pin.spread?.noVigB
  );
  pushPair(
    "total",
    "fg",
    o.pinTotal ?? (o.pinOverPrice != null ? o.total : null),
    "OVER",
    o.pinOverPrice,
    pin.total?.noVigA,
    "UNDER",
    o.pinUnderPrice,
    pin.total?.noVigB
  );
  const f5 = o.f5 || {};
  pushPair("f5ml", "f5", null, "HOME" , f5.homeMl, pin.f5ml?.noVigA, "AWAY", f5.awayMl, pin.f5ml?.noVigB);
  pushPair("f5total", "f5", f5.total, "OVER", f5.overPrice, pin.f5total?.noVigA, "UNDER", f5.underPrice, pin.f5total?.noVigB);

  return {
    rows,
    rejectedPostStart: rejected,
    capturedAt,
    start,
  };
}

export function validCloseRow(row, start) {
  if (!row || row.rejectedPostStart) return false;
  if (row.noVig == null || row.price == null) return false;
  if (isPostStart(row.capturedAt, start || row.gameStart)) return false;
  return true;
}

/**
 * Last valid same-market/period/side Pin row before start.
 * Different lines are returned with sameLine=false — never coerced into a fake CLV.
 */
export function selectClose(snapshots, { start, market, period, side, entryLine } = {}) {
  const mkt = marketKey(market);
  const per = period || periodOf(market);
  const sideKey = String(side || "").toUpperCase();
  const eligible = (snapshots || []).filter((r) => {
    if (marketKey(r.market) !== mkt) return false;
    if ((r.period || periodOf(r.market)) !== per) return false;
    if (String(r.side || "").toUpperCase() !== sideKey) return false;
    return validCloseRow(r, start);
  });
  eligible.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  const last = eligible.at(-1) || null;
  if (!last) return { close: null, reason: "missing-close" };
  const entry = finite(entryLine);
  const closeLine = finite(last.line);
  const sameLine = entry == null || closeLine == null || entry === closeLine;
  return {
    close: last,
    sameLine,
    entryLine: entry,
    closeLine,
    lineMovement: entry != null && closeLine != null ? closeLine - entry : null,
    reason: sameLine ? null : "line-mismatch",
  };
}

/** Latest valid paired Pin snapshot at or before `at`, never at/after kickoff. */
export function selectPinAtOrBefore(snapshots, { at, start, market, period, side, line } = {}) {
  const mkt = marketKey(market);
  const per = period === "F5" || period === "f5" ? "f5" : period || periodOf(market);
  const sideKey = String(side || "").toUpperCase();
  const cutoff = Date.parse(at || "");
  const eligible = (snapshots || []).filter((r) => {
    if (marketKey(r.market) !== mkt) return false;
    if ((r.period || periodOf(r.market)) !== per) return false;
    if (String(r.side || "").toUpperCase() !== sideKey) return false;
    if (!validCloseRow(r, start)) return false;
    const cap = Date.parse(r.capturedAt || "");
    if (Number.isFinite(cutoff) && Number.isFinite(cap) && cap > cutoff) return false;
    const want = finite(line);
    const have = finite(r.line);
    if (want != null && have != null && want !== have) return false;
    return true;
  });
  eligible.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
  return eligible.at(-1) || null;
}

export function clvForTicket(ticket, snapshots) {
  const entryNoVig = finite(ticket.entryNoVig ?? ticket.entry_no_vig ?? ticket.implied);
  const entryPrice = finite(ticket.pinPrice ?? ticket.pin_price ?? ticket.benchmarkPrice ?? ticket.benchmark_price);
  const entryLine = finite(ticket.line ?? ticket.benchmarkLine ?? ticket.benchmark_line);
  const start = ticket.start || ticket.gameStart || null;
  if (entryNoVig == null) {
    return {
      clv: null,
      sameLine: null,
      missingEntry: true,
      missingClose: false,
      entry: { noVig: null, price: entryPrice, line: entryLine, at: ticket.qualifiedAt || ticket.createdAt || null },
      close: null,
    };
  }
  const picked = selectClose(snapshots, {
    start,
    market: ticket.market,
    period: periodOf(ticket.market),
    side: ticket.side,
    entryLine,
  });
  const close = picked.close;
  if (!close) {
    return {
      clv: null,
      sameLine: null,
      missingEntry: false,
      missingClose: true,
      reason: picked.reason,
      entry: { noVig: entryNoVig, price: entryPrice, line: entryLine, at: ticket.qualifiedAt || ticket.createdAt || null },
      close: null,
    };
  }
  const closeNoVig = finite(close.noVig);
  const clv = picked.sameLine ? probabilityClv(entryNoVig, closeNoVig) : null;
  return {
    clv,
    sameLine: picked.sameLine,
    missingEntry: false,
    missingClose: false,
    reason: picked.reason,
    lineMovement: picked.lineMovement,
    priceMovement:
      entryPrice != null && close.price != null ? Number(close.price) - entryPrice : null,
    entry: { noVig: entryNoVig, price: entryPrice, line: entryLine, at: ticket.qualifiedAt || ticket.createdAt || null },
    close: {
      noVig: closeNoVig,
      price: close.price,
      line: picked.closeLine,
      at: close.capturedAt,
    },
  };
}

function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function groupAvg(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r.clv);
  }
  return [...map.entries()]
    .map(([key, vals]) => ({ key, n: vals.length, avg: mean(vals) }))
    .sort((a, b) => b.n - a.n);
}

export function clvTracker(tickets, snapshotsByGame = {}) {
  const list = tickets || [];
  const measured = [];
  let missingEntry = 0;
  let missingClose = 0;
  let lineMismatch = 0;
  let marketMismatch = 0;
  let postStartRejected = 0;
  for (const t of list) {
    const snaps = snapshotsByGame[String(t.gameId || t.game_id || "")] || [];
    postStartRejected += snaps.filter((s) => s.rejectedPostStart || isPostStart(s.capturedAt, t.start || s.gameStart)).length;
    const row = clvForTicket(t, snaps);
    if (row.missingEntry) missingEntry += 1;
    else if (row.missingClose) missingClose += 1;
    else if (row.reason === "line-mismatch") lineMismatch += 1;
    else if (row.reason === "market-mismatch") marketMismatch += 1;
    if (row.clv != null) measured.push({ ...t, ...row });
  }
  const vals = measured.map((r) => r.clv);
  const n = vals.length;
  const unavailable = n === 0;
  const rolling = (size) => {
    if (vals.length < Math.min(size, 5)) return { value: null, n: 0 };
    const slice = vals.slice(-size);
    return { value: mean(slice), n: slice.length };
  };
  return {
    n,
    unavailable,
    message: unavailable ? CLV_UNAVAILABLE : null,
    avg: unavailable ? null : mean(vals),
    median: unavailable ? null : median(vals),
    positiveShare: unavailable ? null : vals.filter((v) => v > 0).length / n,
    tickets: list.length,
    validEntry: list.length - missingEntry,
    validClose: list.filter((t) => {
      const snaps = snapshotsByGame[String(t.gameId || t.game_id || "")] || [];
      return Boolean(selectClose(snaps, { start: t.start, market: t.market, period: periodOf(t.market), side: t.side }).close);
    }).length,
    validClv: n,
    missingEntry,
    missingClose,
    lineMismatch,
    marketMismatch,
    postStartRejected,
    coveragePct: list.length ? n / list.length : null,
    bySport: groupAvg(measured, (r) => r.sport),
    byMarket: groupAvg(measured, (r) => r.market),
    byStrategy: groupAvg(measured, (r) => r.strategyId || r.strategy_id || "FBIS-HC-v1"),
    byModelVersion: groupAvg(measured, (r) => r.modelVersion || r.model_version),
    byCheckpoint: groupAvg(measured, (r) => r.checkpoint),
    rolling25: rolling(25),
    rolling50: rolling(50),
    rolling100: rolling(100),
    definition: "Positive CLV = closing no-vig − entry no-vig for the selected side. Market moved toward the position.",
    rows: measured,
  };
}

export function closeCoverage(tickets, snapshotsByGame = {}) {
  const list = tickets || [];
  let valid = 0;
  let missing = 0;
  let lineMismatch = 0;
  let marketMismatch = 0;
  let postStart = 0;
  for (const t of list) {
    const snaps = snapshotsByGame[String(t.gameId || t.game_id || "")] || [];
    postStart += snaps.filter((s) => s.rejectedPostStart).length;
    const picked = selectClose(snaps, {
      start: t.start,
      market: t.market,
      period: periodOf(t.market),
      side: t.side,
      entryLine: t.line,
    });
    if (picked.reason === "line-mismatch") lineMismatch += 1;
    if (picked.reason === "market-mismatch") marketMismatch += 1;
    if (picked.close && picked.sameLine) valid += 1;
    else missing += 1;
  }
  return {
    ticketsRequiringClose: list.length,
    validCloses: valid,
    missingCloses: missing,
    lineMismatch,
    marketMismatch,
    postStartRejected: postStart,
    coveragePct: list.length ? valid / list.length : null,
  };
}
