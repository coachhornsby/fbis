/**
 * Action/Apify production-candidate domain helpers.
 *
 * Shadow/candidate only — never authoritative odds, never wager authorization.
 * Extends the research shadow adapter with matching confidence, book/market
 * canonicalization, schema-drift, cost breakdown, and idempotent keys.
 */

import { sha256Hex } from "./sha256Hex.js";
import {
  ACTION_APIFY_PRICING_USD,
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_SCHEMA_VERSION,
  ACTION_APIFY_SOURCE_CLASS,
  americanToImpliedProb,
  assertActionApifyNotInProductionRouter,
  estimateActorCostUsd,
  hashPayload,
  matchShadowEvent,
  noVigTwoWay,
  normalizeActionGameRow,
  normalizeBookKey,
} from "./actionApifyShadow.js";
import {
  MATCH_CONFIDENCE,
  SCHEMA_DRIFT_LEVELS,
  TEMPORAL_CLASS,
  parseActionApifyPlan,
  resolveMaxItems,
} from "./actionApifyCandidateConfig.js";

export {
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_SOURCE_CLASS,
  ACTION_APIFY_SCHEMA_VERSION,
  MATCH_CONFIDENCE,
  SCHEMA_DRIFT_LEVELS,
  TEMPORAL_CLASS,
};

/** Canonical FBIS book ids expected when coverage is healthy. */
export const CANONICAL_BOOKS = Object.freeze([
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365",
  "pinnacle",
  "espnbet",
  "fanatics",
  "consensus",
  "opening",
]);

const EXTRA_BOOK_ALIASES = Object.freeze({
  draftkings: "draftkings",
  dk: "draftkings",
  draftkingsportsbook: "draftkings",
  fanduel: "fanduel",
  fd: "fanduel",
  fanduelsportsbook: "fanduel",
  betmgm: "betmgm",
  mgm: "betmgm",
  caesars: "caesars",
  czr: "caesars",
  bet365: "bet365",
  bet365com: "bet365",
  pinnacle: "pinnacle",
  pinny: "pinnacle",
  espnbet: "espnbet",
  espn: "espnbet",
  fanatics: "fanatics",
  consensus: "consensus",
  opening: "opening",
  open: "opening",
});

export const CANONICAL_MARKETS = Object.freeze({
  moneyline: "moneyline",
  spread: "spread",
  total: "total",
  run_line: "run_line",
  player_prop: "player_prop",
  game_prop: "game_prop",
});

export const CANONICAL_PERIODS = Object.freeze({
  event: "event",
  firsthalf: "firsthalf",
  firstquarter: "firstquarter",
  firstfive: "firstfive",
});

const REQUIRED_TOP_LEVEL_KEYS = Object.freeze([
  "gameId",
  "homeTeam",
  "awayTeam",
  "startTime",
  "league",
]);

const CORE_IDENTITY_KEYS = Object.freeze(["gameId", "homeTeam", "awayTeam", "startTime"]);

/**
 * Plan-aware maxItems for candidate collection.
 * @param {unknown} requested
 * @param {string} planRaw
 * @param {{ starterCap?: number }} [opts]
 */
export function candidateMaxItems(requested, planRaw, opts = {}) {
  const plan = parseActionApifyPlan(planRaw);
  return resolveMaxItems(requested, plan, opts);
}

/**
 * Expand sportsbook alias → canonical id. Unknown books stay unmapped.
 * @param {unknown} name
 * @param {{ sourceBookId?: unknown, sourceDisplayName?: unknown }} [meta]
 */
