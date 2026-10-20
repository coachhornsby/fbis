/**
 * CORE Week continuity: movement reports between archived throughWeeks.
 * Does not invent ratings — compares stored CFBD CORE PIT snapshots only.
 * Research-only; never touches champion A/A or wagering.
 */

export const CORE_CONTINUITY_VERSION = "cfb-core-continuity-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @typedef {{ schoolKey: string, core: number|null, coreOffense: number|null, coreDefense: number|null, throughWeek: number, source?: string }} CoreTeamSnap
 */

/**
 * Build per-team movement between two throughWeek snapshots.
 * Flags identical values across differently labeled weeks as labeling/source lag,
 * not genuine performance change.
 */
export function buildCoreWeeklyMovement({
  earlier = [],
  later = [],
  earlierThroughWeek = null,
  laterThroughWeek = null,
  epsilon = 0.001,
} = {}) {
  const earlyMap = new Map(
    (earlier || []).map((r) => [String(r.schoolKey || r.school_key || "").toLowerCase(), r])
  );
  const lateMap = new Map(
    (later || []).map((r) => [String(r.schoolKey || r.school_key || "").toLowerCase(), r])
  );
  const keys = new Set([...earlyMap.keys(), ...lateMap.keys()]);
  keys.delete("");

  const rows = [];
  let genuineMoves = 0;
  let identical = 0;
  let missingEarlier = 0;
  let missingLater = 0;

  for (const key of [...keys].sort()) {
    const a = earlyMap.get(key);
    const b = lateMap.get(key);
    if (!a && b) {
      missingEarlier += 1;
      rows.push({
        schoolKey: key,
        classification: "appeared_later",
        earlierThroughWeek,
        laterThroughWeek,
        earlier: null,
        later: {
          core: num(b.core),
          offense: num(b.coreOffense ?? b.core_offense),
          defense: num(b.coreDefense ?? b.core_defense),
        },
        delta: null,
      });
      continue;
    }
    if (a && !b) {
      missingLater += 1;
      rows.push({
        schoolKey: key,
        classification: "missing_later",
        earlierThroughWeek,
        laterThroughWeek,
        earlier: {
          core: num(a.core),
          offense: num(a.coreOffense ?? a.core_offense),
          defense: num(a.coreDefense ?? a.core_defense),
        },
        later: null,
        delta: null,
      });
      continue;
    }
    const ea = {
      core: num(a.core),
      offense: num(a.coreOffense ?? a.core_offense),
      defense: num(a.coreDefense ?? a.core_defense),
    };
    const eb = {
      core: num(b.core),
      offense: num(b.coreOffense ?? b.core_offense),
      defense: num(b.coreDefense ?? b.core_defense),
    };
    const dCore = ea.core != null && eb.core != null ? eb.core - ea.core : null;
    const dOff =
      ea.offense != null && eb.offense != null ? eb.offense - ea.offense : null;
    const dDef =
      ea.defense != null && eb.defense != null ? eb.defense - ea.defense : null;
    const same =
      dCore != null &&
      Math.abs(dCore) <= epsilon &&
      (dOff == null || Math.abs(dOff) <= epsilon) &&
      (dDef == null || Math.abs(dDef) <= epsilon);

    let classification = "genuine_performance_change";
    if (same) {
      classification =
        Number(earlierThroughWeek) !== Number(laterThroughWeek)
          ? "identical_across_labels_source_lag_or_relabel"
          : "unchanged";
      identical += 1;
    } else {
      genuineMoves += 1;
    }

    rows.push({
      schoolKey: key,
      classification,
      earlierThroughWeek,
      laterThroughWeek,
      earlier: ea,
      later: eb,
      delta: { core: dCore, offense: dOff, defense: dDef },
    });
  }

  rows.sort((x, y) => Math.abs(y.delta?.core || 0) - Math.abs(x.delta?.core || 0));

  return {
    version: CORE_CONTINUITY_VERSION,
    earlierThroughWeek,
    laterThroughWeek,
    teamCount: keys.size,
    genuineMoves,
    identical,
    missingEarlier,
    missingLater,
    rows,
    summaryNote:
      genuineMoves === 0 && identical > 0 && Number(earlierThroughWeek) !== Number(laterThroughWeek)
        ? "No measurable CORE value changes between labeled weeks — treat as source lag or archive relabel, not performance movement"
        : genuineMoves > 0
          ? "Value deltas present; verify both sides are distinct CFBD throughWeek publishes before attributing to on-field change"
          : "Insufficient paired snapshots",
  };
}

