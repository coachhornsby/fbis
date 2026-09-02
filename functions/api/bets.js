/**
 * Heritage bet-slip parse / import.
 * Parse is preview-only (no D1 write). Import/correct from the operator board are
 * same-origin. Scripts may still send x-harvest-secret. GET never returns raw_text.
 * HARVEST_SECRET is never bundled into the browser app.
 */

import { parseHeritageSlip } from "../lib/heritageSlip.js";
import { todayCT } from "../lib/slateEngine.js";
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
  pingDb,
} from "../lib/store.js";
import { authorizeExecutedBetWrite, unauthorizedBody } from "../lib/auth.js";
import { durableHealth, scheduledHealth } from "../lib/jobs.js";
import { deriveHealthState, writeVerificationState } from "../lib/healthContract.js";
import { populationDescriptor, POPULATION_TYPE } from "../lib/populationDescriptor.js";

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
  const ping = await pingDb(env);
  const q = ping.ok
    ? await queryExecutedBets(env, { date: date || undefined, sport: sport || undefined, includeRaw: false })
    : { ok: false, reason: ping.reason || "d1-unavailable", rows: [] };
  const rows = q.rows || [];
  const durable = await durableHealth(env);
  const schedule = scheduledHealth(durable, new Date());
  const readOk = q.ok === true;
  const writeVerification = writeVerificationState({
    readOk,
    lastWriteSuccessAt: durable.lastD1WriteSuccessAt || null,
    lastReadbackSuccessAt: durable.lastD1ReadbackSuccessAt || durable.lastD1WriteSuccessAt || null,
    lastFailureAt: durable.lastD1FailureAt || durable.lastFailedCollectAt || durable.lastFailedHarvestAt || null,
    failedWrites: Number(durable.failedWrites || 0) + Number(durable.failedHarvests || 0),
    reason: q.reason || durable.lastError || "",
  });
  const writeOk = writeVerification === "VERIFIED";
  const semantic = deriveHealthState({
    hasAuthoritativeData: readOk,
    requiredChecks: [
      { name: "d1-binding", ok: hasDb(env), source: hasDb(env) ? "d1" : "unbound" },
      { name: "d1-read", ok: readOk, source: readOk ? "d1" : "d1-error", detail: q.reason || null },
      { name: "d1-write", ok: writeOk, source: "d1", detail: `failedWrites=${Number(durable.failedWrites || 0)}` },
      {
        name: "scheduled-collect",
        ok: schedule?.collect?.state === "healthy",
        source: "d1",
        detail: schedule?.collect?.state || "unknown",
        lastSuccessAt: durable.lastScheduledCollectSuccessAt || null,
        freshnessMs: 8 * 60 * 60 * 1000,
      },
      {
        name: "scheduled-harvest",
        ok: schedule?.harvest?.state === "healthy",
        source: "d1",
        detail: schedule?.harvest?.state || "unknown",
        lastSuccessAt: durable.lastScheduledHarvestSuccessAt || null,
        freshnessMs: 8 * 60 * 60 * 1000,
      },
    ],
  });
  return {
    ok: q.ok || hasDb(env),
    state: semantic.state,
    authoritativeSummary: semantic.state !== "UNAVAILABLE",
    d1: readOk ? "healthy" : q.reason || "error",
    d1Status: {
      binding: hasDb(env) ? "bound" : "unbound",
      read: readOk ? "healthy" : "failed",
      write: writeOk ? "healthy" : "degraded",
      writeVerification,
      source: readOk ? "d1" : (durable.source || (hasDb(env) ? "d1" : "unbound")),
      lastSuccessfulReadAt: durable.lastCollectSuccessAt || null,
      lastSuccessfulWriteAt: durable.lastD1WriteSuccessAt || null,
      lastSuccessfulReadbackAt: durable.lastD1ReadbackSuccessAt || null,
      lastFailureAt: durable.lastD1FailureAt || null,
      failedWrites: Number(durable.failedWrites || 0),
      failedHarvests: Number(durable.failedHarvests || 0),
      schedule,
      failures: semantic.failures,
      checks: semantic.checks,
    },
    bets: rows,
    summary: summarizeExecutedBets(rows),
    population: populationDescriptor({
      populationType: POPULATION_TYPE.IMPORTED_HERITAGE_EXECUTION,
      sport: sport || "all",
      marketFamily: "mixed",
      periodFamily: "mixed",
      dateRange: date ? { since: date, until: date } : null,
      settledN: Number(rows.filter((r) => r.result === "WON" || r.result === "LOST").length),
      openN: Number(rows.filter((r) => !r.result || r.result === "OPEN").length),
      pushN: Number(rows.filter((r) => r.result === "PUSH").length),
      voidN: Number(rows.filter((r) => r.result === "VOID").length),
      unresolvedN: Number(rows.filter((r) => String(r.matchStatus || "").toLowerCase() !== "matched").length),
      clvN: Number(rows.filter((r) => r.clv != null).length),
      sourceHealth: semantic.state,
      freshness: {
        lastReadSuccessAt: durable.lastCollectSuccessAt || null,
        lastWriteSuccessAt: durable.lastD1WriteSuccessAt || null,
      },
    }),
    auth: {
      write: "same-origin board, or header x-strategy-secret / x-harvest-secret",
      session: false,
      limitation: "Confirm from the FBIS site does not paste HARVEST_SECRET. Collect and strategy POST still require the Pages secret. Parse/preview does not write.",
    },
    telemetry: {
      endpoint: "/api/bets",
      requestCount: 1,
      queryCountEstimate: ping.ok ? 3 : 1,
      rowsReadEstimate: (rows || []).length,
      dateRange: date ? { since: date, until: date } : { since: null, until: null },
      cacheStatus: "no-store",
      lastQuotaFailure: ping.ok ? null : (ping.reason || null),
    },
  };
}