export function canonicalizeBook(name, meta = {}) {
  const sourceDisplayName =
    meta.sourceDisplayName != null ? String(meta.sourceDisplayName) : String(name || "");
  const sourceBookId = meta.sourceBookId != null ? String(meta.sourceBookId) : null;
  const raw = String(name || "").trim();
  if (!raw) {
    return {
      canonicalBookId: "unmapped",
      sourceBookId,
      sourceDisplayName: sourceDisplayName || null,
      mapped: false,
    };
  }
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const fromExtra = EXTRA_BOOK_ALIASES[key] || EXTRA_BOOK_ALIASES[raw.toLowerCase()];
  const fromShadow = normalizeBookKey(raw);
  const canonical = fromExtra || fromShadow;
  const known = CANONICAL_BOOKS.includes(canonical);
  if (!canonical || (!known && !fromExtra && fromShadow === key && !CANONICAL_BOOKS.includes(fromShadow))) {
    return {
      canonicalBookId: "unmapped",
      sourceBookId,
      sourceDisplayName: sourceDisplayName || raw,
      mapped: false,
      rawKey: key,
    };
  }
  return {
    canonicalBookId: canonical,
    sourceBookId,
    sourceDisplayName: sourceDisplayName || raw,
    mapped: true,
  };
}

/**
 * Coverage report for unmapped books in a set of rows.
 * @param {Array<{ books?: Array<{ book?: string, bookId?: unknown }> }>} rows
 */
export function unmappedBookCoverage(rows = []) {
  const unmapped = new Map();
  let totalBookRows = 0;
  let mapped = 0;
  for (const row of rows) {
    for (const b of row.books || []) {
      totalBookRows += 1;
      const c = canonicalizeBook(b.book, { sourceBookId: b.bookId, sourceDisplayName: b.book });
      if (c.mapped) mapped += 1;
      else {
        const k = c.sourceDisplayName || c.rawKey || "unknown";
        unmapped.set(k, (unmapped.get(k) || 0) + 1);
      }
    }
  }
  return {
    totalBookRows,
    mapped,
    unmappedCount: totalBookRows - mapped,
    unmappedBooks: [...unmapped.entries()].map(([name, count]) => ({ name, count })),
  };
}

/**
 * Canonical market/period mapping at the adapter edge.
 * @param {string} market
 * @param {string} [period]
 * @param {string} [sport]
 */
export function canonicalizeMarket(market, period = "event", sport = "") {
  const m = String(market || "").toLowerCase().replace(/[_\s-]+/g, "");
  const p = String(period || "event").toLowerCase().replace(/[_\s-]+/g, "");
  const s = String(sport || "").toLowerCase();

  let canonicalMarket = null;
  if (m === "ml" || m === "moneyline" || m === "h2h") canonicalMarket = CANONICAL_MARKETS.moneyline;
  else if (m === "spread" || m === "ats" || m === "handicap") {
    canonicalMarket = s === "mlb" ? CANONICAL_MARKETS.run_line : CANONICAL_MARKETS.spread;
  } else if (m === "runline" || m === "rl") canonicalMarket = CANONICAL_MARKETS.run_line;
  else if (m === "total" || m === "ou" || m === "overunder") canonicalMarket = CANONICAL_MARKETS.total;
  else if (m.includes("prop") && m.includes("player")) canonicalMarket = CANONICAL_MARKETS.player_prop;
  else if (m.includes("prop")) canonicalMarket = CANONICAL_MARKETS.game_prop;
  else if (m) canonicalMarket = m;

  let canonicalPeriod = CANONICAL_PERIODS.event;
  if (p === "firsthalf" || p === "1h") canonicalPeriod = CANONICAL_PERIODS.firsthalf;
  else if (p === "firstquarter" || p === "1q") canonicalPeriod = CANONICAL_PERIODS.firstquarter;
  else if (p === "firstfive" || p === "f5" || p === "first5" || p === "firstfiveinnings") {
    canonicalPeriod = CANONICAL_PERIODS.firstfive;
  } else if (p && CANONICAL_PERIODS[p]) canonicalPeriod = CANONICAL_PERIODS[p];
  else if (p) canonicalPeriod = p;

  return {
    market: canonicalMarket,
    period: canonicalPeriod,
    providerMarket: market || null,
    providerPeriod: period || null,
  };
}

/**
 * Odds/price normalization. Never fabricate a two-way market from one side.
 * @param {{ homeOdds?: unknown, awayOdds?: unknown, overOdds?: unknown, underOdds?: unknown }} sides
 */
