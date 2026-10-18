/**
 * Level-2 research feature builders: rolling windows, matchup vectors, CORE pairing.
 * Research-only — never mutates champion coefficients or authorizes wagers.
 * All rolling calculations must exclude the target game and later results.
 */

export const ADV_RESEARCH_VERSION = "cfb-advanced-research-features-v1";
export const RESEARCH_ONLY = Object.freeze({
  authority: "research_only",
  canInfluenceProduction: false,
  canAuthorizeWager: false,
  canQualify: false,
});

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rolling lookback over verified completed games before kickoff.
 * windows: [2,3,4] plus full season.
 */
export function buildRollingEfficiency({
  gameRows = [],
  teamKey,
  kickoffTimestamp = null,
  metricKeys = ["offensePpa", "defensePpa", "successRate", "explosiveRate"],
  windows = [2, 3, 4],
} = {}) {
  const kick = Date.parse(kickoffTimestamp || "") || Infinity;
  const key = String(teamKey || "").toLowerCase();
  const prior = (gameRows || [])
    .filter((g) => {
      const start = Date.parse(g.startDate || g.start || g.kickoff || "");
      if (!Number.isFinite(start) || start >= kick) return false;
      const home = String(g.homeTeam || g.home || "").toLowerCase();
      const away = String(g.awayTeam || g.away || "").toLowerCase();
      return home === key || away === key;
    })
    .sort((a, b) => Date.parse(b.startDate || b.start || 0) - Date.parse(a.startDate || a.start || 0));

  const avg = (rows, field) => {
    const vals = rows.map((r) => num(r[field])).filter((v) => v != null);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  const out = {
    version: ADV_RESEARCH_VERSION,
    ...RESEARCH_ONLY,
    teamKey,
    nGamesBeforeKick: prior.length,
    fullSeason: {},
    windows: {},
    trends: {},
  };
  for (const m of metricKeys) {
    out.fullSeason[m] = avg(prior, m);
  }
  for (const w of windows) {
    const slice = prior.slice(0, w);
    out.windows[`last${w}`] = { n: slice.length };
    for (const m of metricKeys) {
      out.windows[`last${w}`][m] = avg(slice, m);
      const recent = out.windows[`last${w}`][m];
      const base = out.fullSeason[m];
      out.trends[`last${w}_minus_season_${m}`] =
        recent != null && base != null ? recent - base : null;
    }
  }
  return out;
}

/**
 * Opponent-versus-opponent matchup vector from team efficiency sides.
 * Preserves units; does not invent point conversions.
 */
export function buildMatchupVector({
  offense = {},
  defense = {},
  throughWeek = null,
  sampleQuality = null,
} = {}) {
  const mismatch = (offKey, defKey) => {
    const o = num(offense[offKey]);
    const d = num(defense[defKey]);
    if (o == null || d == null) return null;
    return o - d;
  };
  return {
    version: ADV_RESEARCH_VERSION,
    ...RESEARCH_ONLY,
    throughWeek,
    sampleQuality,
    unitsNote: "PPA/play and rates — not scoreboard points; CORE separate scale",
    passing: {
      offensePassPpa: num(offense.passEpa ?? offense.ppaPass),
      defensePassPpaAllowed: num(defense.passEpaAllowed ?? defense.ppaPassAllowed),
      mismatch: mismatch("passEpa", "passEpaAllowed") ?? mismatch("ppaPass", "ppaPassAllowed"),
    },
    rushing: {
      offenseRushPpa: num(offense.rushEpa ?? offense.ppaRush),
      defenseRushPpaAllowed: num(defense.rushEpaAllowed ?? defense.ppaRushAllowed),
      mismatch: mismatch("rushEpa", "rushEpaAllowed") ?? mismatch("ppaRush", "ppaRushAllowed"),
    },
    success: {
      offense: num(offense.successRate),
      defenseAllowed: num(defense.successRateAllowed),
      mismatch: (() => {
        const o = num(offense.successRate);
        const d = num(defense.successRateAllowed);
        return o != null && d != null ? o - d : null;
      })(),
    },
    explosiveness: {
      offense: num(offense.explosiveRate),
      defenseAllowed: num(defense.explosiveRateAllowed),
      mismatch: (() => {
        const o = num(offense.explosiveRate);
        const d = num(defense.explosiveRateAllowed);
        return o != null && d != null ? o - d : null;
      })(),
    },
    trenches: {
      offenseLineYards: num(offense.lineYards),
      defenseLineYards: num(defense.lineYardsAllowed ?? defense.lineYards),
      havocGenerated: num(defense.havocRate),
      havocAllowed: num(offense.havocAllowed),
    },
    drive: {
      offensePpo: num(offense.pointsPerOpportunity),
      defensePpoAllowed: num(defense.pointsPerOpportunityAllowed),
      mismatch: (() => {
        const o = num(offense.pointsPerOpportunity);
        const d = num(defense.pointsPerOpportunityAllowed);
        return o != null && d != null ? o - d : null;
      })(),
    },
    core: {
      offenseCore: num(offense.coreOffense),
      defenseCore: num(defense.coreDefense),
      mismatch: (() => {
        const o = num(offense.coreOffense);
        const d = num(defense.coreDefense);
        return o != null && d != null ? o - d : null;
      })(),
      units: "CORE per ~100 plays — not interchangeable with PPA→points",
      researchOnly: true,
    },
  };
}

/**
 * Bidirectional matchup package for a game (home offense vs away defense, etc.).
 */
export function buildGameMatchupFeatures({ home = {}, away = {}, throughWeek = null } = {}) {
  return {
    version: ADV_RESEARCH_VERSION,
    ...RESEARCH_ONLY,
    throughWeek,
    homeOffenseVsAwayDefense: buildMatchupVector({
      offense: home,
      defense: away,
      throughWeek,
    }),
    awayOffenseVsHomeDefense: buildMatchupVector({
      offense: away,
      defense: home,
      throughWeek,
    }),
  };
}

/**
 * Research model family labels (addendum §10) — evaluation harness ids only.
 */
export const RESEARCH_MODEL_FAMILY = Object.freeze({
  A_REPAIRED_CHAMPION: "A_repaired_champion",
  B_ADVANCED_CFBD: "B_advanced_cfbd",
  C_ADVANCED_CFBD_CORE: "C_advanced_cfbd_core",
  D_ADVANCED_CFBD_SDV: "D_advanced_cfbd_sdv",
  E_COMBINED_RESEARCH: "E_combined_research",
});

/**
 * Declare which feature families each research model is allowed to consume.
 * Does not fabricate coefficients.
 */
export function researchModelFeaturePlan() {
  return {
    version: ADV_RESEARCH_VERSION,
    ...RESEARCH_ONLY,
    models: {
      [RESEARCH_MODEL_FAMILY.A_REPAIRED_CHAMPION]: {
        levels: [FEATURE_LEVEL_L1()],
        note: "Existing CFB-FBIS-v2 fitted path only",
      },
      [RESEARCH_MODEL_FAMILY.B_ADVANCED_CFBD]: {
        levels: [FEATURE_LEVEL_L1(), FEATURE_LEVEL_L2()],
        includes: ["pass/rush PPA", "success", "explosiveness", "havoc", "line yards", "PPO", "rolling windows", "matchups"],
        excludes: ["CORE", "SDV", "live"],
      },
      [RESEARCH_MODEL_FAMILY.C_ADVANCED_CFBD_CORE]: {
        levels: [FEATURE_LEVEL_L1(), FEATURE_LEVEL_L2()],
        includes: ["Model B + CORE matchup"],
        excludes: ["SDV", "live"],
        corePromotion: false,
      },
      [RESEARCH_MODEL_FAMILY.D_ADVANCED_CFBD_SDV]: {
        levels: [FEATURE_LEVEL_L1(), FEATURE_LEVEL_L2()],
        includes: ["Model B + nonredundant SDV"],
        excludes: ["CORE unless separately gated", "live"],
      },
      [RESEARCH_MODEL_FAMILY.E_COMBINED_RESEARCH]: {
        levels: [FEATURE_LEVEL_L1(), FEATURE_LEVEL_L2()],
        includes: ["Train-selected union under leakage-safe validation"],
        excludes: ["Oct17-tuned thresholds", "live contamination"],
      },
    },
    oct17Note: "Oct17 is diagnostic only — never train/select thresholds on it then claim OOS proof",
  };
}

function FEATURE_LEVEL_L1() {
  return "L1_core_production";
}
function FEATURE_LEVEL_L2() {
  return "L2_advanced_research";
}

/**
 * GraphQL shadow plan — verify before replacing REST.
 */
export function graphqlShadowPlan() {
  return {
    version: ADV_RESEARCH_VERSION,
    ...RESEARCH_ONLY,
    status: "scaffolded_not_production",
    prerequisites: [
      "Authenticate and introspect schema under Tier 3",
      "Confirm GraphQL shares CFBD/CBBD allowance",
      "Measure cost vs equivalent REST bundle",
      "Author versioned query documents with tests",
      "Shadow-collect beside REST; compare parity",
      "Only then retire duplicate REST calls",
    ],
    candidateOperations: [
      "adjustedTeamMetrics",
      "ratings",
      "game",
      "gamePlayerStat",
      "scoreboard",
    ],
    liveSubscriptions: {
      status: "not_a_tuesday_prerequisite",
      rule: "Separate live research service; never rewrite frozen pregame history",
    },
  };
}
