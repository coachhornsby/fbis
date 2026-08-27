/**
 * Heritage bet-slip parse / import.
 * Parse is preview-only (no D1 write). Import/correct require operator secret header.
 * GET never returns raw_text. No session cookies — secret is server-mediated via
 * x-strategy-secret / x-harvest-secret. Secret is never bundled into the browser app.
 */

import { parseHeritageSlip } from "../lib/heritageSlip.js";
import {
  decoratePreview,
  packExecutedBetRow,
  summarizeExecutedBets,
  settleExecutedBet,
} from "../lib/executedBets.js";
import {
  queryExecutedBets,
  persistExecutedBet,
  updateExecutedBet,
  queryGames,
  querySnapshots,
  queryStrategyTickets,
  queryOddsSnapshots,
  hasDb,
} from "../lib/store.js";
import { authorizeStrategyPost, unauthorizedBody } from "../lib/auth.js";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

export async function handleBetsGet(env, url) {
  const date = url.searchParams.get("date") || "";
  const sport = url.searchParams.get("sport") || "";
  const q = await queryExecutedBets(env, { date: date || undefined, sport: sport || undefined, includeRaw: false });
  const rows = q.rows || [];
  return {
    ok: q.ok || hasDb(env),
    d1: hasDb(env) ? "connected" : q.reason || "unbound",
    bets: rows,
    summary: summarizeExecutedBets(rows),
    auth: {
      write: "header x-strategy-secret or x-harvest-secret",
      session: false,
      limitation: "No browser session. Writes are server-mediated with the operator secret header. Parse/preview does not require a secret and does not write.",
    },
  };
}