export function normalizePrices(sides = {}) {
  const homeOdds = numOrNull(sides.homeOdds);
  const awayOdds = numOrNull(sides.awayOdds);
  const overOdds = numOrNull(sides.overOdds);
  const underOdds = numOrNull(sides.underOdds);

  const twoWayComplete = homeOdds != null && awayOdds != null;
  const totalComplete = overOdds != null && underOdds != null;
  const nv = twoWayComplete ? noVigTwoWay(homeOdds, awayOdds) : { home: null, away: null, hold: null };
  const nvTotal = totalComplete ? noVigTwoWay(overOdds, underOdds) : { home: null, away: null, hold: null };

  return {
    american: { homeOdds, awayOdds, overOdds, underOdds },
    implied: {
      home: americanToImpliedProb(homeOdds),
      away: americanToImpliedProb(awayOdds),
      over: americanToImpliedProb(overOdds),
      under: americanToImpliedProb(underOdds),
    },
    noVig: {
      home: nv.home,
      away: nv.away,
      over: nvTotal.home,
      under: nvTotal.away,
      hold: nv.hold,
      totalHold: nvTotal.hold,
    },
    marketComplete: {
      moneyline: twoWayComplete,
      total: totalComplete,
    },
    incomplete: !(twoWayComplete && totalComplete),
  };
}

/**
 * Hardened event match with confidence states.
 * Only EXACT/HIGH may enter provider-comparison metrics.
 */
export function matchEventWithConfidence(actionRow, candidates = [], opts = {}) {
  const homeTeam = actionRow.homeTeam || actionRow.home;
  const awayTeam = actionRow.awayTeam || actionRow.away;
  if (!homeTeam || !awayTeam) {
    return {
      confidence: MATCH_CONFIDENCE.UNMATCHED,
      matched: false,
      candidate: null,
      reason: "missing-action-teams",
      comparisonEligible: false,
    };
  }

  const normalizedAction = {
    ...actionRow,
    homeTeam,
    awayTeam,
    startTime: actionRow.startTime || actionRow.kickoff || actionRow.commence_time,
  };
  const base = matchShadowEvent(normalizedAction, candidates, opts);
  if (!base.matched) {
    if (String(base.reason || "").includes("ambiguous")) {
      return {
        confidence: MATCH_CONFIDENCE.AMBIGUOUS,
        matched: false,
        candidate: null,
        reason: base.reason,
        candidates: base.candidates ?? null,
        comparisonEligible: false,
      };
    }
    return {
      confidence: MATCH_CONFIDENCE.UNMATCHED,
      matched: false,
      candidate: null,
      reason: base.reason || "no-match",
      comparisonEligible: false,
    };
  }

  const kickoffDeltaMs = base.kickoffDeltaMs ?? base.kickoffDeltaMs;
  const exactKickoff = kickoffDeltaMs === 0 || kickoffDeltaMs == null;
  const cand = base.candidate;
  const homeExact = namesEqualish(homeTeam, cand.homeTeam || cand.home);
  const awayExact = namesEqualish(awayTeam, cand.awayTeam || cand.away);
  const abbrExact =
    abbrEqual(actionRow.homeAbbr, cand.homeAbbr || cand.home) &&
    abbrEqual(actionRow.awayAbbr, cand.awayAbbr || cand.away);

  let confidence = MATCH_CONFIDENCE.HIGH;
  if (exactKickoff && ((homeExact && awayExact) || abbrExact)) confidence = MATCH_CONFIDENCE.EXACT;

  const aStatus = String(actionRow.status || "").toLowerCase();
  const cStatus = String(cand.status || "").toLowerCase();
  if (/postpone|cancel|suspend/.test(aStatus) || /postpone|cancel|suspend/.test(cStatus)) {
    if (kickoffDeltaMs != null && kickoffDeltaMs > 60 * 60 * 1000) {
      return {
        confidence: MATCH_CONFIDENCE.AMBIGUOUS,
        matched: false,
        candidate: null,
        reason: "postponed-or-canceled-kickoff-skew",
        comparisonEligible: false,
      };
    }
  }

  return {
    confidence,
    matched: true,
    candidate: cand,
    reason: base.reason,
    kickoffDeltaMs,
    comparisonEligible: confidence === MATCH_CONFIDENCE.EXACT || confidence === MATCH_CONFIDENCE.HIGH,
  };
}