/**
 * Challenger fit readiness from available PIT corpus.
 */
export function assessCoreChallengerCorpus({
  archivedThroughWeeks = [],
  shadowPredictionCount = 0,
  verifiedOosArtifacts = 0,
  minThroughWeeks = 3,
  /** Evidence-based default: 2025 foundation + 2026 eval — not a fixed three-season wait. */
  minSeasons = 2,
  seasonsCovered = 1,
} = {}) {
  const weeks = [...new Set((archivedThroughWeeks || []).map(Number).filter((w) => w > 0))].sort(
    (a, b) => a - b
  );
  const missing = [];
  if (weeks.length < minThroughWeeks) {
    missing.push({
      code: "insufficient_pit_through_weeks",
      have: weeks,
      need: `≥${minThroughWeeks} distinct weekly CORE feature states in-season`,
    });
  }
  if (seasonsCovered < minSeasons) {
    missing.push({
      code: "insufficient_multi_season_coverage",
      have: seasonsCovered,
      need: `≥${minSeasons} seasons with preserved weekly states (2025 foundation → 2026 eval; not a fixed 3-season rule)`,
    });
  }
  if (!(verifiedOosArtifacts > 0)) {
    missing.push({
      code: "no_verified_oos_artifact",
      have: verifiedOosArtifacts,
      need: "Fitted OOS ridge artifact with verified_oos=true before CORE shadow scores",
    });
  }
  if (!(shadowPredictionCount > 0)) {
    missing.push({
      code: "no_prospective_shadow_rows",
      have: shadowPredictionCount,
      need: "Prospective freeze ledger rows before promotion claims",
    });
  }

  return {
    version: CORE_CONTINUITY_VERSION,
    sufficientToFitAndEvaluate: missing.length === 0,
    eligibilityMode: "evidence_based",
    fixedThreeSeasonRequirement: false,
    archivedThroughWeeks: weeks,
    seasonsCovered,
    shadowPredictionCount,
    verifiedOosArtifacts,
    missing,
    backfillPlan: missing.length
      ? {
          steps: [
            "Reconstruct 2025 weekly training/CORE feature sequence (first preserved season)",
            "Continue 2026 weekly snapshots + prospective shadow freezes",
            "Persist archives keyed by actual throughWeek; keep CFBD API vs weekly docs distinct",
            "Verify cutoffs (throughWeek < gameWeek) before chronological Model C fit",
            "Never invent 2024-and-earlier weekly training document parity",
          ],
          leakageRule: "coreSourceAsOf < kickoff AND throughWeek < gameWeek AND same season",
        }
      : null,
    authority: "research_only",
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Publication tracking: compare a newly observed CORE throughWeek release against
 * a baseline archive (e.g. Week 8 publish vs Week 6 baseline). Records genuine
 * rating deltas and source timestamps. Does not invent publishes.
 */
export function trackCorePublicationRelease({
  baseline = [],
  current = [],
  baselineThroughWeek = null,
  currentThroughWeek = null,
  baselineCollectionTime = null,
  currentCollectionTime = null,
  baselinePublicationTime = null,
  currentPublicationTime = null,
  epsilon = 0.001,
} = {}) {
  const movement = buildCoreWeeklyMovement({
    earlier: baseline,
    later: current,
    earlierThroughWeek: baselineThroughWeek,
    laterThroughWeek: currentThroughWeek,
    epsilon,
  });
  const currentTw = num(currentThroughWeek);
  const baselineTw = num(baselineThroughWeek);
  const distinctPublish =
    currentTw != null &&
    baselineTw != null &&
    currentTw !== baselineTw &&
    movement.genuineMoves > 0;
  const identicalRelabel =
    currentTw != null &&
    baselineTw != null &&
    currentTw !== baselineTw &&
    movement.genuineMoves === 0 &&
    movement.identical > 0;

  return {
    version: CORE_CONTINUITY_VERSION,
    kind: "core_publication_track",
    baselineThroughWeek: baselineTw,
    currentThroughWeek: currentTw,
    timestamps: {
      baselineCollectionTime: baselineCollectionTime || null,
      currentCollectionTime: currentCollectionTime || null,
      baselinePublicationTime: baselinePublicationTime || null,
      currentPublicationTime: currentPublicationTime || null,
    },
    classification: distinctPublish
      ? "distinct_publish_with_rating_changes"
      : identicalRelabel
        ? "label_advance_without_value_change"
        : movement.teamCount === 0
          ? "insufficient_snapshots"
          : "compared",
    genuineMoves: movement.genuineMoves,
    identical: movement.identical,
    missingEarlier: movement.missingEarlier,
    missingLater: movement.missingLater,
    teamCount: movement.teamCount,
    topMoves: (movement.rows || [])
      .filter((r) => r.classification === "genuine_performance_change")
      .slice(0, 20)
      .map((r) => ({
        schoolKey: r.schoolKey,
        deltaCore: r.delta?.core ?? null,
        deltaOffense: r.delta?.offense ?? null,
        deltaDefense: r.delta?.defense ?? null,
        earlier: r.earlier,
        later: r.later,
      })),
    summaryNote: movement.summaryNote,
    researchOnly: true,
    canAuthorizeWager: false,
    canInfluenceProduction: false,
  };
}

/**
 * Matchup advantages from Week 8 Tier3 slate + CORE throughWeek snapshot.
 * Uses existing cross: homeOff−awayDef / awayOff−homeDef. Does not invent scores.
 */
export function buildCoreMatchupAdvantages({ games = [], coreBySchoolKey = new Map() } = {}) {
  const out = [];
  for (const g of games || []) {
    const homeKey = String(g.homeTeam || g.home_team || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const awayKey = String(g.awayTeam || g.away_team || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const home = coreBySchoolKey.get(homeKey) || null;
    const away = coreBySchoolKey.get(awayKey) || null;
    const homeOff = num(home?.coreOffense ?? home?.core_offense);
    const homeDef = num(home?.coreDefense ?? home?.core_defense);
    const awayOff = num(away?.coreOffense ?? away?.core_offense);
    const awayDef = num(away?.coreDefense ?? away?.core_defense);
    const missing = [];
    if (!home) missing.push("home_core");
    if (!away) missing.push("away_core");
    if (homeOff == null || homeDef == null) missing.push("home_splits");
    if (awayOff == null || awayDef == null) missing.push("away_splits");
    const crossHome = homeOff != null && awayDef != null ? homeOff - awayDef : null;
    const crossAway = awayOff != null && homeDef != null ? awayOff - homeDef : null;
    out.push({
      gameId: g.gameId || g.game_id || null,
      homeTeam: g.homeTeam || g.home_team,
      awayTeam: g.awayTeam || g.away_team,
      homeCanonicalId: g.homeCanonicalId || null,
      awayCanonicalId: g.awayCanonicalId || null,
      identityStatus: g.identityStatus || null,
      homeCore: home ? num(home.core) : null,
      awayCore: away ? num(away.core) : null,
      homeOffense: homeOff,
      homeDefense: homeDef,
      awayOffense: awayOff,
      awayDefense: awayDef,
      coreCrossMargin:
        crossHome != null && crossAway != null ? crossHome - crossAway : null,
      coreCrossTotal:
        crossHome != null && crossAway != null ? crossHome + crossAway : null,
      throughWeek: num(home?.throughWeek ?? home?.through_week ?? away?.throughWeek),
      missing,
      eligible: missing.length === 0,
    });
  }
  return out;
}
