/**
 * Action/Apify production-candidate scheduled collector.
 *
 * Shadow mode only. Never enters ODDS_PROVIDER_ORDER.
 * Never grants canQualify / canAuthorizeWager.
 * Failures here must not poison incumbent production odds collection.
 */

import {
  ACTION_APIFY_FREE_MAX_ITEMS,
  ACTION_APIFY_STARTER_SAFETY_CAP,
  COLLECTION_PROFILES,
  LIFECYCLE_PHASES,
  cadenceForPhase,
  candidateHealthSection,
  profileToActorFlags,
  readCandidateConfig,
} from "./actionApifyCandidateConfig.js";
import {
  aggregateCostWindows,
  buildCostLedgerEntry,
  classifyObservationDelta,
  fingerprintSchema,
  isolateCandidateFailure,
  matchEventWithConfidence,
  normalizeCandidateGameRow,
  observationNaturalKey,
  redactSecrets,
  unmappedBookCoverage,
} from "./actionApifyCandidate.js";
import {
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_SOURCE_CLASS,
  assertActionApifyNotInProductionRouter,
  buildActorInput,
  estimateActorCostUsd,
  fitMaxItemsToUsdBudget,
  ACTION_APIFY_BOARD_SOFT_CAP_USD,
  hashPayload,
  runActionApifyShadow,
} from "./actionApifyShadow.js";
import { buildCapabilityAuditSummary } from "./actionApifyChampionship.js";
import {
  acquireSchedulerLease,
  buildLogicalCollectionKey,
  queryMonthToDateSpendUsd,
  releaseSchedulerLease,
  schedulerScopeKey,
} from "./actionApifyDurableState.js";
import {
  computeMatchDenominators,
  ensureShadowProviderRun,
  persistFullMarketObservation,
} from "./actionApifyObservationStore.js";
import { loadPriorSchemaFingerprint } from "./actionApifyEvidence.js";

const SPORT_LEAGUES = Object.freeze({
  cfb: ["ncaaf"],
  nfl: ["nfl"],
  mlb: ["mlb"],
  // Extensible without rewrite:
  nba: ["nba"],
  ncaab: ["ncaab"],
  nhl: ["nhl"],
});

/** In-memory overlap + circuit state for a single isolate (tests / single worker). */
const runtimeGuards = {
  activeRunId: null,
  consecutiveFailures: 0,
  circuitOpenUntil: null,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  gamesLastRun: null,
  monthToDateEstimatedCost: 0,
};

/**
 * Resolve sport → Actor leagues. Unknown sports fail closed.
 * @param {string} sport
 */
export function leaguesForSport(sport) {
  const key = String(sport || "").toLowerCase();
  // Board sport "cbb" maps to Action Network league "ncaab".
  const resolved = key === "cbb" ? "ncaab" : key;
  const leagues = SPORT_LEAGUES[resolved];
  if (!leagues) {
    const err = new Error(`Unsupported Action candidate sport="${sport}"`);
    err.code = "ACTION_APIFY_UNSUPPORTED_SPORT";
    throw err;
  }
  return leagues;
}

/**
 * Build collection plan for a sport + lifecycle without network I/O.
 * @param {Record<string, string|undefined>} env
 * @param {{ sport: string, lifecycle?: string, profile?: string, date?: string }} opts
 */