function namesEqualish(a, b) {
  const na = String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const nb = String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return Boolean(na && nb && na === nb);
}

function abbrEqual(a, b) {
  const na = String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const nb = String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return Boolean(na && nb && na === nb && na.length >= 2);
}

/**
 * Deterministic observation natural key for idempotent upserts.
 * Distinguishes scrape time from source observation / movement timestamps.
 */
export function observationNaturalKey({
  provider = ACTION_APIFY_PROVIDER,
  actionGameId,
  market,
  period,
  book,
  sourceObservedAt = null,
  movementTimestamp = null,
  scrapedAt = null,
  payloadHash = null,
  runId = null,
  line = null,
  price = null,
} = {}) {
  // Three distinct concepts:
  // A) Run idempotency — retries of the same logical run must not double-write
  //    (handled via logical_collection_key + runId when no source timestamp).
  // B) Observation identity — when provider supplies sourceObservedAt, key by
  //    event/market/period/book/sourceObservedAt/line/price (payloadHash).
  // C) Temporal resampling — without source timestamp, a later scrape of the
  //    same unchanged price is a NEW sampling observation (different runId),
  //    not a duplicate. scrapedAt alone never invents source observation time.
  const hasSourceTs = Boolean(sourceObservedAt || movementTimestamp);
  const parts = [
    provider,
    actionGameId ?? "",
    market ?? "",
    period ?? "",
    book ?? "",
    sourceObservedAt || movementTimestamp || "",
    hasSourceTs ? "" : (runId || scrapedAt || ""),
    hasSourceTs
      ? `${line ?? ""}|${price ?? ""}|${payloadHash || ""}`
      : (payloadHash || ""),
  ];
  return sha256Hex(parts.join("|"));
}

/**
 * Classify a repeated ingest against an existing key row.
 */
export function classifyObservationDelta(existing, incoming) {
  if (!existing) return { kind: "new_observation" };
  if (existing.payload_hash && incoming.payloadHash && existing.payload_hash === incoming.payloadHash) {
    return { kind: "identical_repeated_snapshot" };
  }
  const sameSourceTs =
    (existing.source_observed_at || null) === (incoming.sourceObservedAt || null) &&
    (existing.book || null) === (incoming.book || null);
  if (sameSourceTs && existing.payload_hash !== incoming.payloadHash) {
    return { kind: "line_change" };
  }
  if (!incoming.sourceObservedAt && existing.payload_hash !== incoming.payloadHash) {
    return { kind: "new_observation" };
  }
  if (existing.payload_hash !== incoming.payloadHash) {
    return { kind: "source_history_tick" };
  }
  return { kind: "same_price_observed_again" };
}

/**
 * Lightweight schema fingerprint + drift classification.
 * BLOCK stops promotion eligibility for that payload; does not crash production.
 */