function heritageDateWindow(tickets) {
  const dates = [...new Set((tickets || []).map((t) => t.date).filter(Boolean))].sort();
  const today = todayCT();
  const since = dates[0] || today;
  const until = dates.at(-1) || since;
  return { since, until };
}

async function loadMatchContext(env, tickets) {
  const { since, until } = heritageDateWindow(tickets);
  const gamesQ = await queryGames(env, { since });
  const seen = new Set();
  const unique = [];
  for (const g of gamesQ.rows || []) {
    if (g.date && g.date > until) continue;
    const k = `${g.sport}:${g.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(g);
  }
  const existing = await queryExecutedBets(env, { includeRaw: false });
  const snapshots = await querySnapshots(env, { since, until, lite: true });
  const odds = await queryOddsSnapshots(env, { since, until });
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
  const auth = authorizeExecutedBetWrite(request, env);
  if (!auth.ok) {
    return { status: 401, body: unauthorizedBody() };
  }
  if (action === "import") {
    let tickets = Array.isArray(body.tickets) ? body.tickets : [];
    const slip = String(body.text || body.slip || "");
    if (!tickets.length && slip.trim()) {
      const preview = await parseBetsPreview(env, slip, body.yearHint);
      tickets = preview.tickets || [];
    }
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
  try {
    const url = new URL(context.request.url);
    const payload = await handleBetsGet({ DB: context.env.DB }, url);
    return json(payload, 200, { "access-control-allow-origin": "*" });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500, { "access-control-allow-origin": "*" });
  }
}

export async function onRequestPost(context) {
  try {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
      return json({ ok: false, error: "invalid json" }, 400, { "access-control-allow-origin": "*" });
    }
    const result = await handleBetsPost(
      { DB: context.env.DB, STRATEGY_IMPORT_SECRET: context.env.STRATEGY_IMPORT_SECRET, HARVEST_SECRET: context.env.HARVEST_SECRET },
      context.request,
      body
    );
    return json(result.body, result.status, { "access-control-allow-origin": "*" });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err), wrote: false }, 500, { "access-control-allow-origin": "*" });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-strategy-secret,x-harvest-secret",
    },
  });
}