export function planCandidateCollection(env, opts) {
  const cfg = readCandidateConfig(env);
  const sport = String(opts.sport || "").toLowerCase();
  const lifecycle = String(opts.lifecycle || LIFECYCLE_PHASES.PREGAME).toLowerCase();
  const cadence = cadenceForPhase(lifecycle, sport);
  const profile = String(opts.profile || cfg.profiles[sport] || cadence.profile || COLLECTION_PROFILES.BASE).toUpperCase();

  const flags = profileToActorFlags(profile, {
    sport,
    collectMovement:
      cfg.collectMovement ||
      profile === COLLECTION_PROFILES.MOVEMENT ||
      profile === COLLECTION_PROFILES.FINAL ||
      profile === COLLECTION_PROFILES.CAPABILITY_AUDIT,
    collectMlbF5: cfg.collectMlbF5 || profile === COLLECTION_PROFILES.MLB_F5,
    collectProps:
      cfg.collectProps ||
      profile === COLLECTION_PROFILES.PLAYER_PROPS ||
      profile === COLLECTION_PROFILES.CAPABILITY_AUDIT,
  });

  const freePlan = cfg.plan === "free";
  const requestedMax =
    opts.maxItems != null && Number.isFinite(Number(opts.maxItems)) ? Number(opts.maxItems) : cfg.maxItems;
  let maxItems = freePlan
    ? Math.min(Math.max(1, Math.floor(requestedMax)), ACTION_APIFY_FREE_MAX_ITEMS)
    : Math.min(Math.max(1, Math.floor(requestedMax)), ACTION_APIFY_STARTER_SAFETY_CAP);
  // Prefer slate-sized pulls for board intel (avoid estimating the 200-item safety cap).
  const slateExpected = Number(opts.slateExpected);
  if (Number.isFinite(slateExpected) && slateExpected > 0) {
    const slateCap = Math.min(maxItems, Math.ceil(slateExpected) + 8);
    maxItems = Math.max(1, slateCap);
  }
  // Fit under soft board/harvest budget unless caller disables (fitBudgetUsd=false).
  const fitBudget =
    opts.fitBudgetUsd === false
      ? null
      : Number(opts.fitBudgetUsd) > 0
        ? Number(opts.fitBudgetUsd)
        : ACTION_APIFY_BOARD_SOFT_CAP_USD;
  if (fitBudget != null && !freePlan) {
    const fitted = fitMaxItemsToUsdBudget(
      {
        leagues: leaguesForSport(sport),
        periods: ["event"],
        maxItems,
        includeLineMovement: Boolean(flags.includeLineMovement),
        includePlayerProps: Boolean(flags.includePlayerProps),
        includeGameProps: Boolean(flags.includeGameProps),
        includeGameDetail: Boolean(flags.includeGameDetail),
      },
      fitBudget
    );
    maxItems = fitted.maxItems;
  }
  const input = buildActorInput({
    leagues: leaguesForSport(sport),
    maxItems,
    freePlan,
    periods: flags.periods.length ? flags.periods : ["event"],
    includeLineMovement: flags.includeLineMovement,
    includePlayerProps: flags.includePlayerProps,
    includeGameProps: flags.includeGameProps,
    includeGameDetail: flags.includeGameDetail,
    includeWeather: flags.includeWeather,
    includeInjuries: flags.includeInjuries,
    includeStandings: flags.includeStandings,
    includeFutures: flags.includeFutures,
    gameStatus: cadence.gameStatus,
    date: opts.date,
    // Deliberate audit sample controls (Actor-native filters; no extra PPE).
    gameUrls: opts.gameUrls,
    teams: opts.teams,
    sortBy: opts.sortBy,
    minNumBets: opts.minNumBets,
    minSharpGap: opts.minSharpGap,
    onlyWithOdds:
      opts.onlyWithOdds === true ||
      profile === COLLECTION_PROFILES.CAPABILITY_AUDIT,
  });

  const estimatedCostUsd = estimateActorCostUsd(input, { gamesReturned: input.maxItems });

  return {
    cfg,
    sport,
    lifecycle,
    profile,
    temporalClass: cadence.temporalClass,
    input,
    estimatedCostUsd,
    freePlan,
  };
}

/**
 * Scheduler safety checks (overlap, circuit, budget). Does not run Actor.
 * @param {ReturnType<typeof planCandidateCollection>} plan
 * @param {{ monthToDateCostUsd?: number, now?: Date }} [state]
 */
export function evaluateSchedulerSafety(plan, state = {}) {
  const now = state.now || new Date();
  const blocks = [];

  if (!plan.cfg.enabled) {
    blocks.push({ code: "DISABLED", message: "ACTION_APIFY_ENABLED is false" });
  }
  if (plan.cfg.planError) {
    blocks.push({ code: "PLAN_ERROR", message: plan.cfg.planError });
  }
  if (!plan.cfg.configured) {
    blocks.push({ code: "TOKEN_MISSING", message: "APIFY_TOKEN not installed" });
  }
  // In-memory guards are a local fast path only — durable lease/circuit are authoritative.
  if (runtimeGuards.activeRunId && !state.ignoreMemoryOverlap) {
    blocks.push({ code: "OVERLAP", message: `active run ${runtimeGuards.activeRunId}` });
  }
  const circuitUntil = state.circuitOpenUntil ?? runtimeGuards.circuitOpenUntil;
  if (circuitUntil && Date.parse(circuitUntil) > now.getTime()) {
    blocks.push({ code: "CIRCUIT_OPEN", message: `circuit open until ${circuitUntil}` });
  }
  if (state.durableOverlapBlocked) {
    blocks.push({ code: "OVERLAP", message: state.durableOverlapMessage || "durable lease held" });
  }
  const mtd = Number(state.monthToDateCostUsd ?? runtimeGuards.monthToDateEstimatedCost) || 0;
  if (mtd + Number(plan.estimatedCostUsd || 0) > Number(plan.cfg.monthlyBudgetUsd) + 1e-9) {
    blocks.push({
      code: "MONTHLY_BUDGET",
      message: `monthly budget ${plan.cfg.monthlyBudgetUsd} would be exceeded (mtd=${mtd}, estimate=${plan.estimatedCostUsd})`,
      mtdUsd: mtd,
      estimatedNextRunUsd: plan.estimatedCostUsd,
      monthlyBudgetUsd: plan.cfg.monthlyBudgetUsd,
      remainingBudgetUsd: Math.max(0, Number(plan.cfg.monthlyBudgetUsd) - mtd),
    });
  }
  if (Number(plan.estimatedCostUsd || 0) > Number(plan.cfg.perRunBudgetUsd) + 1e-9) {
    blocks.push({
      code: "PER_RUN_BUDGET",
      message: `per-run budget ${plan.cfg.perRunBudgetUsd} < estimate ${plan.estimatedCostUsd}`,
    });
  }

  return {
    allowed: blocks.length === 0,
    blocks,
    budgetBlocked: blocks.some((b) => b.code === "MONTHLY_BUDGET" || b.code === "PER_RUN_BUDGET"),
    overlapBlocked: blocks.some((b) => b.code === "OVERLAP"),
    circuitOpen: blocks.some((b) => b.code === "CIRCUIT_OPEN"),
    monthToDateCostUsd: mtd,
    estimatedNextRunUsd: plan.estimatedCostUsd,
    monthlyBudgetUsd: plan.cfg.monthlyBudgetUsd,
    remainingBudgetUsd: Math.max(0, Number(plan.cfg.monthlyBudgetUsd) - mtd),
  };
}

