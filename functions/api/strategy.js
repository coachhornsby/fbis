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
  summarizeProspectiveConvictionCohort,
  classifyProspectiveLifecycle,
} from "../lib/strategy.js";
import { persistStrategy, persistStrategyTicket, queryStrategyTickets, gradeStrategyTicket, hasDb, queryGamesByIds, queryProbabilityCorrections, readMeta } from "../lib/store.js";
import { authorizeStrategyPost, unauthorizedBody } from "../lib/auth.js";
import { resolveTeam } from "../lib/teams.js";
import { durableHealth } from "../lib/jobs.js";
import { deriveHealthState } from "../lib/healthContract.js";
import { populationDescriptor, POPULATION_TYPE } from "../lib/populationDescriptor.js";
import { CONVICTION_PAUSE_MESSAGE, convictionQualificationState } from "../lib/convictionGate.js";
import { RECONSTRUCTION_STATUS, summarizeReconstructions } from "../lib/probabilityReconstruction.js";

const SPORT_ORDER = ["mlb", "nba", "nfl", "cfb", "cbb", "other"];
const SPORT_LABEL = { mlb: "MLB", nba: "NBA", nfl: "NFL", cfb: "CFB", cbb: "CBB", other: "Other" };
const QUALIFICATION_RULE_VERSION = "FBIS-HC-v1";

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

function marketFamily(market = "") {
  const m = String(market || "").toUpperCase();
  if (m.includes("ML")) return "moneyline";
  if (m.includes("SPREAD")) return "spread";
  if (m.includes("TOTAL")) return "total";
  if (m.includes("PROP")) return "player-prop";
  return "other";
}

function periodFamily(market = "") {
  const m = String(market || "").toUpperCase();
  if (m.startsWith("F5")) return "F5";
  if (m.includes("PROP")) return "player-prop";
  return "full-game";
}

