/**
 * Action Network / Apify PRODUCTION-CANDIDATE configuration.
 *
 * Shadow / candidate only — never authoritative odds, never wager authorization.
 * Fail closed on unknown plan or malformed config.
 */

export const ACTION_APIFY_PLANS = Object.freeze(["free", "starter"]);

/** Free-plan Actor hard clamp (community Actor constraint). */
export const ACTION_APIFY_FREE_MAX_ITEMS = 10;

/** Safety upper bound even on paid plans (never unbounded). */
export const ACTION_APIFY_STARTER_SAFETY_CAP = 200;

export const ACTION_APIFY_DEFAULT_MONTHLY_BUDGET_USD = 19;

export const COLLECTION_PROFILES = Object.freeze({
  BASE: "BASE",
  MOVEMENT: "MOVEMENT",
  MLB_F5: "MLB_F5",
  PLAYER_PROPS: "PLAYER_PROPS",
  FINAL: "FINAL",
  /**
   * Bounded PPE capability audit only — enables BASE enrichments:
   * movement + player props + game props + game detail.
   * Shadow/research; never a routine production profile.
   */
  CAPABILITY_AUDIT: "CAPABILITY_AUDIT",
});

export const LIFECYCLE_PHASES = Object.freeze({
  /** Alias for early board snapshot (championship OPENING window). */
  OPENING: "opening",
  EARLY_SLATE: "early_slate",
  PREGAME: "pregame",
  FINAL_PREGAME: "final_pregame",
  POSTGAME: "postgame",
});

/** Observation temporal class — never invent timestamps. */
export const TEMPORAL_CLASS = Object.freeze({
  PREGAME_OBSERVATION: "pregame_observation",
  EVALUATION_CLOSE: "evaluation_close",
  UNKNOWN: "unknown",
});

export const MATCH_CONFIDENCE = Object.freeze({
  EXACT: "EXACT",
  HIGH: "HIGH",
  AMBIGUOUS: "AMBIGUOUS",
  UNMATCHED: "UNMATCHED",
});

export const PROMOTION_STATES = Object.freeze([
  "NOT_READY",
  "COLLECTING",
  "INSUFFICIENT_SAMPLE",
  "READY_FOR_REVIEW",
  "BLOCKED_RELIABILITY",
  "BLOCKED_TEMPORAL_INTEGRITY",
  "BLOCKED_SCHEMA_DRIFT",
  "BLOCKED_COST",
  "PRIMARY_CANDIDATE",
  "CO_PRIMARY_CANDIDATE",
  "SHADOW_ONLY",
]);

export const SCHEMA_DRIFT_LEVELS = Object.freeze({
  INFO: "INFO",
  WARN: "WARN",
  BLOCK: "BLOCK",
});

/**
 * @param {unknown} raw
 * @returns {"free"|"starter"}
 */
export function parseActionApifyPlan(raw) {
  const v = String(raw ?? "free").trim().toLowerCase();
  if (v === "free" || v === "starter") return v;
  const err = new Error(`Unknown ACTION_APIFY_PLAN="${raw}" — fail closed`);
  err.code = "ACTION_APIFY_UNKNOWN_PLAN";
  throw err;
}

/**
 * Plan-aware maxItems. Never infer starter from token presence.
 * @param {unknown} requested
 * @param {"free"|"starter"} plan
 * @param {{ starterCap?: number }} [opts]
 */
export function resolveMaxItems(requested, plan, opts = {}) {
  const starterCap = Number(opts.starterCap) > 0
    ? Math.floor(Number(opts.starterCap))
    : ACTION_APIFY_STARTER_SAFETY_CAP;
  const n = Number(requested);
  const req = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;

  if (plan === "free") {
    if (req == null) return ACTION_APIFY_FREE_MAX_ITEMS;
    return Math.min(req, ACTION_APIFY_FREE_MAX_ITEMS);
  }
  if (plan === "starter") {
    // Default to a board-sized pull, not the absolute safety cap (200 ≈ $1.46 and trips harvest soft-cap).
    if (req == null) return Math.min(80, starterCap);
    return Math.min(req, starterCap);
  }
  const err = new Error(`Unknown plan for maxItems: ${plan}`);
  err.code = "ACTION_APIFY_UNKNOWN_PLAN";
  throw err;
}

/**
 * Build Actor input flags from a collection profile.
 * Does not enable every expensive block by default.
 * @param {string} profile
 * @param {{ sport?: string, collectMovement?: boolean, collectMlbF5?: boolean, collectProps?: boolean }} [overrides]
 */