/**
 * Idempotent observation ingest (in-memory or D1 adapter).
 * @param {object} db — { getObservationKey, putObservationKey } optional
 * @param {object} row — normalized candidate row
 * @param {{ runId: string }} ctx
 */
export async function ingestCandidateObservation(db, row, ctx = {}) {
  const payloadHash = row.rawPayloadHash || hashPayload(row);
  const book = row.books?.[0]?.book || "consensus";
  const consensus = row.consensus || {};
  const naturalKey = observationNaturalKey({
    actionGameId: row.actionGameId || row.gameId,
    market: "consensus",
    period: row.period || "event",
    book,
    sourceObservedAt: row.observedAt || null,
    scrapedAt: row.scrapedAt || null,
    payloadHash,
    runId: ctx.runId || null,
    line: consensus.spreadHome ?? consensus.total ?? null,
    price: consensus.spreadHomeOdds ?? consensus.moneylineHome ?? null,
  });

  const existing = db?.getObservationKey ? await db.getObservationKey(naturalKey) : null;
  const delta = classifyObservationDelta(existing, {
    payloadHash,
    sourceObservedAt: row.observedAt || null,
    book,
  });

  // Run retry / identical snapshot: suppress. Same price on a later run uses a
  // different natural key (runId) and is retained as temporal resampling.
  if (delta.kind === "identical_repeated_snapshot") {
    return { written: false, duplicate: true, naturalKey, delta };
  }
  if (delta.kind === "same_price_observed_again" && existing?.run_id === ctx.runId) {
    return { written: false, duplicate: true, naturalKey, delta };
  }

  const observationId = `smo_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

  if (db?.putObservationKey) {
    await db.putObservationKey({
      natural_key: naturalKey,
      observation_id: observationId,
      run_id: ctx.runId,
      provider: ACTION_APIFY_PROVIDER,
      action_game_id: row.actionGameId || row.gameId || null,
      market: "consensus",
      period: row.period || "event",
      book,
      source_observed_at: row.observedAt || null,
      collected_at: row.scrapedAt || new Date().toISOString(),
      payload_hash: payloadHash,
      created_at: new Date().toISOString(),
      run_idempotency_key: ctx.logicalCollectionKey || null,
      sampling_kind: row.observedAt ? "source_timestamped" : "temporal_resample",
      fbis_event_id: ctx.match?.comparisonEligible ? ctx.match?.candidate?.id || null : null,
      line: consensus.spreadHome ?? consensus.total ?? null,
      price: consensus.spreadHomeOdds ?? consensus.moneylineHome ?? null,
    });
  }

  let marketPersist = null;
  if (db?.exec && ctx.persistFullMarket !== false) {
    marketPersist = await persistFullMarketObservation(db, row, {
      runId: ctx.runId,
      observationId,
      sport: ctx.sport,
      profile: ctx.profile,
      lifecycle: ctx.lifecycle,
      temporalClass: ctx.temporalClass || row.temporalClass,
      match: ctx.match || null,
      collectedAt: new Date().toISOString(),
    });
  }

  return {
    written: true,
    duplicate: false,
    naturalKey,
    delta,
    payloadHash,
    observationId,
    marketPersist,
  };
}

/**
 * Persist run / cost / reliability / schema / dead-letter rows when db available.
 */
export async function persistCandidateRunArtifacts(db, artifact) {
  if (!db?.exec) return { persisted: false };
  const statements = [];

  statements.push({
    sql: `INSERT INTO shadow_collection_runs (
      id, provider, mode, plan, profile, sport, lifecycle, status, enabled,
      overlap_blocked, budget_blocked, circuit_open, apify_run_id, dataset_id,
      requested_max_items, games_expected, games_returned, games_matched, games_unmatched,
      observations_written, duplicates_skipped, malformed_rows, schema_fingerprint,
      schema_drift_level, estimated_cost_usd, actual_cost_usd, cost_basis,
      error_class, error_message, started_at, finished_at, duration_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      artifact.run.id,
      ACTION_APIFY_PROVIDER,
      "shadow",
      artifact.run.plan,
      artifact.run.profile,
      artifact.run.sport,
      artifact.run.lifecycle,
      artifact.run.status,
      1,
      artifact.run.overlapBlocked ? 1 : 0,
      artifact.run.budgetBlocked ? 1 : 0,
      artifact.run.circuitOpen ? 1 : 0,
      artifact.run.apifyRunId,
      artifact.run.datasetId,
      artifact.run.requestedMaxItems,
      artifact.run.gamesExpected,
      artifact.run.gamesReturned,
      artifact.run.gamesMatched,
      artifact.run.gamesUnmatched,
      artifact.run.observationsWritten,
      artifact.run.duplicatesSkipped,
      artifact.run.malformedRows,
      artifact.run.schemaFingerprint,
      artifact.run.schemaDriftLevel,
      artifact.run.estimatedCostUsd,
      artifact.run.actualCostUsd,
      artifact.run.costBasis,
      artifact.run.errorClass,
      artifact.run.errorMessage,
      artifact.run.startedAt,
      artifact.run.finishedAt,
      artifact.run.durationMs,
      artifact.run.createdAt,
    ],
  });

  if (artifact.cost) {
    const c = artifact.cost;
    statements.push({
      sql: `INSERT INTO shadow_cost_ledger (
        id, run_id, plan, sport, profile, cost_basis, run_start_usd, scoreboard_usd, row_usd,
        movement_usd, player_props_usd, game_props_usd, detail_usd, weather_usd, injuries_usd,
        standings_usd, futures_usd, estimated_total_usd, actual_total_usd, delta_usd,
        games_returned, features_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        c.id,
        c.run_id,
        c.plan,
        c.sport,
        c.profile,
        c.cost_basis,
        c.run_start_usd,
        c.scoreboard_usd,
        c.row_usd,
        c.movement_usd,
        c.player_props_usd,
        c.game_props_usd,
        c.detail_usd,
        c.weather_usd,
        c.injuries_usd,
        c.standings_usd,
        c.futures_usd,
        c.estimated_total_usd,
        c.actual_total_usd,
        c.delta_usd,
        c.games_returned,
        c.features_json,
        c.created_at,
      ],
    });
  }

  if (artifact.reliability) {
    const r = artifact.reliability;
    statements.push({
      sql: `INSERT INTO shadow_provider_reliability (
        id, run_id, sport, profile, success, http_status, actor_failure, api_failure,
        malformed_payload, empty_run, partial_run, schema_violation, timeout, retries,
        latency_ms, games_expected, games_returned, unmatched_games, duplicate_rows,
        error_class, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        r.id,
        r.runId,
        r.sport,
        r.profile,
        r.success ? 1 : 0,
        r.httpStatus,
        r.actorFailure ? 1 : 0,
        r.apiFailure ? 1 : 0,
        r.malformedPayload ? 1 : 0,
        r.emptyRun ? 1 : 0,
        r.partialRun ? 1 : 0,
        r.schemaViolation ? 1 : 0,
        r.timeout ? 1 : 0,
        r.retries,
        r.latencyMs,
        r.gamesExpected,
        r.gamesReturned,
        r.unmatchedGames,
        r.duplicateRows,
        r.errorClass,
        r.errorMessage,
        r.createdAt,
      ],
    });
  }

  if (artifact.schema) {
    const s = artifact.schema;
    statements.push({
      sql: `INSERT INTO shadow_schema_fingerprints (
        id, run_id, schema_version, fingerprint, top_level_keys_json, required_fields_json,
        drift_level, drift_notes_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        s.id,
        s.runId,
        s.schemaVersion,
        s.fingerprint,
        JSON.stringify(s.topLevelKeys || []),
        JSON.stringify(s.requiredFields || []),
        s.driftLevel,
        JSON.stringify(s.driftNotes || []),
        s.createdAt,
      ],
    });
  }

  for (const dl of artifact.deadLetters || []) {
    statements.push({
      sql: `INSERT INTO shadow_dead_letters (
        id, run_id, error_class, error_message, payload_hash, payload_excerpt, sport, profile, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        dl.id,
        dl.runId,
        dl.errorClass,
        dl.errorMessage,
        dl.payloadHash,
        dl.payloadExcerpt,
        dl.sport,
        dl.profile,
        dl.createdAt,
      ],
    });
  }

  for (const st of statements) {
    await db.exec(st.sql, st.params);
  }
  return { persisted: true, statements: statements.length };
}

