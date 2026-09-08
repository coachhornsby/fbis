/**
 * NFL professional-football challenger v1.
 * Shadow-only until rolling OOS promotion criteria are met.
 *
 * Core identity:
 * opponent-adjusted team EPA/success -> pass/rush/explosive matchup -> QB -> trenches
 * -> special teams -> context -> uncertainty. No market inputs are permitted.
 */

import { pGreater } from "./metrics.js";
import { clamp, coverageSummary, finite, round1, weightedPresent } from "./deepModelCommon.js";

export const NFL_PRO_ID = "NFL-PRO-v1";
export const NFL_PRO_CONSTANTS = {
  leaguePpg: 22.5,
  hfa: 1.5,
  marginSigma: 13.8,
  totalSigma: 12.8,
  maxContextPoints: 2.0,
};

function sideFeatures(game, side) {
  return game?.nflFeatures?.[side] || game?.nflDeepInput?.[side] || game?.gameFeatures?.[side] || {};
}

function n(obj, ...keys) {
  for (const key of keys) {
    const v = finite(obj?.[key]);
    if (v != null) return v;
  }
  return null;
}

function boundedDelta(value, center, scale, cap = 4) {
  const v = finite(value);
  if (v == null) return null;
  return clamp((v - center) * scale, -cap, cap);
}

function teamPower(f = {}) {
  const offEpa = n(f, "offenseEpa", "offEpa", "epaOff");
  const defEpa = n(f, "defenseEpa", "defEpa", "epaDef");
  const success = n(f, "successRate", "offSuccessRate");
  const defSuccess = n(f, "successRateAllowed", "defSuccessRate");
  const early = n(f, "earlyDownEpa", "earlyDownOffEpa");
  const earlyDef = n(f, "earlyDownEpaAllowed", "earlyDownDefEpa");
  const components = [
    { value: offEpa == null ? null : offEpa * 16, weight: 0.34 },
    { value: defEpa == null ? null : -defEpa * 16, weight: 0.30 },
    { value: success == null ? null : (success - 0.42) * 24, weight: 0.12 },
    { value: defSuccess == null ? null : -(defSuccess - 0.42) * 24, weight: 0.10 },
    { value: early == null ? null : early * 11, weight: 0.08 },
    { value: earlyDef == null ? null : -earlyDef * 11, weight: 0.06 },
  ];
  return { value: weightedPresent(components), inputs: { offEpa, defEpa, success, defSuccess, early, earlyDef } };
}

function qbValue(f = {}) {
  const epa = n(f, "qbEpa", "qbEpaPerDropback", "dropbackEpa");
  const cpoe = n(f, "qbCpoe", "cpoe");
  const pressureEpa = n(f, "qbPressureEpa", "pressureEpa");
  const sack = n(f, "qbSackRate", "sackRate");
  const scramble = n(f, "qbScrambleEpa", "scrambleEpa");
  const prior = n(f, "qbPrior", "qbPriorValue");
  const value = weightedPresent([
    { value: epa == null ? null : epa * 8, weight: 0.44 },
    { value: cpoe == null ? null : cpoe * 0.22, weight: 0.16 },
    { value: pressureEpa == null ? null : pressureEpa * 5, weight: 0.14 },
    { value: sack == null ? null : -(sack - 0.07) * 16, weight: 0.10 },
    { value: scramble == null ? null : scramble * 3, weight: 0.06 },
    { value: prior, weight: 0.10 },
  ]);
  return { value: value == null ? null : clamp(value, -5, 5), inputs: { epa, cpoe, pressureEpa, sack, scramble, prior } };
}

function matchup(off = {}, def = {}) {
  const passOff = n(off, "passEpa", "dropbackEpa", "passOffEpa");
  const passDef = n(def, "passEpaAllowed", "passDefEpa");
  const rushOff = n(off, "rushEpa", "rushOffEpa");
  const rushDef = n(def, "rushEpaAllowed", "rushDefEpa");
  const explosiveOff = n(off, "explosiveRate", "explosivePassRate");
  const explosiveDef = n(def, "explosiveRateAllowed", "explosivePassRateAllowed");
  const pressureDef = n(def, "pressureRate", "defPressureRate");
  const pressureAllowed = n(off, "pressureRateAllowed", "pressureAllowed");
  const lineOff = n(off, "lineYards", "adjustedLineYards");
  const lineDef = n(def, "lineYardsAllowed", "adjustedLineYardsAllowed");
  const pass = passOff == null || passDef == null ? null : clamp((passOff - passDef) * 7, -2.8, 2.8);
  const rush = rushOff == null || rushDef == null ? null : clamp((rushOff - rushDef) * 4.5, -1.8, 1.8);
  const explosive = explosiveOff == null || explosiveDef == null ? null : clamp((explosiveOff - explosiveDef) * 14, -1.8, 1.8);
  const pressure = pressureDef == null || pressureAllowed == null ? null : clamp((pressureAllowed - pressureDef) * 7, -1.8, 1.8);
  const trenches = lineOff == null || lineDef == null ? null : clamp((lineOff - lineDef) * 0.5, -1.5, 1.5);
  return { pass, rush, explosive, pressure, trenches, total: [pass, rush, explosive, pressure, trenches].reduce((s, v) => s + (v ?? 0), 0) };
}

function specialTeams(f = {}) {
  const epa = n(f, "specialTeamsEpa", "stEpa");
  const points = n(f, "specialTeamsPoints", "stPoints");
  if (points != null) return clamp(points, -2, 2);
  if (epa != null) return clamp(epa * 5, -2, 2);
  return null;
}