function countBy(rows = [], keyFn) {
  const out = {};
  for (const row of rows || []) {
    const key = keyFn(row) || "unknown";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function strategyIntegrity(tickets = []) {
  const unresolved = tickets.filter((t) => String(t.result || "").toUpperCase() === "FINAL NOT MATCHED");
  const pushes = tickets.filter((t) => String(t.result || "").toUpperCase() === "PUSH");
  const voids = tickets.filter((t) => String(t.result || "").toUpperCase() === "VOID");
  const settled = tickets.filter((t) => ["WON", "LOST"].includes(String(t.result || "").toUpperCase()));
  const open = tickets.filter((t) => !t.result || String(t.result || "").toUpperCase() === "OPEN");
  const invalid = tickets.filter((t) => String(t.provenance || t.traits?.provenance || "").toLowerCase() === "invalid");
  const quarantined = tickets.filter((t) => Boolean(t.traits?.quarantineReason));
  return {
    open: open.length,
    settled: settled.length,
    unresolved: unresolved.length,
    pushes: pushes.length,
    voids: voids.length,
    duplicatesExcluded: 0,
    invalid: invalid.length,
    quarantined: quarantined.length,
    breakdowns: {
      sport: countBy(tickets, (t) => t.sport || "unknown"),
      marketFamily: countBy(tickets, (t) => marketFamily(t.market)),
      periodFamily: countBy(tickets, (t) => periodFamily(t.market)),
      modelVersion: countBy(tickets, (t) => t.modelVersion || "unknown"),
      qualificationRuleVersion: countBy(tickets, () => QUALIFICATION_RULE_VERSION),
    },
    mixChecks: {
      sports: Object.keys(countBy(tickets, (t) => t.sport || "unknown")).length,
      marketFamilies: Object.keys(countBy(tickets, (t) => marketFamily(t.market))).length,
      periods: Object.keys(countBy(tickets, (t) => periodFamily(t.market))).length,
      modelVersions: Object.keys(countBy(tickets, (t) => t.modelVersion || "unknown")).length,
      checkpoints: Object.keys(countBy(tickets, (t) => t.checkpoint || "unknown")).length,
    },
  };
}

export async function onRequestGet(context) {
  const env = { DB: context.env.DB };
  const durable = await durableHealth(env);
  const readOk = durable.bound && durable.source === "d1";
  const semantic = deriveHealthState({
    hasAuthoritativeData: readOk,
    requiredChecks: [
      { name: "d1-binding", ok: durable.bound, source: durable.source || "unbound" },
      { name: "d1-read", ok: readOk, source: durable.source || "d1", detail: durable.lastError || null },
    ],
  });
  if (!readOk) {
    return readJson({
      health: {
        state: semantic.state,
        failures: semantic.failures,
        checks: semantic.checks,
        lastD1WriteSuccessAt: durable.lastD1WriteSuccessAt || null,
      },
      strategy: STRATEGY_HC_V1,
      reconstruction: {
        state: "unrecovered",
        expectedN: EXPECTED_SEED_N,
        recoveredN: 0,
        gradedRecord: STRATEGY_HC_V1.reportedRecord,
        reportedRecord: STRATEGY_HC_V1.reportedRecord,
      },
      expectedSeedN: EXPECTED_SEED_N,
      actualRecoveredN: 0,
      authoritativeProspective: false,
      unavailableReason: semantic.failures.map((f) => `${f.name}: ${f.detail || "failed"}`).join(" · "),
      telemetry: {
        endpoint: "/api/strategy",
        requestCount: 1,
        queryCountEstimate: 1,
        rowsReadEstimate: 0,
        cacheStatus: "no-store",
        lastQuotaFailure: semantic.failures.find((f) => f.name === "d1-read")?.detail || null,
      },
    });
  }
  const dbSeed = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "seed" });
  const seed = canonicalSeedTickets(dbSeed);
  const prospectiveRaw = await queryStrategyTickets(env, { strategyId: STRATEGY_HC_V1.id, role: "prospective" });
  const correctionsQ = await queryProbabilityCorrections(env, {
    ticketIds: (prospectiveRaw || []).map((t) => t.id),
  });
  const corrections = correctionsQ.rows || [];
  const latestCorrection = new Map();
  for (const row of corrections) {
    latestCorrection.set(String(row.originalTicketId), row);
  }
  const gameIds = [...new Set([...seed, ...prospectiveRaw].map((t) => t.gameId).filter(Boolean))];
  const gamesQ = await queryGamesByIds(env, gameIds);
  const gameById = new Map((gamesQ.rows || []).map((g) => [String(g.id), g]));
  const prospective = (prospectiveRaw || []).map((t) => presentTicketWithCanonicalMatchup(t, gameById));
  const seedPresented = (seed || []).map((t) => presentTicketWithCanonicalMatchup(t, gameById));
  const prospectiveBySport = groupBySport(prospective);
  const integrity = strategyIntegrity(prospective);
  const mixed =
    integrity.mixChecks?.sports > 1 ||
    integrity.mixChecks?.marketFamilies > 1 ||
    integrity.mixChecks?.periods > 1 ||
    integrity.mixChecks?.modelVersions > 1 ||
    integrity.mixChecks?.checkpoints > 1;
  const rec = reconstructionPayload(seed);
  const now = new Date();
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(y);
  const yCt = `${yParts.find((p) => p.type === "year")?.value}-${yParts.find((p) => p.type === "month")?.value}-${yParts.find((p) => p.type === "day")?.value}`;
  const yesterdayCohort = summarizeProspectiveConvictionCohort(prospective, {
    targetDateCt: yCt,
    expectedN: 7,
    reportedRecord: "5-2",
    reconstructions: [...latestCorrection.values()],
  });
  const meta = await readMeta(env);
  const qualification = convictionQualificationState({ canaryPassed: Boolean(meta.conviction_canary_passed_at) });
  const calculatedTickets = prospective.filter((t) => latestCorrection.get(String(t.id))?.status === RECONSTRUCTION_STATUS.RECOVERED_VERIFIED);
  const reconstructionSummary = summarizeReconstructions(
    (prospectiveRaw || []).map((t) => {
      const rec = latestCorrection.get(String(t.id));
      return {
        status: rec?.status || "STILL_INVALID",
        sport: t.sport,
        market: t.market,
        date: t.date,
        result: t.result,
        clv: t.clv,
      };
    })
  );
  return readJson({
    health: {
      state: semantic.state,
      failures: semantic.failures,
      checks: semantic.checks,
      lastD1WriteSuccessAt: durable.lastD1WriteSuccessAt || null,
    },
    strategy: STRATEGY_HC_V1,
    convictionQualification: qualification,
    convictionPauseMessage: qualification.paused ? CONVICTION_PAUSE_MESSAGE : null,
    historicalProbabilityReconstruction: reconstructionSummary,
    calculatedFbisHcV1: {
      note: "Only RECOVERED_VERIFIED tickets enter calculated historical FBIS-HC-v1 performance.",
      tickets: calculatedTickets,
      stats: strategyStats(calculatedTickets),
      n: calculatedTickets.length,
    },
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
    prospective: {
      tickets: prospective,
      traits: characterizeTickets(prospective),
      stats: mixed ? null : strategyStats(prospective),
      aggregateUnavailable: mixed,
      aggregateReason: mixed ? "mixed-populations-require-breakdown" : null,
      lifecycle: classifyProspectiveLifecycle(prospective),
    },
    prospectiveBySport,
    yesterdayConvictionCohort: {
      ...yesterdayCohort,
      tickets: (yesterdayCohort.tickets || []).map((t) => ({
        ticketId: t.id,
        event: t.matchupDisplay || t.matchup || t.gameId || "—",
        sport: t.sport,
        market: t.market,
        side: t.side,
        line: t.line,
        price: t.executionPrice ?? t.benchmarkPrice ?? t.pinPrice ?? null,
        risk: t.stake ?? null,
        qualificationAt: t.qualifiedAt || null,
        freezeAt: t.qualifiedAt || null,
        eventStart: t.start || null,
        modelVersion: t.modelVersion || null,
        qualificationRuleVersion: QUALIFICATION_RULE_VERSION,
        expectedRoi: t.ev ?? null,
        evidenceCompleteness: t.traits?.quarantineReason ? "partial" : "complete",
        finalResult: t.result || "OPEN",
        profitLoss: t.profit ?? null,
        closingPinnaclePrice: t.closingPrice ?? null,
        clv: t.clv ?? null,
        evAnomalyStatus: t.traits?.quarantineReason ? "quarantined" : "none",
        importedAsHeritageExecution: t.provenance === "verified",
      })),
    },
    integrity,
    authoritativeProspective: semantic.state !== "UNAVAILABLE",
    population: {
      seed: populationDescriptor({
        populationType: POPULATION_TYPE.STRATEGY_TICKET,
        sport: "all",
        marketFamily: "mixed",
        periodFamily: "mixed",
        strategyId: STRATEGY_HC_V1.id,
        strategyVersion: STRATEGY_HC_V1.version,
        modelVersion: null,
        qualificationRuleVersion: "FBIS-HC-v1",
        dateRange: { since: STRATEGY_HC_V1.seedDate, until: STRATEGY_HC_V1.seedDate },
        settledN: Number(seed.filter((t) => t.result === "WON" || t.result === "LOST").length),
        openN: Number(seed.filter((t) => !t.result || t.result === "OPEN").length),
        pushN: Number(seed.filter((t) => t.result === "PUSH").length),
        voidN: Number(seed.filter((t) => t.result === "VOID").length),
        unresolvedN: Number(seed.filter((t) => t.result === "FINAL NOT MATCHED").length),
        clvN: Number(seed.filter((t) => t.clv != null).length),
        sourceHealth: semantic.state,
        freshness: { lastWriteSuccessAt: durable.lastD1WriteSuccessAt || null },
      }),
      prospective: populationDescriptor({
        populationType: POPULATION_TYPE.STRATEGY_TICKET,
        sport: "all",
        marketFamily: "mixed",
        periodFamily: "mixed",
        strategyId: STRATEGY_HC_V1.id,
        strategyVersion: STRATEGY_HC_V1.version,
        modelVersion: null,
        qualificationRuleVersion: "FBIS-HC-v1",
        dateRange: null,
        settledN: Number(prospective.filter((t) => t.result === "WON" || t.result === "LOST").length),
        openN: Number(prospective.filter((t) => !t.result || t.result === "OPEN").length),
        pushN: Number(prospective.filter((t) => t.result === "PUSH").length),
        voidN: Number(prospective.filter((t) => t.result === "VOID").length),
        unresolvedN: Number(prospective.filter((t) => t.result === "FINAL NOT MATCHED").length),
        clvN: Number(prospective.filter((t) => t.clv != null).length),
        sourceHealth: semantic.state,
        freshness: { lastWriteSuccessAt: durable.lastD1WriteSuccessAt || null },
      }),
    },
    telemetry: {
      endpoint: "/api/strategy",
      requestCount: 1,
      queryCountEstimate: 4,
      rowsReadEstimate: Number(seedPresented.length + prospective.length + gameIds.length),
      cacheStatus: "no-store",
      lastQuotaFailure: null,
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