export function fingerprintSchema(payload, { previousFingerprint = null } = {}) {
  const sample = Array.isArray(payload) ? payload[0] : payload;
  const topLevelKeys = sample && typeof sample === "object" ? Object.keys(sample).sort() : [];
  const missingRequired = REQUIRED_TOP_LEVEL_KEYS.filter((k) => {
    if (!sample || typeof sample !== "object") return true;
    if (sample[k] != null) return false;
    if (k === "gameId") return sample.id == null && sample.actionGameId == null;
    if (k === "homeTeam") return sample.home == null;
    if (k === "awayTeam") return sample.away == null;
    if (k === "startTime") return sample.kickoff == null && sample.commence_time == null;
    return true;
  });
  const missingCore = CORE_IDENTITY_KEYS.filter((k) => {
    if (!sample || typeof sample !== "object") return true;
    if (sample[k] != null) return false;
    if (k === "gameId") return sample.id == null && sample.actionGameId == null;
    if (k === "homeTeam") return sample.home == null;
    if (k === "awayTeam") return sample.away == null;
    if (k === "startTime") return sample.kickoff == null && sample.commence_time == null;
    return true;
  });

  const typeProblems = [];
  if (sample && typeof sample === "object") {
    if (sample.startTime != null && typeof sample.startTime !== "string") typeProblems.push("startTime:type");
    if (
      sample.homeTeam != null &&
      typeof sample.homeTeam !== "object" &&
      typeof sample.homeTeam !== "string"
    ) {
      typeProblems.push("homeTeam:type");
    }
  }

  let driftLevel = SCHEMA_DRIFT_LEVELS.INFO;
  const notes = [];
  if (missingCore.length || typeProblems.length) {
    driftLevel = SCHEMA_DRIFT_LEVELS.BLOCK;
    if (missingCore.length) notes.push(`missing-core:${missingCore.join(",")}`);
    notes.push(...typeProblems);
  } else if (missingRequired.length) {
    driftLevel = SCHEMA_DRIFT_LEVELS.WARN;
    notes.push(`missing-optional-required:${missingRequired.join(",")}`);
  } else if (previousFingerprint) {
    const priorKeys = Array.isArray(previousFingerprint?.topLevelKeys)
      ? previousFingerprint.topLevelKeys
      : typeof previousFingerprint === "object" && previousFingerprint?.top_level_keys_json
        ? (() => { try { return JSON.parse(previousFingerprint.top_level_keys_json); } catch { return []; } })()
        : [];
    if (priorKeys.length) {
      const priorSet = new Set(priorKeys);
      const added = topLevelKeys.filter((k) => !priorSet.has(k));
      const removed = priorKeys.filter((k) => !topLevelKeys.includes(k));
      const removedCore = removed.filter((k) => CORE_IDENTITY_KEYS.includes(k) || REQUIRED_TOP_LEVEL_KEYS.includes(k));
      if (removedCore.length) {
        driftLevel = SCHEMA_DRIFT_LEVELS.BLOCK;
        notes.push(`removed-core-vs-prior:${removedCore.join(",")}`);
      } else if (removed.length) {
        if (driftLevel === SCHEMA_DRIFT_LEVELS.INFO) driftLevel = SCHEMA_DRIFT_LEVELS.WARN;
        notes.push(`removed-optional-vs-prior:${removed.slice(0, 12).join(",")}`);
      } else if (added.length) {
        notes.push(`additive-vs-prior:${added.slice(0, 12).join(",")}`);
      } else {
        notes.push("schema-stable-vs-prior");
      }
      notes.push(`priorFingerprint:${previousFingerprint.fingerprint || previousFingerprint}`);
    } else {
      notes.push("schema-stable-or-additive");
    }
  } else {
    notes.push("baseline-fingerprint");
  }

  const unexpected = topLevelKeys.filter((k) => !REQUIRED_TOP_LEVEL_KEYS.includes(k));
  if (unexpected.length && driftLevel === SCHEMA_DRIFT_LEVELS.INFO) {
    notes.push(`optional-keys:${unexpected.slice(0, 12).join(",")}`);
  }

  const fingerprint = sha256Hex(
    JSON.stringify({ topLevelKeys, missingCore, typeProblems, schema: ACTION_APIFY_SCHEMA_VERSION })
  );

  return {
    schemaVersion: ACTION_APIFY_SCHEMA_VERSION,
    fingerprint,
    topLevelKeys,
    requiredFields: [...REQUIRED_TOP_LEVEL_KEYS],
    driftLevel,
    driftNotes: notes,
    promotionEligible: driftLevel !== SCHEMA_DRIFT_LEVELS.BLOCK,
  };
}

/**
 * Detailed cost ledger line for a single run (ESTIMATED unless actual provided).
 */