export function profileToActorFlags(profile, overrides = {}) {
  const p = String(profile || COLLECTION_PROFILES.BASE).toUpperCase();
  const sport = String(overrides.sport || "").toLowerCase();

  const flags = {
    includeLineMovement: false,
    includePlayerProps: false,
    includeGameProps: false,
    includeGameDetail: false,
    includeWeather: false,
    includeInjuries: false,
    includeStandings: false,
    includeFutures: false,
    periods: /** @type {string[]} */ ([]),
  };

  switch (p) {
    case COLLECTION_PROFILES.MOVEMENT:
      flags.includeLineMovement = true;
      break;
    case COLLECTION_PROFILES.MLB_F5:
      flags.periods = ["event", "firstfiveinnings"];
      break;
    case COLLECTION_PROFILES.PLAYER_PROPS:
      flags.includePlayerProps = true;
      break;
    case COLLECTION_PROFILES.FINAL:
      flags.includeLineMovement = true;
      flags.includeGameDetail = true;
      break;
    case COLLECTION_PROFILES.CAPABILITY_AUDIT:
      flags.includeLineMovement = true;
      flags.includePlayerProps = true;
      flags.includeGameProps = true;
      flags.includeGameDetail = true;
      break;
    case COLLECTION_PROFILES.BASE:
    default:
      break;
  }

  if (overrides.collectMovement === true) flags.includeLineMovement = true;
  if (overrides.collectMlbF5 === true && (sport === "mlb" || !sport)) {
    if (!flags.periods.includes("firstfiveinnings")) {
      flags.periods = [...(flags.periods.length ? flags.periods : ["event"]), "firstfiveinnings"];
    }
  }
  if (overrides.collectProps === true) flags.includePlayerProps = true;

  return flags;
}

/**
 * Lifecycle phase → recommended profile + temporal class.
 * @param {string} phase
 * @param {string} [sport]
 */
export function cadenceForPhase(phase, sport = "") {
  const p = String(phase || "").toLowerCase();
  const s = String(sport || "").toLowerCase();
  switch (p) {
    case LIFECYCLE_PHASES.OPENING:
    case "opening":
    case LIFECYCLE_PHASES.EARLY_SLATE:
    case "early":
      return {
        profile: COLLECTION_PROFILES.BASE,
        temporalClass: TEMPORAL_CLASS.PREGAME_OBSERVATION,
        gameStatus: "scheduled",
        championshipWindow: p === "early" || p === LIFECYCLE_PHASES.EARLY_SLATE ? "EARLY" : "OPENING",
      };
    case LIFECYCLE_PHASES.PREGAME:
      return {
        profile: COLLECTION_PROFILES.BASE,
        temporalClass: TEMPORAL_CLASS.PREGAME_OBSERVATION,
        gameStatus: "scheduled",
        preferMovementNearKickoff: true,
        championshipWindow: "PREGAME",
      };
    case LIFECYCLE_PHASES.FINAL_PREGAME:
      return {
        profile: COLLECTION_PROFILES.MOVEMENT,
        temporalClass: TEMPORAL_CLASS.PREGAME_OBSERVATION,
        gameStatus: "scheduled",
        championshipWindow: "FINAL_PREGAME",
      };
    case LIFECYCLE_PHASES.POSTGAME:
      return {
        profile: COLLECTION_PROFILES.FINAL,
        temporalClass: TEMPORAL_CLASS.EVALUATION_CLOSE,
        gameStatus: "complete",
        championshipWindow: "POSTGAME",
      };
    default:
      return {
        profile: s === "mlb" ? COLLECTION_PROFILES.BASE : COLLECTION_PROFILES.BASE,
        temporalClass: TEMPORAL_CLASS.PREGAME_OBSERVATION,
        gameStatus: "scheduled",
      };
  }
}

/**
 * Read candidate config from env. Fail-safe defaults.
 * Never infers starter from APIFY_TOKEN alone.
 * @param {Record<string, string|undefined>|null|undefined} env
 */