async function loadMatchContext(env, tickets) {
  const dates = [...new Set(tickets.map((t) => t.date).filter(Boolean))];
  const since = dates.length ? dates.sort()[0] : null;
  const gamesQ = await queryGames(env, { since });
  const extra = [];
  for (const d of dates) {
    if (since && d === since) continue;
    const q = await queryGames(env, { date: d });
    extra.push(...(q.rows || []));
  }
  const games = [...(gamesQ.rows || []), ...extra];
  const seen = new Set();
  const unique = [];
  for (const g of games) {
    const k = `${g.sport}:${g.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(g);
  }
  const existing = await queryExecutedBets(env, { includeRaw: false });
  const snapshots = await querySnapshots(env, { since: since || undefined });
  const odds = await queryOddsSnapshots(env, { since: since || undefined });
  const strategyTickets = await queryStrategyTickets(env, {});
  return {
    games: unique,
    existing: existing.rows || [],
    snapshots: snapshots.rows || [],
    odds: odds.rows || [],
    strategyTickets: strategyTickets || [],
  };
}

export async function parseBetsPreview(env, text, yearHint) {
  const parsed = parseHeritageSlip(text, { yearHint });
  const ctx = await loadMatchContext(env, parsed.tickets);
  const tickets = [];
  for (const t of parsed.tickets) {
    tickets.push(
      await decoratePreview(t, {
        games: ctx.games,
        existing: ctx.existing,
        snapshots: ctx.snapshots,
        oddsSnapshots: ctx.odds,
        strategyTickets: ctx.strategyTickets,
      })
    );
  }
  return {
    ok: true,
    wrote: false,
    n: tickets.length,
    totalRisk: parsed.totalRisk,
    totalToWin: parsed.totalToWin,
    ml: tickets.filter((t) => t.market === "ML" || t.market === "F5 ML").length,
    spread: tickets.filter((t) => t.market === "SPREAD" || t.market === "F5 SPREAD").length,
    total: tickets.filter((t) => t.market === "TOTAL" || t.market === "F5 TOTAL").length,
    tickets,
    summary: summarizeExecutedBets(tickets),
  };
}

export async function importBets(env, tickets) {
  if (!hasDb(env)) return { ok: false, status: 503, body: { ok: false, error: "D1 unbound" } };
  const accepted = [];
  const skipped = [];
  const conflicts = [];
  const errors = [];
  for (const raw of tickets || []) {
    const packed = packExecutedBetRow(raw);
    if (!packed.externalTicketId) {
      errors.push({ id: packed.id, errors: ["missing ticket ID"] });
      continue;
    }
    const res = await persistExecutedBet(env, packed);
    if (res.conflict) {
      conflicts.push({ id: packed.id, externalTicketId: packed.externalTicketId, reason: res.reason, existing: res.existing });
      continue;
    }
    if (!res.ok) {
      errors.push({ id: packed.id, errors: [res.reason || "persist"] });
      continue;
    }
    if (res.already) {
      skipped.push({ id: packed.id, externalTicketId: packed.externalTicketId, reason: "idempotent-identical" });
      continue;
    }
    accepted.push({ id: packed.id, externalTicketId: packed.externalTicketId });
  }
  const listed = await queryExecutedBets(env, { includeRaw: false });
  return {
    ok: errors.length === 0 && conflicts.length === 0,
    status: conflicts.length ? 409 : errors.length ? 400 : 200,
    body: {
      ok: errors.length === 0 && conflicts.length === 0,
      wrote: true,
      accepted,
      skipped,
      conflicts,
      errors,
      summary: summarizeExecutedBets(listed.rows || []),
    },
  };
}

export async function handleBetsPost(env, request, body) {
  const action = String(body?.action || "").toLowerCase();
  if (action === "parse" || action === "preview") {
    const text = String(body.text || body.slip || "");
    if (!text.trim()) return { status: 400, body: { ok: false, error: "empty slip", wrote: false } };
    const preview = await parseBetsPreview(env, text, body.yearHint);
    return { status: 200, body: preview };
  }
  const auth = authorizeStrategyPost(request, env);
  if (!auth.ok) {
    return { status: 401, body: unauthorizedBody() };
  }
  if (action === "import") {
    const tickets = Array.isArray(body.tickets) ? body.tickets : [];
    if (!tickets.length) return { status: 400, body: { ok: false, error: "no tickets to import", wrote: false } };
    const result = await importBets(env, tickets);
    return { status: result.status, body: result.body };
  }
  if (action === "correct") {
    if (!hasDb(env)) return { status: 503, body: { ok: false, error: "D1 unbound" } };
    const id = body.id;
    const patch = body.patch || {};
    const allowed = [
      "gameId",
      "selectedSide",
      "matchStatus",
      "result",
      "profit",
      "settledReturn",
      "voidReason",
      "gradedAt",
    ];
    const next = {};
    for (const k of allowed) if (k in patch) next[k] = patch[k];
    if (next.result) {
      const existingQ = await queryExecutedBets(env, { includeRaw: false });
      const existing = (existingQ.rows || []).find((r) => r.id === id);
      if (existing) {
        const settled = settleExecutedBet({ ...existing, result: next.result, riskAmount: existing.riskAmount, toWinAmount: existing.toWinAmount, potentialPayout: existing.potentialPayout }, null);
        if (next.result === "WON" || next.result === "LOST" || next.result === "PUSH" || next.result === "VOID") {
          next.profit = next.profit ?? (next.result === "WON" ? existing.toWinAmount : next.result === "LOST" ? -Math.abs(existing.riskAmount) : 0);
          next.settledReturn = next.settledReturn ?? (next.result === "WON" ? existing.potentialPayout : next.result === "LOST" ? 0 : existing.riskAmount);
          next.gradedAt = next.gradedAt || new Date().toISOString();
        }
        void settled;
      }
    }
    const res = await updateExecutedBet(env, id, next, "correction");
    return { status: res.ok ? 200 : 400, body: { ok: res.ok, error: res.reason || null } };
  }
  return { status: 400, body: { ok: false, error: "unknown action" } };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const payload = await handleBetsGet({ DB: context.env.DB }, url);
  return json(payload, 200, { "access-control-allow-origin": "*" });
}

export async function onRequestPost(context) {
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const result = await handleBetsPost({ DB: context.env.DB, STRATEGY_IMPORT_SECRET: context.env.STRATEGY_IMPORT_SECRET, HARVEST_SECRET: context.env.HARVEST_SECRET }, context.request, body);
  return json(result.body, result.status);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-strategy-secret,x-harvest-secret",
    },
  });
}