export function buildCostLedgerEntry({
  runId,
  plan,
  sport = null,
  profile = null,
  input = {},
  gamesReturned = 0,
  actualTotalUsd = null,
  createdAt = null,
} = {}) {
  const leagues = Array.isArray(input.leagues) ? input.leagues.length : 1;
  const periods = Array.isArray(input.periods) ? input.periods.length : 1;
  const games = Math.max(0, Number(gamesReturned) || 0);
  const P = ACTION_APIFY_PRICING_USD;

  const runStartUsd = P.runStart;
  const scoreboardUsd = roundUsd(leagues * periods * P.scoreboardPerLeaguePeriod);
  const rowUsd = roundUsd(games * P.gameRow);
  const movementUsd = input.includeLineMovement ? roundUsd(games * P.lineMovementPerGame) : 0;
  const playerPropsUsd = input.includePlayerProps ? roundUsd(games * P.playerPropsPerGame) : 0;
  const gamePropsUsd = input.includeGameProps ? roundUsd(games * P.gamePropsPerGame) : 0;
  const detailUsd = input.includeGameDetail ? roundUsd(games * P.gameDetailPerGame) : 0;
  const weatherUsd = input.includeWeather ? roundUsd(leagues * P.weatherPerLeague) : 0;
  const injuriesUsd = input.includeInjuries ? roundUsd(leagues * P.injuriesPerLeague) : 0;
  const standingsUsd = input.includeStandings ? roundUsd(leagues * P.standingsPerLeague) : 0;
  const futuresUsd = 0;

  const estimatedTotalUsd = roundUsd(
    runStartUsd +
      scoreboardUsd +
      rowUsd +
      movementUsd +
      playerPropsUsd +
      gamePropsUsd +
      detailUsd +
      weatherUsd +
      injuriesUsd +
      standingsUsd +
      futuresUsd
  );
  const actual = actualTotalUsd == null ? null : roundUsd(Number(actualTotalUsd));
  const costBasis = actual == null ? "ESTIMATED" : "ACTUAL";

  return {
    id: `cost_${runId}`,
    run_id: runId,
    plan,
    sport,
    profile,
    cost_basis: costBasis,
    run_start_usd: runStartUsd,
    scoreboard_usd: scoreboardUsd,
    row_usd: rowUsd,
    movement_usd: movementUsd,
    player_props_usd: playerPropsUsd,
    game_props_usd: gamePropsUsd,
    detail_usd: detailUsd,
    weather_usd: weatherUsd,
    injuries_usd: injuriesUsd,
    standings_usd: standingsUsd,
    futures_usd: futuresUsd,
    estimated_total_usd: estimatedTotalUsd,
    actual_total_usd: actual,
    delta_usd: actual == null ? null : roundUsd(actual - estimatedTotalUsd),
    games_returned: games,
    features_json: JSON.stringify({
      includeLineMovement: Boolean(input.includeLineMovement),
      includePlayerProps: Boolean(input.includePlayerProps),
      includeGameProps: Boolean(input.includeGameProps),
      includeGameDetail: Boolean(input.includeGameDetail),
      includeWeather: Boolean(input.includeWeather),
      includeInjuries: Boolean(input.includeInjuries),
      includeStandings: Boolean(input.includeStandings),
      includeFutures: Boolean(input.includeFutures),
      periods: input.periods || [],
      leagues: input.leagues || [],
    }),
    created_at: createdAt || new Date().toISOString(),
    estimatorCrossCheckUsd: estimateActorCostUsd(input, { gamesReturned: games }),
  };
}

/**
 * Aggregate cost windows from ledger rows.
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} [nowIso]
 */
