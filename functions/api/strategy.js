import { STRATEGY_HC_V1, packTicket, ticketMatchesStrategy, inSeedWindow, characterizeTickets, strategyStats } from "../lib/strategy.js";
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

export async function onRequestGet(context) {
  const env = { DB: context.env.DB };
  await persistStrategy(env, STRATEGY_HC_V1);
  const seed = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "seed" });
  const prospective = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "prospective" });
  return json({
    strategy: STRATEGY_HC_V1,
    reconstruction: {
      confidence: seed.length ? "journal" : "unrecovered",
      n: seed.length,
      note: seed.length
        ? "Seeded from the operator journal (localStorage) for 2026-08-26 CT. Immutable."
        : "Exact eight tickets were not in D1 or the repo. They lived in the browser journal. Open SYS once on the machine that logged them to freeze the cohort. Games are not invented.",
    },
    seed: { tickets: seed, traits: characterizeTickets(seed), stats: strategyStats(seed) },
    prospective: { tickets: prospective, traits: characterizeTickets(prospective), stats: strategyStats(prospective) },
  });
}

export async function onRequestPost(context) {
  const env = { DB: context.env.DB };
  await persistStrategy(env, STRATEGY_HC_V1);
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
    const packed = packTicket(bet, {
      role: inSeedWindow(bet.loggedAt || bet.gradedAt) ? "seed" : "prospective",
      date: bet.date,
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