/**
 * Run one candidate collection cycle (schedulable). Offline-friendly via fetchImpl / rowsInject.
 * @param {Record<string, string|undefined>} env
 * @param {{
 *   sport: string,
 *   lifecycle?: string,
 *   profile?: string,
 *   date?: string,
 *   fbisEvents?: object[],
 *   fetchImpl?: typeof fetch,
 *   rowsInject?: object[],
 *   db?: object,
 *   monthToDateCostUsd?: number,
 * }} opts
 */
export async function runCandidateCollection(env, opts) {
  assertActionApifyNotInProductionRouter();
  const startedAt = new Date().toISOString();
  const runId = `acr_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  let plan;
  try {
    plan = planCandidateCollection(env, {
      ...opts,
      slateExpected: opts.slateExpected ?? opts.gamesExpected,
    });
  } catch (err) {
    return {
      ok: false,
      ...isolateCandidateFailure(err),
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const scopeKey = schedulerScopeKey(plan.sport, plan.profile, plan.lifecycle);
  let mtdUsd = Number(opts.monthToDateCostUsd);
  if (!Number.isFinite(mtdUsd)) {
    const mtd = await queryMonthToDateSpendUsd(opts.db);
    mtdUsd = mtd.mtdUsd;
  }

  // Durable lease is authoritative for overlap; memory is a local fast path only.
  const lease = await acquireSchedulerLease(opts.db, {
    scopeKey,
    runId,
  });
  let leaseHeld = Boolean(lease?.ok);
  if (!lease?.ok) {
    const status = lease?.code === "CIRCUIT_OPEN" ? "circuit_open" : "overlap_blocked";
    const artifact = {
      run: {
        id: runId,
        plan: plan.cfg.plan,
        profile: plan.profile,
        sport: plan.sport,
        lifecycle: plan.lifecycle,
        status,
        overlapBlocked: status === "overlap_blocked",
        budgetBlocked: false,
        circuitOpen: status === "circuit_open",
        apifyRunId: null,
        datasetId: null,
        requestedMaxItems: plan.input.maxItems,
        gamesExpected: Array.isArray(opts.fbisEvents) && opts.fbisEvents.length ? opts.fbisEvents.length : null,
        gamesReturned: 0,
        gamesMatched: 0,
        gamesUnmatched: 0,
        observationsWritten: 0,
        duplicatesSkipped: 0,
        malformedRows: 0,
        schemaFingerprint: null,
        schemaDriftLevel: null,
        estimatedCostUsd: plan.estimatedCostUsd,
        actualCostUsd: null,
        costBasis: "ESTIMATED",
        errorClass: status,
        errorMessage: lease?.message || status,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        createdAt: startedAt,
      },
    };
    await persistCandidateRunArtifacts(opts.db, artifact);
    return {
      ok: false,
      blocked: true,
      status,
      blocks: [{ code: lease?.code || "OVERLAP", message: lease?.message || "lease unavailable" }],
      runId,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
      affectsProductionOdds: false,
      canQualify: false,
      canAuthorizeWager: false,
      estimatedCostUsd: plan.estimatedCostUsd,
      monthToDateCostUsd: mtdUsd,
    };
  }

  const safety = evaluateSchedulerSafety(plan, {
    monthToDateCostUsd: mtdUsd,
    ignoreMemoryOverlap: true,
    circuitOpenUntil: lease?.existing?.circuit_open_until || null,
  });
  if (!safety.allowed) {
    await releaseSchedulerLease(opts.db, {
      scopeKey,
      runId,
      success: false,
      errorClass: safety.budgetBlocked ? "budget_blocked" : "blocked",
      errorMessage: safety.blocks.map((b) => b.message).join("; "),
    });
    leaseHeld = false;

    const status = safety.budgetBlocked
      ? "budget_blocked"
      : safety.overlapBlocked
        ? "overlap_blocked"
        : safety.circuitOpen
          ? "circuit_open"
          : "blocked";
    runtimeGuards.lastRunAt = startedAt;
    runtimeGuards.lastError = safety.blocks.map((b) => b.code).join(",");
    const artifact = {
      run: {
        id: runId,
        plan: plan.cfg.plan,
        profile: plan.profile,
        sport: plan.sport,
        lifecycle: plan.lifecycle,
        status,
        overlapBlocked: safety.overlapBlocked,
        budgetBlocked: safety.budgetBlocked,
        circuitOpen: safety.circuitOpen,
        apifyRunId: null,
        datasetId: null,
        requestedMaxItems: plan.input.maxItems,
        gamesExpected: null,
        gamesReturned: 0,
        gamesMatched: 0,
        gamesUnmatched: 0,
        observationsWritten: 0,
        duplicatesSkipped: 0,
        malformedRows: 0,
        schemaFingerprint: null,
        schemaDriftLevel: null,
        estimatedCostUsd: plan.estimatedCostUsd,
        actualCostUsd: null,
        costBasis: "ESTIMATED",
        errorClass: status,
        errorMessage: safety.blocks.map((b) => b.message).join("; "),
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        createdAt: startedAt,
      },
    };
    await persistCandidateRunArtifacts(opts.db, artifact);
    return {
      ok: false,
      blocked: true,
      status,
      blocks: safety.blocks,
      runId,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
      affectsProductionOdds: false,
      canQualify: false,
      canAuthorizeWager: false,
      estimatedCostUsd: plan.estimatedCostUsd,
    };
  }

  runtimeGuards.activeRunId = runId;
  let retries = 0;
  let lastErr = null;
  let shadowResult = null;

  try {
    if (Array.isArray(opts.rowsInject)) {
      shadowResult = {
        ok: true,
        configured: true,
        runId: `inject_${runId}`,
        datasetId: null,
        status: "SUCCEEDED",
        input: plan.input,
        rows: opts.rowsInject.map((r) => normalizeCandidateGameRow(r, {
          runId,
          lifecycle: plan.lifecycle,
        })).filter(Boolean),
        malformed: 0,
        gamesReturned: opts.rowsInject.length,
        estimatedCostUsd: estimateActorCostUsd(plan.input, { gamesReturned: opts.rowsInject.length }),
      };
      shadowResult.gamesReturned = shadowResult.rows.length;
    } else {
      const maxRetries = plan.cfg.maxRetries;
      while (retries <= maxRetries) {
        try {
          shadowResult = await runActionApifyShadow(env, {
            ...plan.input,
            freePlan: plan.freePlan,
            maxItems: plan.input.maxItems,
            fetchImpl: opts.fetchImpl,
            waitSecs: Math.floor(plan.cfg.maxRunDurationMs / 1000),
            testId: runId,
          });
          if (shadowResult?.ok) break;
          lastErr = shadowResult?.error || "actor-failed";
          retries += 1;
          if (retries <= maxRetries) {
            await sleep(Math.min(8000, 250 * 2 ** retries));
          }
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          retries += 1;
          if (retries <= maxRetries) await sleep(Math.min(8000, 250 * 2 ** retries));
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);

    if (!shadowResult?.ok) {
      runtimeGuards.consecutiveFailures += 1;
      if (runtimeGuards.consecutiveFailures >= plan.cfg.circuitBreakerThreshold) {
        runtimeGuards.circuitOpenUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      }
      runtimeGuards.lastRunAt = finishedAt;
      runtimeGuards.lastError = redactSecrets(String(lastErr || shadowResult?.error || "failed"), env.APIFY_TOKEN);
      const artifact = buildFailureArtifact({
        runId,
        plan,
        startedAt,
        finishedAt,
        durationMs,
        retries,
        error: runtimeGuards.lastError,
        circuitOpen: Boolean(runtimeGuards.circuitOpenUntil),
      });
      await persistCandidateRunArtifacts(opts.db, artifact);
      return {
        ok: false,
        runId,
        status: "failed",
        error: runtimeGuards.lastError,
        retries,
        circuitOpenUntil: runtimeGuards.circuitOpenUntil,
        provider: ACTION_APIFY_PROVIDER,
        sourceClass: ACTION_APIFY_SOURCE_CLASS,
        affectsProductionOdds: false,
        canQualify: false,
        canAuthorizeWager: false,
      };
    }

    // Success path
    runtimeGuards.consecutiveFailures = 0;
    runtimeGuards.circuitOpenUntil = null;

    const rawRows = shadowResult.rows || [];
    const normalized = rawRows
      .map((r) => (r && r.provider ? r : normalizeCandidateGameRow(r, { runId, lifecycle: plan.lifecycle })))
      .filter(Boolean);

    const priorSchema = await loadPriorSchemaFingerprint(opts.db);
    const schema = fingerprintSchema(
      Array.isArray(opts.rowsInject) && opts.rowsInject[0] ? opts.rowsInject[0] : normalized[0] || {},
      { previousFingerprint: priorSchema }
    );

    const fbisEvents = Array.isArray(opts.fbisEvents) ? opts.fbisEvents : [];
    const gamesExpected =
      opts.gamesExpected != null
        ? Number(opts.gamesExpected)
        : fbisEvents.length > 0
          ? fbisEvents.length
          : null;

    let gamesMatched = 0;
    let gamesUnmatched = 0;
    const matchDetails = [];
    const matchByActionId = new Map();
    for (const row of normalized) {
      if (!fbisEvents.length) {
        gamesUnmatched += 1;
        const detail = {
          actionGameId: row.actionGameId || row.gameId,
          confidence: "UNMATCHED",
          reason: "no-fbis-events",
          comparisonEligible: false,
          fbisEventId: null,
        };
        matchDetails.push(detail);
        matchByActionId.set(String(row.actionGameId || row.gameId), detail);
        continue;
      }
      const m = matchEventWithConfidence(row, fbisEvents);
      if (m.comparisonEligible) gamesMatched += 1;
      else gamesUnmatched += 1;
      const detail = {
        actionGameId: row.actionGameId || row.gameId,
        confidence: m.confidence,
        reason: m.reason,
        comparisonEligible: m.comparisonEligible,
        fbisEventId: m.comparisonEligible && m.candidate?.id ? String(m.candidate.id) : null,
        candidate: m.candidate || null,
      };
      matchDetails.push(detail);
      matchByActionId.set(String(row.actionGameId || row.gameId), { ...detail, ...m });
    }

    const denominators = computeMatchDenominators({
      fbisEvents,
      actionRows: normalized,
      matchDetails,
      requestedMaxItems: plan.input.maxItems,
    });

    const logicalCollectionKey =
      opts.logicalCollectionKey ||
      buildLogicalCollectionKey({
        sport: plan.sport,
        lifecycle: plan.lifecycle,
        profile: plan.profile,
        date: opts.date || null,
      });

    if (opts.db?.exec) {
      await ensureShadowProviderRun(opts.db, {
        runId,
        plan: {
          ...plan,
          apifyRunId: shadowResult.runId || null,
          datasetId: shadowResult.datasetId || null,
          gamesReturned: normalized.length,
          malformedRows: Number(shadowResult.malformed || 0),
          estimatedCostUsd: plan.estimatedCostUsd,
        },
        startedAt,
        finishedAt,
        status: "SUCCEEDED",
      });
    }

    let observationsWritten = 0;
    let duplicatesSkipped = 0;
    let booksWritten = 0;
    let splitsWritten = 0;
    let movementWritten = 0;
    let propsWritten = 0;
    const deadLetters = [];
    for (const row of normalized) {
      try {
        const match = matchByActionId.get(String(row.actionGameId || row.gameId)) || null;
        const ing = await ingestCandidateObservation(opts.db, row, {
          runId,
          sport: plan.sport,
          profile: plan.profile,
          lifecycle: plan.lifecycle,
          temporalClass: plan.temporalClass,
          match,
          logicalCollectionKey,
        });
        if (ing.duplicate) duplicatesSkipped += 1;
        else {
          observationsWritten += 1;
          booksWritten += Number(ing.marketPersist?.books || 0);
          splitsWritten += Number(ing.marketPersist?.splits || 0);
          movementWritten += Number(ing.marketPersist?.movement || 0);
          propsWritten += Number(ing.marketPersist?.props || 0);
        }
      } catch (err) {
        deadLetters.push({
          id: `dl_${globalThis.crypto.randomUUID().slice(0, 12)}`,
          runId,
          errorClass: "ingest_error",
          errorMessage: redactSecrets(err instanceof Error ? err.message : String(err), env.APIFY_TOKEN),
          payloadHash: row.rawPayloadHash || null,
          payloadExcerpt: null,
          sport: plan.sport,
          profile: plan.profile,
          createdAt: finishedAt,
        });
      }
    }

    const cost = buildCostLedgerEntry({
      runId,
      plan: plan.cfg.plan,
      sport: plan.sport,
      profile: plan.profile,
      input: plan.input,
      gamesReturned: normalized.length,
      actualTotalUsd: shadowResult.usage?.actualApifyCostUsd ?? null,
      createdAt: finishedAt,
    });

    runtimeGuards.monthToDateEstimatedCost =
      Number(opts.monthToDateCostUsd || runtimeGuards.monthToDateEstimatedCost || 0) +
      Number(cost.estimated_total_usd || 0);
    runtimeGuards.lastRunAt = finishedAt;
    runtimeGuards.lastSuccessAt = finishedAt;
    runtimeGuards.lastError = null;
    runtimeGuards.gamesLastRun = normalized.length;

    const partialRun =
      gamesExpected != null &&
      normalized.length > 0 &&
      normalized.length < Number(gamesExpected);

    const artifact = {
      run: {
        id: runId,
        plan: plan.cfg.plan,
        profile: plan.profile,
        sport: plan.sport,
        lifecycle: plan.lifecycle,
        status: schema.driftLevel === "BLOCK" ? "success_schema_block" : schema.promotionEligible ? "success" : "success_schema_warn",
        overlapBlocked: false,
        budgetBlocked: false,
        circuitOpen: false,
        apifyRunId: shadowResult.runId || null,
        datasetId: shadowResult.datasetId || null,
        requestedMaxItems: plan.input.maxItems,
        gamesExpected,
        gamesReturned: normalized.length,
        gamesMatched,
        gamesUnmatched,
        observationsWritten,
        duplicatesSkipped,
        malformedRows: Number(shadowResult.malformed || 0),
        schemaFingerprint: schema.fingerprint,
        schemaDriftLevel: schema.driftLevel,
        estimatedCostUsd: cost.estimated_total_usd,
        actualCostUsd: cost.actual_total_usd,
        costBasis: cost.cost_basis,
        errorClass: null,
        errorMessage: null,
        startedAt,
        finishedAt,
        durationMs,
        createdAt: startedAt,
        logicalCollectionKey,
        fbisEventsExpected: denominators.fbisEventsExpected,
        actionEventsReturned: denominators.actionEventsReturned,
        matchedEvents: denominators.matchedEvents,
        ambiguousEvents: denominators.ambiguousEvents,
        actionOnlyEvents: denominators.actionOnlyEvents,
        fbisOnlyEvents: denominators.fbisOnlyEvents,
        previousSchemaFingerprint: priorSchema?.fingerprint || null,
        schemaDriftDetailJson: JSON.stringify(schema.driftNotes || []),
        booksWritten,
        splitsWritten,
        movementWritten,
        propsWritten,
      },
      cost,
      reliability: {
        id: `rel_${runId}`,
        runId,
        sport: plan.sport,
        profile: plan.profile,
        lifecycle: plan.lifecycle,
        success: schema.driftLevel !== "BLOCK",
        httpStatus: 200,
        actorFailure: false,
        apiFailure: false,
        malformedPayload: Number(shadowResult.malformed || 0) > 0,
        emptyRun: normalized.length === 0,
        partialRun,
        schemaViolation: schema.driftLevel === "BLOCK",
        timeout: false,
        retries,
        latencyMs: durationMs,
        gamesExpected,
        gamesReturned: normalized.length,
        unmatchedGames: gamesUnmatched,
        duplicateRows: duplicatesSkipped,
        fbisEventsExpected: denominators.fbisEventsExpected,
        matchedEvents: denominators.matchedEvents,
        ambiguousEvents: denominators.ambiguousEvents,
        errorClass: null,
        errorMessage: null,
        createdAt: finishedAt,
        promotionEligible: schema.driftLevel !== "BLOCK",
      },
      schema: {
        id: `sch_${runId}`,
        runId,
        ...schema,
        previousFingerprint: priorSchema?.fingerprint || null,
        createdAt: finishedAt,
      },
      deadLetters,
    };

    await persistCandidateRunArtifacts(opts.db, artifact);
    await releaseSchedulerLease(opts.db, {
      scopeKey,
      runId,
      success: schema.driftLevel !== "BLOCK",
      errorClass: schema.driftLevel === "BLOCK" ? "schema_block" : null,
      errorMessage: null,
    });
    leaseHeld = false;

    return {
      ok: true,
      runId,
      status: artifact.run.status,
      provider: ACTION_APIFY_PROVIDER,
      sourceClass: ACTION_APIFY_SOURCE_CLASS,
      mode: "shadow",
      plan: plan.cfg.plan,
      profile: plan.profile,
      sport: plan.sport,
      lifecycle: plan.lifecycle,
      temporalClass: plan.temporalClass,
      requestedMaxItems: plan.input.maxItems,
      gamesExpected,
      gamesReturned: normalized.length,
      gamesMatched,
      gamesUnmatched,
      observationsWritten,
      duplicatesSkipped,
      booksWritten,
      splitsWritten,
      movementWritten,
      propsWritten,
      malformedRows: Number(shadowResult.malformed || 0),
      estimatedCostUsd: cost.estimated_total_usd,
      costBasis: cost.cost_basis,
      schemaDriftLevel: schema.driftLevel,
      schemaPromotionEligible: schema.driftLevel !== "BLOCK",
      priorSchemaFingerprint: priorSchema?.fingerprint || null,
      unmappedBooks: unmappedBookCoverage(normalized),
      matchDetails: matchDetails.slice(0, 50),
      denominators,
      logicalCollectionKey,
      rows: normalized,
      capabilitySummary: buildCapabilityAuditSummary(normalized, {
        sport: plan.sport,
        profile: plan.profile,
      }),
      cost,
      costWindows: aggregateCostWindows([cost], finishedAt),
      affectsProductionOdds: false,
      canQualify: false,
      canAuthorizeWager: false,
      inProductionRouter: false,
      decisionEligible: false,
    };
  } catch (err) {
    runtimeGuards.consecutiveFailures += 1;
    runtimeGuards.lastError = redactSecrets(err instanceof Error ? err.message : String(err), env.APIFY_TOKEN);
    return {
      ok: false,
      runId,
      ...isolateCandidateFailure(err),
      error: runtimeGuards.lastError,
    };
  } finally {
    runtimeGuards.activeRunId = null;
    if (typeof leaseHeld !== "undefined" && leaseHeld) {
      try {
        await releaseSchedulerLease(opts.db, {
          scopeKey,
          runId,
          success: false,
          errorClass: "released_on_exit",
          errorMessage: null,
        });
      } catch {
        // best-effort lease release
      }
    }
  }
}

function buildFailureArtifact({ runId, plan, startedAt, finishedAt, durationMs, retries, error, circuitOpen }) {
  return {
    run: {
      id: runId,
      plan: plan.cfg.plan,
      profile: plan.profile,
      sport: plan.sport,
      lifecycle: plan.lifecycle,
      status: "failed",
      overlapBlocked: false,
      budgetBlocked: false,
      circuitOpen,
      apifyRunId: null,
      datasetId: null,
      requestedMaxItems: plan.input.maxItems,
      gamesExpected: null,
      gamesReturned: 0,
      gamesMatched: 0,
      gamesUnmatched: 0,
      observationsWritten: 0,
      duplicatesSkipped: 0,
      malformedRows: 0,
      schemaFingerprint: null,
      schemaDriftLevel: null,
      estimatedCostUsd: plan.estimatedCostUsd,
      actualCostUsd: null,
      costBasis: "ESTIMATED",
      errorClass: "actor_failure",
      errorMessage: error,
      startedAt,
      finishedAt,
      durationMs,
      createdAt: startedAt,
    },
    reliability: {
      id: `rel_${runId}`,
      runId,
      sport: plan.sport,
      profile: plan.profile,
      success: false,
      httpStatus: null,
      actorFailure: true,
      apiFailure: true,
      malformedPayload: false,
      emptyRun: true,
      partialRun: false,
      schemaViolation: false,
      timeout: /timeout/i.test(String(error || "")),
      retries,
      latencyMs: durationMs,
      gamesExpected: null,
      gamesReturned: 0,
      unmatchedGames: 0,
      duplicateRows: 0,
      errorClass: "actor_failure",
      errorMessage: error,
      createdAt: finishedAt,
    },
    deadLetters: [
      {
        id: `dl_${runId}`,
        runId,
        errorClass: "actor_failure",
        errorMessage: error,
        payloadHash: null,
        payloadExcerpt: null,
        sport: plan.sport,
        profile: plan.profile,
        createdAt: finishedAt,
      },
    ],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Public health slice for Action candidate (no secrets).
 * @param {Record<string, string|undefined>} env
 * @param {Record<string, unknown>} [runtime]
 */
export function actionApifyCandidateHealth(env, runtime = {}) {
  const cfg = readCandidateConfig(env);
  return candidateHealthSection(cfg, {
    lastRunAt: runtime.lastRunAt ?? runtimeGuards.lastRunAt,
    lastSuccessAt: runtime.lastSuccessAt ?? runtimeGuards.lastSuccessAt,
    lastError: runtime.lastError ?? runtimeGuards.lastError,
    gamesLastRun: runtime.gamesLastRun ?? runtimeGuards.gamesLastRun,
    successRate7d: runtime.successRate7d ?? null,
    monthToDateEstimatedCost:
      runtime.monthToDateEstimatedCost ?? runtimeGuards.monthToDateEstimatedCost ?? null,
    promotionReadiness: runtime.promotionReadiness ?? "COLLECTING",
  });
}

/** Test helper — reset in-memory guards. */
export function resetCandidateRuntimeGuards() {
  runtimeGuards.activeRunId = null;
  runtimeGuards.consecutiveFailures = 0;
  runtimeGuards.circuitOpenUntil = null;
  runtimeGuards.lastRunAt = null;
  runtimeGuards.lastSuccessAt = null;
  runtimeGuards.lastError = null;
  runtimeGuards.gamesLastRun = null;
  runtimeGuards.monthToDateEstimatedCost = 0;
}