export function aggregateCostWindows(rows = [], nowIso = new Date().toISOString()) {
  const now = Date.parse(nowIso);
  const dayMs = 24 * 60 * 60 * 1000;
  const sum = (predicate) =>
    roundUsd(rows.filter(predicate).reduce((s, r) => s + Number(r.estimated_total_usd || 0), 0));

  const today = sum((r) => now - Date.parse(String(r.created_at)) <= dayMs);
  const last7 = sum((r) => now - Date.parse(String(r.created_at)) <= 7 * dayMs);
  const mtd = sum((r) => {
    const d = new Date(String(r.created_at));
    const n = new Date(nowIso);
    return d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth();
  });

  /** @type {Record<string, number>} */
  const bySport = {};
  /** @type {Record<string, number>} */
  const byProfile = {};
  for (const r of rows) {
    const sport = String(r.sport || "unknown");
    const profile = String(r.profile || "unknown");
    bySport[sport] = roundUsd((bySport[sport] || 0) + Number(r.estimated_total_usd || 0));
    byProfile[profile] = roundUsd((byProfile[profile] || 0) + Number(r.estimated_total_usd || 0));
  }

  const games = rows.reduce((s, r) => s + Number(r.games_returned || 0), 0);
  const runs = rows.length;
  const total = roundUsd(rows.reduce((s, r) => s + Number(r.estimated_total_usd || 0), 0));

  return {
    costToday: today,
    costLast7Days: last7,
    costMonthToDate: mtd,
    costPerGame: games ? roundUsd(total / games) : null,
    costPerRun: runs ? roundUsd(total / runs) : null,
    costBySport: bySport,
    costByProfile: byProfile,
    projected30DaySpend: last7 ? roundUsd((last7 / 7) * 30) : null,
    costBasis: "ESTIMATED",
    runs,
    games,
  };
}

/**
 * Temporal class helper — never invent timestamps; never treat scrape as source observation.
 */
export function classifyTemporal({
  scrapedAt = null,
  sourceObservedAt = null,
  lifecycle = null,
  isFinal = false,
} = {}) {
  if (isFinal || String(lifecycle || "").toLowerCase() === "postgame") {
    return {
      temporalClass: TEMPORAL_CLASS.EVALUATION_CLOSE,
      scrapedAt: scrapedAt || null,
      sourceObservedAt: sourceObservedAt || null,
      note: "evaluation_close is postgame/closing only — not a pregame feature",
    };
  }
  return {
    temporalClass: TEMPORAL_CLASS.PREGAME_OBSERVATION,
    scrapedAt: scrapedAt || null,
    sourceObservedAt: sourceObservedAt || null,
    note: "scrape time is not source observation time",
  };
}

/**
 * Safety: Action failure must not poison incumbent production odds path.
 */
export function isolateCandidateFailure(err) {
  assertActionApifyNotInProductionRouter();
  return {
    ok: false,
    mode: "shadow",
    affectsProductionOdds: false,
    canQualify: false,
    canAuthorizeWager: false,
    error: err instanceof Error ? err.message : String(err),
  };
}

/**
 * Redact secrets from provider error text.
 * @param {string} text
 * @param {string} [token]
 */
export function redactSecrets(text, token = "") {
  let out = String(text || "");
  if (token) out = out.split(token).join("[redacted]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]");
  out = out.replace(/apify_api_[A-Za-z0-9]+/gi, "[redacted]");
  return out.slice(0, 400);
}

/**
 * Normalize a candidate game row with temporal + price metadata.
 * @param {unknown} raw
 * @param {Record<string, unknown>} [ctx]
 */
export function normalizeCandidateGameRow(raw, ctx = {}) {
  const row = normalizeActionGameRow(raw, ctx);
  if (!row) return null;
  const temporal = classifyTemporal({
    scrapedAt: row.scrapedAt,
    sourceObservedAt: row.observedAt,
    lifecycle: ctx.lifecycle,
    isFinal: Boolean(row.result?.isFinal),
  });
  const prices = normalizePrices({
    homeOdds: row.consensus?.moneylineHome,
    awayOdds: row.consensus?.moneylineAway,
    overOdds: row.consensus?.overOdds,
    underOdds: row.consensus?.underOdds,
  });
  return {
    ...row,
    temporalClass: temporal.temporalClass,
    temporalNote: temporal.note,
    priceNormalization: prices,
    decisionEligible: false,
    canQualify: false,
    canAuthorizeWager: false,
    rawPayloadHash: row.rawPayloadHash || hashPayload(raw),
  };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundUsd(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}
