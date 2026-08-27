import {
  STRATEGY_HC_V1,
  STRATEGY_HC_V1_SEED_TICKETS,
  packTicket,
  ticketMatchesStrategy,
  inSeedWindow,
  characterizeTickets,
  strategyStats,
  ticketId,
  dateCT,
  isCanonicalSeedId,
  canonicalSeedTickets,
  strategyReconstruction,
} from "../lib/strategy.js";
import { persistStrategy, persistStrategyTicket, queryStrategyTickets, gradeStrategyTicket } from "../lib/store.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
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
      });
    }
  }
}

export async function onRequestGet(context) {
  const env = { DB: context.env.DB };
  await freezeCanonicalSeed(env);
  const dbSeed = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "seed" });
  const seed = canonicalSeedTickets(dbSeed);
  const prospective = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "prospective" });
  return json({
    strategy: STRATEGY_HC_V1,
    reconstruction: strategyReconstruction(),
    seed: { tickets: seed, traits: characterizeTickets(seed), stats: strategyStats(seed) },
    prospective: { tickets: prospective, traits: characterizeTickets(prospective), stats: strategyStats(prospective) },
  });
}

export async function onRequestPost(context) {
  const env = { DB: context.env.DB };
  await freezeCanonicalSeed(env);
  let body = {};
  try {
    body = await context.request.json();
  } catch {
    body = {};
  }
  const bets = Array.isArray(body.bets) ? body.bets : [];
  const seeded = [];
  const prospective = [];
  for (const bet of bets) {
    if (!ticketMatchesStrategy(bet)) continue;
    const day = bet.date || dateCT(bet.loggedAt || bet.gradedAt);
    const id = ticketId(bet, day);
    const packed = packTicket(bet, {
      role: inSeedWindow(bet.loggedAt || bet.gradedAt || bet.date) && isCanonicalSeedId(id) ? "seed" : "prospective",
      date: day,
    });
    const res = await persistStrategyTicket(env, packed);
    if (packed.role === "seed") seeded.push({ id: packed.id, ok: res.ok });
    else prospective.push({ id: packed.id, ok: res.ok });
    if (bet.result && bet.result !== "OPEN") {
      await gradeStrategyTicket(env, packed.id, {
        result: bet.result,
        profit: bet.profit,
        clv: bet.clv,
        gradedAt: bet.gradedAt,
      });
    }
  }
  return json({ ok: true, seeded: seeded.length, prospective: prospective.length });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