export function readCandidateConfig(env) {
  const e = env && typeof env === "object" ? env : {};
  const enabledRaw = String(e.ACTION_APIFY_ENABLED ?? "false").trim().toLowerCase();
  const enabled = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";

  let plan = "free";
  let planError = null;
  try {
    plan = parseActionApifyPlan(e.ACTION_APIFY_PLAN ?? "free");
  } catch (err) {
    planError = err instanceof Error ? err.message : String(err);
    plan = "free";
  }

  const configured = Boolean(String(e.APIFY_TOKEN || "").trim());
  const maxItemsEnv = e.ACTION_APIFY_MAX_ITEMS;
  let maxItems;
  try {
    maxItems = resolveMaxItems(
      maxItemsEnv != null && String(maxItemsEnv).trim() !== "" ? maxItemsEnv : null,
      planError ? "free" : plan,
      { starterCap: Number(e.ACTION_APIFY_STARTER_CAP) || ACTION_APIFY_STARTER_SAFETY_CAP },
    );
  } catch {
    maxItems = ACTION_APIFY_FREE_MAX_ITEMS;
  }

  const monthlyBudget = Number(e.ACTION_APIFY_MONTHLY_BUDGET_USD);
  const budgetUsd = Number.isFinite(monthlyBudget) && monthlyBudget > 0
    ? monthlyBudget
    : (plan === "starter" ? ACTION_APIFY_DEFAULT_MONTHLY_BUDGET_USD : 5);

  const profileFor = (sport, fallback) => {
    const key = `ACTION_APIFY_PROFILE_${String(sport).toUpperCase()}`;
    const v = String(e[key] || fallback || COLLECTION_PROFILES.BASE).trim().toUpperCase();
    return COLLECTION_PROFILES[v] || COLLECTION_PROFILES.BASE;
  };

  return {
    enabled: enabled && !planError,
    plan: planError ? "free" : plan,
    planError,
    configured,
    mode: "shadow",
    maxItems,
    monthlyBudgetUsd: budgetUsd,
    collectMovement: truthy(e.ACTION_APIFY_COLLECT_MOVEMENT),
    collectMlbF5: truthy(e.ACTION_APIFY_COLLECT_MLB_F5),
    collectProps: truthy(e.ACTION_APIFY_COLLECT_PROPS),
    rawRetention: String(e.ACTION_APIFY_RAW_RETENTION || "hash").trim().toLowerCase(),
    profiles: {
      cfb: profileFor("cfb", COLLECTION_PROFILES.BASE),
      nfl: profileFor("nfl", COLLECTION_PROFILES.BASE),
      mlb: profileFor("mlb", COLLECTION_PROFILES.BASE),
      nba: profileFor("nba", COLLECTION_PROFILES.BASE),
      cbb: profileFor("cbb", COLLECTION_PROFILES.BASE),
    },
    /** Circuit breaker: consecutive Actor failures before pause. */
    circuitBreakerThreshold: Math.max(1, Number(e.ACTION_APIFY_CIRCUIT_BREAKER) || 5),
    maxRunDurationMs: Math.max(30_000, Number(e.ACTION_APIFY_MAX_RUN_MS) || 180_000),
    maxRetries: Math.min(3, Math.max(0, Number(e.ACTION_APIFY_MAX_RETRIES) || 2)),
    perRunBudgetUsd: Number(e.ACTION_APIFY_PER_RUN_BUDGET_USD) > 0
      ? Number(e.ACTION_APIFY_PER_RUN_BUDGET_USD)
      : (plan === "free" ? 1.5 : 5),
  };
}

function truthy(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * Health-safe public candidate status (no secrets).
 * @param {ReturnType<typeof readCandidateConfig>} cfg
 * @param {Record<string, unknown>} [runtime]
 */
export function candidateHealthSection(cfg, runtime = {}) {
  const lastSuccessAt = runtime.lastSuccessAt ?? null;
  const lastRunAt = runtime.lastRunAt ?? null;
  const collectionLive = Boolean(lastSuccessAt || lastRunAt);
  return {
    mode: "shadow",
    role: "market_intelligence",
    governanceMode: "shadow",
    plan: cfg.plan,
    configured: Boolean(cfg.configured),
    enabled: Boolean(cfg.enabled),
    planError: cfg.planError || null,
    lastRunAt,
    lastSuccessAt,
    lastError: runtime.lastError ?? null,
    gamesLastRun: runtime.gamesLastRun ?? null,
    successRate7d: runtime.successRate7d ?? null,
    monthToDateEstimatedCost: runtime.monthToDateEstimatedCost ?? null,
    promotionReadiness: runtime.promotionReadiness ?? "NOT_READY",
    collectionLive,
    label: collectionLive
      ? "Live market intelligence (shadow-governed)"
      : "Market intelligence configured — awaiting first successful collection",
    note:
      "Manual-correct ACTION use: scheduled snapshots + model-vs-market / misprices. Not odds authority. Not PURE features. Not qualify/authorize.",
    inProductionRouter: false,
    decisionEligible: false,
    canQualify: false,
    canAuthorizeWager: false,
    affectsProductionOdds: false,
  };
}
