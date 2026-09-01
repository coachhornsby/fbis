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
  gradeStrategyResult,
} from "../lib/strategy.js";
import { persistStrategy, persistStrategyTicket, queryStrategyTickets, gradeStrategyTicket, hasDb, queryGames } from "../lib/store.js";
import { authorizeStrategyPost, unauthorizedBody } from "../lib/auth.js";
import { resolveTeam } from "../lib/teams.js";
import { resolveFinalForTicket } from "../lib/projLedger.js";
import { fetchResultsForReconcile, shiftDateCT, todayCT } from "../lib/slateEngine.js";

const SPORT_ORDER = ["mlb", "nba", "nfl", "cfb", "cbb", "other"];
const SPORT_LABEL = { mlb: "MLB", nba: "NBA", nfl: "NFL", cfb: "CFB", cbb: "CBB", other: "Other" };

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

function splitMatchup(matchup = "") {
  const m = String(matchup || "").split("@");
  if (m.length !== 2) return { away: null, home: null };
  return { away: m[0].trim(), home: m[1].trim() };
}

function canonicalTeamName(sport, raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const hit = resolveTeam(sport || "mlb", {
    name: value,
    displayName: value,
    school: value,
    fullName: value,
    abbr: value,
  });
  return hit?.displayName || hit?.school || value;
}

function presentTicketWithCanonicalMatchup(ticket, gameById) {
  const fromGame = gameById.get(String(ticket.gameId || ""));
  const parsed = splitMatchup(ticket.matchup);
  const away = canonicalTeamName(ticket.sport, fromGame?.away?.name || parsed.away);
  const home = canonicalTeamName(ticket.sport, fromGame?.home?.name || parsed.home);
  const matchupDisplay = away && home ? `${away} @ ${home}` : ticket.matchup || ticket.gameId || "—";
  return {
    ...ticket,
    matchupDisplay,
    matchupSource: fromGame ? "games-table" : "ticket",
    start: fromGame?.start || null,
  };
}

function groupBySport(tickets = []) {
  const buckets = new Map();
  for (const t of tickets || []) {
    const sport = SPORT_ORDER.includes(t.sport) ? t.sport : "other";
    if (!buckets.has(sport)) buckets.set(sport, []);
    buckets.get(sport).push(t);
  }
  return SPORT_ORDER
    .filter((sport) => buckets.has(sport))
    .map((sport) => {
      const rows = buckets.get(sport) || [];
      return {
        sport,
        label: SPORT_LABEL[sport] || String(sport).toUpperCase(),
        tickets: rows,
        stats: strategyStats(rows),
        traits: characterizeTickets(rows),
      };
    });
}

async function reconcileOpenStrategyGrades(env) {
  const rows = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id });
  const open = (rows || []).filter((t) => !t.result || t.result === "OPEN");
  if (!open.length) return { checked: 0, graded: 0 };
  const today = todayCT();
  const floor = shiftDateCT(today, -4);
  const pendingWindow = open.filter((t) => t?.sport && t?.date && t.date < today && t.date >= floor);
  if (!pendingWindow.length) return { checked: open.length, graded: 0 };
  const bySportDate = new Map();
  for (const t of pendingWindow) {
    bySportDate.set(`${t.sport}|${t.date}`, { sport: t.sport, date: t.date });
  }
  const keys = [...bySportDate.values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 6);
  const fetched = await Promise.all(
    keys.map(async ({ sport, date }) => {
      try {
        const rowsForDay = await fetchResultsForReconcile(sport, date, { cfbdApiKey: env.CFBD_API_KEY });
        return (rowsForDay || []).filter((g) => g?.status?.completed);
      } catch {
        return [];
      }
    })
  );
  const finals = fetched.flat();
  let graded = 0;
  for (const ticket of pendingWindow) {
    const final = resolveFinalForTicket(ticket, finals);
    const settled = gradeStrategyResult(ticket, final);
    if (!settled) continue;
    const out = await gradeStrategyTicket(env, ticket.id, settled);
    if (out?.ok) graded += 1;
  }
  return { checked: open.length, graded };
}

export async function onRequestGet(context) {
  const env = { DB: context.env.DB, CFBD_API_KEY: context.env.CFBD_API_KEY };
  await freezeCanonicalSeed(env);
  await reconcileOpenStrategyGrades(env);
  const dbSeed = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "seed" });
  const seed = canonicalSeedTickets(dbSeed);
  const prospectiveRaw = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "prospective" });
  const minDate = [...seed, ...prospectiveRaw].map((t) => t.date).filter(Boolean).sort()[0] || STRATEGY_HC_V1.seedDate;
  const gamesQ = await queryGames(env, { since: minDate });
  const gameById = new Map((gamesQ.rows || []).map((g) => [String(g.id), g]));
  const prospective = (prospectiveRaw || []).map((t) => presentTicketWithCanonicalMatchup(t, gameById));
  const seedPresented = (seed || []).map((t) => presentTicketWithCanonicalMatchup(t, gameById));
  const prospectiveBySport = groupBySport(prospective);
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
    seed: { tickets: seedPresented, traits: characterizeTickets(seedPresented), stats: strategyStats(seedPresented) },
    prospective: { tickets: prospective, traits: characterizeTickets(prospective), stats: strategyStats(prospective) },
    prospectiveBySport,
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
