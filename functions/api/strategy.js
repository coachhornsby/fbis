import {
  STRATEGY_HC_V1,
  STRATEGY_HC_V1_SEED_TICKETS,
  packTicket,
  characterizeTickets,
  strategyStats,
  canonicalSeedTickets,
  strategyReconstruction,
  validateImportedTicket,
  EXPECTED_SEED_N,
  partitionProspectiveTickets,
  dateCT,
} from "../lib/strategy.js";
import { persistStrategy, persistStrategyTicket, queryStrategyTickets, queryCfbStrategySchedule, gradeStrategyTicket, hasDb } from "../lib/store.js";
import { authorizeStrategyPost, unauthorizedBody } from "../lib/auth.js";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function readJson(data, status = 200) {
  return json(data, status, { "access-control-allow-origin": "*" });
}

async function freezeCanonicalSeed(env) {
  await persistStrategy(env, STRATEGY_HC_V1);
  for (const t of STRATEGY_HC_V1_SEED_TICKETS) {
    await persistStrategyTicket(env, t);
    if (t.result && t.result !== "OPEN") {
      await gradeStrategyTicket(env, t.id, {
        result: t.result,
        profit: t.profit,
        clv: t.clv,
        gradedAt: t.gradedAt,
        missingExecutionPrice: true,
      });
    }
  }
}

function reconstructionPayload(seed) {
  const rec = strategyReconstruction(seed);
  return {
    ...rec,
    expectedSeedN: EXPECTED_SEED_N,
    actualRecoveredN: rec.recoveredN,
    reconstructionState: rec.state,
    gradedRecord: rec.gradedRecord,
    recoveredRecord: rec.recoveredRecord,
    settledTicketCount: rec.settledTicketCount,
    reportedRecord: rec.reportedRecord,
    provenance: rec.provenance,
  };
}

export async function onRequestGet(context) {
  const env = { DB: context.env.DB };
  const dbSeed = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "seed" });
  const seed = canonicalSeedTickets(dbSeed.length ? dbSeed : STRATEGY_HC_V1_SEED_TICKETS);
  const rawProspective = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "prospective" });
  const since = new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10);
  const schedules = await queryCfbStrategySchedule(env, since);
  const byGame = new Map(schedules.map((r) => [String(r.game_id), r.event_start]));
  const prospectiveRows = rawProspective.map((t) => {
    const eventStart = t.sport === "cfb" ? byGame.get(String(t.gameId)) : null;
    return eventStart ? { ...t, date: dateCT(eventStart) || eventStart.slice(0, 10), eventStart } : t;
  });
  const prospective = partitionProspectiveTickets(prospectiveRows);
  const rec = reconstructionPayload(seed);
  return readJson({
    strategy: STRATEGY_HC_V1,
    reconstruction: rec,
    expectedSeedN: EXPECTED_SEED_N,
    actualRecoveredN: rec.recoveredN,
    reconstructionState: rec.state,
    gradedRecord: rec.gradedRecord,
    recoveredRecord: rec.recoveredRecord,
    settledTicketCount: rec.settledTicketCount,
    reportedRecord: rec.reportedRecord,
    provenance: rec.provenance,
    namedPositions: STRATEGY_HC_V1_SEED_TICKETS.map((t) => t.pick),
    seed: { tickets: seed, traits: characterizeTickets(seed), stats: strategyStats(seed) },
    prospective: {
      tickets: prospective.upcoming.slice(0, 100),
      upcoming: prospective.upcoming.slice(0, 100),
      completed: prospective.completed.slice(0, 100),
      needsAttention: prospective.needsAttention.slice(0, 100),
      duplicateRowsExcluded: prospective.duplicateRowsExcluded,
      totalCanonical: prospective.canonical.length,
      traits: characterizeTickets(prospective.canonical),
      stats: strategyStats(prospective.canonical),
    },
  });
}

export async function importStrategyTickets(env, bets) {
  const errors = [];
  const accepted = [];
  const conflicts = [];
  if (!hasDb(env)) {
    return { ok: false, status: 503, body: { ok: false, error: "D1 unbound" } };
  }
  await persistStrategy(env, STRATEGY_HC_V1);
  for (const bet of bets) {
    const checked = validateImportedTicket(bet);
    if (!checked.ok) {
      errors.push({ gameId: bet?.gameId || bet?.game_id || null, errors: checked.errors });
      continue;
    }
    const packed = packTicket(checked.ticket, { role: checked.role, date: checked.ticket.date });
    const res = await persistStrategyTicket(env, packed);
    if (res.conflict) {
      conflicts.push({ id: packed.id, reason: res.reason });
      continue;
    }
    if (!res.ok) {
      errors.push({ id: packed.id, errors: [res.reason || "persist"] });
      continue;
    }
    if (bet.result && bet.result !== "OPEN") {
      const graded = await gradeStrategyTicket(env, packed.id, {
        result: bet.result,
        profit: bet.profit,
        clv: bet.clv,
        gradedAt: bet.gradedAt,
        missingExecutionPrice: packed.missingExecutionPrice,
      });
      if (!graded.ok && graded.reason === "settled-immutable") {
        conflicts.push({ id: packed.id, reason: "settled-immutable" });
        continue;
      }
    }
    accepted.push({ id: packed.id, role: packed.role, already: Boolean(res.already) });
  }
  if (errors.length && !accepted.length && !conflicts.length) {
    return {
      ok: false,
      status: 400,
      body: { ok: false, error: "invalid tickets", details: errors },
    };
  }
  const seedRows = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "seed" });
  const rec = reconstructionPayload(canonicalSeedTickets(seedRows));
  const seedAccepted = accepted.filter((x) => x.role === "seed").length;
  if (rec.state === "conflict" || conflicts.length) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "integrity conflict",
        conflicts,
        details: errors,
        seeded: seedAccepted,
        prospective: accepted.filter((x) => x.role === "prospective").length,
        reconstruction: rec,
      },
    };
  }
  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      seeded: seedAccepted,
      prospective: accepted.filter((x) => x.role === "prospective").length,
      accepted: accepted.length,
      details: errors,
      reconstruction: rec,
    },
  };
}

export async function onRequestPost(context) {
  const auth = authorizeStrategyPost(context.request, context.env);
  if (!auth.ok) {
    return json(unauthorizedBody(), 401);
  }
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const bets = Array.isArray(body.bets) ? body.bets : Array.isArray(body) ? body : [];
  const result = await importStrategyTickets({ DB: context.env.DB }, bets);
  return json(result.body, result.status);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