function context(game, f = {}) {
  let points = 0;
  const rest = n(f, "restDays");
  if (rest != null) points += clamp((rest - 7) * 0.12, -0.8, 0.8);
  const travel = n(f, "travelMiles");
  if (travel != null) points -= clamp(Math.max(0, travel - 1000) / 2500, 0, 0.7);
  const tz = n(f, "timeZonesCrossed");
  if (tz != null) points -= clamp(Math.max(0, tz - 1) * 0.18, 0, 0.55);
  const altitude = n(f, "altitudeAdjustment");
  if (altitude != null) points += clamp(altitude, -0.5, 0.5);
  const weather = n(f, "weatherPoints");
  if (weather != null) points += clamp(weather, -0.75, 0.75);
  return clamp(points, -NFL_PRO_CONSTANTS.maxContextPoints, NFL_PRO_CONSTANTS.maxContextPoints);
}

export function projectNflProV1(game = {}) {
  const homeF = sideFeatures(game, "home");
  const awayF = sideFeatures(game, "away");
  const hp = teamPower(homeF);
  const ap = teamPower(awayF);
  const hq = qbValue(homeF);
  const aq = qbValue(awayF);
  if (hp.value == null || ap.value == null || hq.value == null || aq.value == null) {
    return {
      modelId: NFL_PRO_ID,
      version: "v1",
      role: "shadow",
      family: "professional-football",
      ok: false,
      reason: "core-epa-or-qb-features-missing",
      independent: true,
      marketInformed: false,
      canQualify: false,
    };
  }

  const hm = matchup(homeF, awayF);
  const am = matchup(awayF, homeF);
  const hst = specialTeams(homeF);
  const ast = specialTeams(awayF);
  const hc = context(game, homeF);
  const ac = context(game, awayF);
  const hfa = game.neutralSite ? 0 : NFL_PRO_CONSTANTS.hfa;

  const home = round1(clamp(NFL_PRO_CONSTANTS.leaguePpg + hp.value + hm.total + hq.value * 0.55 + (hst ?? 0) + hc + hfa / 2, 8, 42));
  const away = round1(clamp(NFL_PRO_CONSTANTS.leaguePpg + ap.value + am.total + aq.value * 0.55 + (ast ?? 0) + ac - hfa / 2, 8, 42));
  const margin = round1(home - away);
  const total = round1(home + away);
  const coverage = coverageSummary({
    teamEpa: hp.inputs.offEpa != null && hp.inputs.defEpa != null && ap.inputs.offEpa != null && ap.inputs.defEpa != null,
    success: hp.inputs.success != null && hp.inputs.defSuccess != null && ap.inputs.success != null && ap.inputs.defSuccess != null,
    earlyDown: hp.inputs.early != null && hp.inputs.earlyDef != null && ap.inputs.early != null && ap.inputs.earlyDef != null,
    quarterback: hq.value != null && aq.value != null,
    passMatchup: hm.pass != null && am.pass != null,
    rushMatchup: hm.rush != null && am.rush != null,
    explosives: hm.explosive != null && am.explosive != null,
    pressure: hm.pressure != null && am.pressure != null,
    trenches: hm.trenches != null && am.trenches != null,
    specialTeams: hst != null && ast != null,
    context: Object.keys(homeF).some((k) => /rest|travel|weather|altitude|timeZone/i.test(k)) || Object.keys(awayF).some((k) => /rest|travel|weather|altitude|timeZone/i.test(k)),
  });
  const uncertaintyMultiplier = 1 + (1 - coverage.share) * 0.28;

  return {
    modelId: NFL_PRO_ID,
    version: "v1",
    role: "shadow",
    family: "professional-football",
    ok: true,
    home,
    away,
    margin,
    total,
    pHomeWin: pGreater(margin, 0, NFL_PRO_CONSTANTS.marginSigma * uncertaintyMultiplier),
    sigmaMargin: round1(NFL_PRO_CONSTANTS.marginSigma * uncertaintyMultiplier),
    sigmaTotal: round1(NFL_PRO_CONSTANTS.totalSigma * (1 + (1 - coverage.share) * 0.2)),
    independent: true,
    marketInformed: false,
    canQualify: false,
    coverage,
    decomposition: {
      baseLeaguePpg: NFL_PRO_CONSTANTS.leaguePpg,
      home: { teamPower: hp.value, matchup: hm, qb: hq, specialTeams: hst, context: hc, hfa: hfa / 2 },
      away: { teamPower: ap.value, matchup: am, qb: aq, specialTeams: ast, context: ac, hfa: -hfa / 2 },
    },
    provenance: {
      marketUsed: false,
      recordUsedAsCoreInput: false,
      rawPpgUsedAsCoreInput: false,
      turnoverMarginUsedAsCoreInput: false,
      qbSeparatedFromTeamBaseline: true,
      missingFeaturesRemainMissing: true,
    },
  };
}

export function attachNflProShadow(games = []) {
  let available = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "nfl") return game;
    const projection = projectNflProV1(game);
    if (projection.ok) available += 1;
    return {
      ...game,
      challengers: { ...(game.challengers || {}), [NFL_PRO_ID]: projection },
      nflProShadow: projection,
    };
  });
  return {
    games: next,
    meta: {
      modelId: NFL_PRO_ID,
      role: "shadow",
      available,
      games: next.length,
      qualificationAllowed: false,
      note: "NFL professional-football challenger. Production NFL remains blocked until this or a successor earns promotion through frozen rolling OOS evidence.",
    },
  };
}
