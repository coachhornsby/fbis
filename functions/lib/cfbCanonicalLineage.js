/**
 * Canonical feature lineage for CFB weekly feature pipeline.
 * SDV and CFBD raw archives remain separate; features carry full provenance.
 * Never blind-average incompatible provider statistics.
 */

export const LINEAGE_VERSION = "cfb-canonical-lineage-v1";

/** Precedence when both providers supply an overlapping concept. */
export const PROVIDER_PRECEDENCE = Object.freeze({
  /** Champion / fitted production scoring path — CFBD only. */
  champion: Object.freeze(["cfbd"]),
  /** Research challengers may prefer CFBD, then SDV with explicit flag. */
  research: Object.freeze(["cfbd", "sdv"]),
  /** UI display may show either; never implies model eligibility. */
  display: Object.freeze(["cfbd", "sdv"]),
});

/** Concepts that look similar across providers but are NOT interchangeable. */
export const INCOMPATIBLE_OVERLAPS = Object.freeze([
  {
    concept: "epa_or_ppa_per_play",
    providers: ["cfbd:ppaOff", "sdv:net_adj_epa|adj_off_epa"],
    rule: "reject_average",
    reason: "CFBD PPA and SDV opponent-adjusted EPA ranks/units differ; never average",
  },
  {
    concept: "core_vs_points",
    providers: ["cfbd:core", "cfbd:coreOffense"],
    rule: "research_transform_required",
    reason: "CORE is per-~100-play efficiency — not scoreboard points without validated transform",
  },
  {
    concept: "games_played_vs_through_week",
    providers: ["cfbd:gamesPlayed", "cfbd:coreThroughWeek"],
    rule: "schedule_preferred_flag_fallback",
    reason: "coreThroughWeek is a week bound, not verified gamesPlayed",
  },
]);

/**
 * Build one canonical lineage record for a feature observation.
 * Missing fields stay null — never invent zeros.
 */
export function buildLineageRecord({
  provider,
  sourceDataset,
  originalField,
  canonicalFeature,
  teamId = null,
  gameId = null,
  season = null,
  throughWeek = null,
  units = null,
  originalValue = null,
  transformedValue = null,
  transformations = [],
  publicationTime = null,
  collectionTime = null,
  ingestionBatchId = null,
  validationStatus = "unvalidated",
  modelEligibility = "none",
  missingness = false,
  dataQualityFlags = [],
  contentHash = null,
} = {}) {
  const collected = collectionTime || new Date().toISOString();
  return {
    lineageVersion: LINEAGE_VERSION,
    provider: provider || null,
    sourceDataset: sourceDataset || null,
    originalField: originalField || null,
    canonicalFeature: canonicalFeature || null,
    teamId: teamId != null ? String(teamId) : null,
    gameId: gameId != null ? String(gameId) : null,
    season: season != null ? Number(season) : null,
    throughWeek: throughWeek != null ? Number(throughWeek) : null,
    units: units || null,
    originalValue: originalValue ?? null,
    transformedValue: transformedValue ?? originalValue ?? null,
    transformations: Array.isArray(transformations) ? [...transformations] : [],
    publicationTime: publicationTime || null,
    collectionTime: collected,
    ingestionBatchId: ingestionBatchId || null,
    validationStatus,
    modelEligibility,
    missingness: Boolean(missingness) || originalValue == null,
    dataQualityFlags: Array.isArray(dataQualityFlags) ? [...dataQualityFlags] : [],
    contentHash: contentHash || null,
  };
}

/**
 * Resolve overlapping provider values with explicit precedence.
 * Does not average. Returns winner + conflict diagnostics.
 */
export function resolveProviderConflict({
  concept,
  candidates = [],
  purpose = "champion",
} = {}) {
  const precedence = PROVIDER_PRECEDENCE[purpose] || PROVIDER_PRECEDENCE.champion;
  const incompatible = INCOMPATIBLE_OVERLAPS.find((o) => o.concept === concept);

  const usable = (candidates || []).filter((c) => {
    if (c == null || c.value == null || c.value === "") return false;
    const n = Number(c.value);
    return Number.isFinite(n) || typeof c.value === "string";
  });

  if (usable.length === 0) {
    return {
      ok: false,
      value: null,
      winner: null,
      rule: "no_candidates",
      conflict: false,
      reason: "No provider values present",
      incompatibleRule: incompatible?.rule || null,
    };
  }

  if (incompatible?.rule === "reject_average" && usable.length > 1) {
    const providers = [...new Set(usable.map((c) => c.provider))];
    if (providers.length > 1) {
      // Prefer precedence order without averaging
      for (const p of precedence) {
        const hit = usable.find((c) => c.provider === p);
        if (hit) {
          return {
            ok: true,
            value: hit.value,
            winner: hit,
            rule: "precedence_no_average",
            conflict: true,
            reason: incompatible.reason,
            discarded: usable.filter((c) => c !== hit),
            incompatibleRule: incompatible.rule,
          };
        }
      }
    }
  }

  for (const p of precedence) {
    const hit = usable.find((c) => c.provider === p);
    if (hit) {
      return {
        ok: true,
        value: hit.value,
        winner: hit,
        rule: "precedence",
        conflict: usable.length > 1,
        reason: usable.length > 1 ? `Selected ${p} by ${purpose} precedence` : "Single candidate",
        discarded: usable.filter((c) => c !== hit),
        incompatibleRule: incompatible?.rule || null,
      };
    }
  }

  const first = usable[0];
  return {
    ok: true,
    value: first.value,
    winner: first,
    rule: "first_available",
    conflict: usable.length > 1,
    reason: "No precedence match; took first usable",
    discarded: usable.slice(1),
    incompatibleRule: incompatible?.rule || null,
  };
}

/**
 * Attach lineage map to a team feature snapshot for audit/replay.
 */
export function attachLineageMap(features = {}, lineageByCanonical = {}) {
  return {
    features: { ...features },
    lineage: { ...lineageByCanonical },
    lineageVersion: LINEAGE_VERSION,
  };
}

/**
 * Validate that champion-eligible features were not silently filled from
 * a later full-season aggregate without retrospective labeling.
 */
export function assertNotSilentRetrospective({
  featureAsOf = null,
  seasonComplete = false,
  labeledRetrospective = false,
  sourceGrain = null,
} = {}) {
  if (seasonComplete && sourceGrain === "season" && !labeledRetrospective) {
    return {
      ok: false,
      error: "retrospective_reconstruction_unlabeled",
      message:
        "Full-season aggregate cannot backfill historical pregame values without explicit retrospective label",
    };
  }
  if (!featureAsOf && sourceGrain === "season") {
    return {
      ok: false,
      error: "season_aggregate_missing_as_of",
      message: "Season aggregate requires featureAsOf for pregame safety",
    };
  }
  return { ok: true, error: null, message: null };
}
