/**
 * MLB deep challenger v1.
 * Research-only. It never overwrites the production Savant champion and can never qualify wagers.
 *
 * Identity:
 * offense + starter share + bullpen share + platoon/lineup + park/weather + defense + umpire.
 * Missing team-specific layers remain explicit; league-average fallback is used only where noted.
 */

import { pGreater } from "./metrics.js";
import { clamp, coverageSummary, finite, round1 } from "./deepModelCommon.js";

export const MLB_DEEP_ID = "MLB-FBIS-v2";
export const MLB_DEEP_CONSTANTS = {
  leagueRpg: 4.45,
  leagueEra: 4.15,
  leagueWoba: 0.320,
  expectedStarterInnings: 5.35,
  homeEdge: 1.04,
  marginSigma: 2.9,
  totalSigma: 3.6,
};

function factorFromEra(era) {
  const n = finite(era);
  return n == null ? 1 : clamp(n / MLB_DEEP_CONSTANTS.leagueEra, 0.62, 1.5);
}

function factorFromWoba(woba) {
  const n = finite(woba);
  return n == null ? 1 : clamp(n / MLB_DEEP_CONSTANTS.leagueWoba, 0.82, 1.18);
}

function pitcherBlend(starterEra, bullpenEra, starterInnings) {
  const ip = clamp(finite(starterInnings) ?? MLB_DEEP_CONSTANTS.expectedStarterInnings, 3, 7.5);
  const spShare = ip / 9;
  const bpShare = 1 - spShare;
  return {
    factor: factorFromEra(starterEra) * spShare + factorFromEra(bullpenEra) * bpShare,
    starterInnings: ip,
    starterShare: spShare,
    bullpenShare: bpShare,
  };
}

function defenseFactor(runsSaved) {
  const rs = finite(runsSaved);
  if (rs == null) return 1;
  return clamp(1 - rs / 700, 0.94, 1.06);
}

function environmentFactor(ctx = {}) {
  const park = finite(ctx.palParkRunFactor ?? ctx.parkFactor) ?? 1;
  const weather = finite(ctx.weatherRunFactor) ?? 1;
  const umpire = finite(ctx.umpireRunFactor) ?? 1;
  return clamp(park * weather * umpire, 0.78, 1.28);
}

function offenseRpg(teamRpg) {
  const n = finite(teamRpg);
  return n ?? MLB_DEEP_CONSTANTS.leagueRpg;
}

function palMatchupFactor(rcVsTypical, n) {
  const rc = finite(rcVsTypical);
  const sample = finite(n);
  if (rc == null || sample == null || sample < 3) return 1;
  // Research-only bounded feature. ±100 vs-typical maps to ±8%; never ingest Pal final score/probability.
  return clamp(1 + (rc / 100) * 0.08, 0.92, 1.08);
}

export function projectMlbDeep(game = {}) {
  const sv = game.savant || {};
  const ctx = game.mlbContext || game.mlbDeepInput || {};
  const homeRpg = finite(sv.homeRpg);
  const awayRpg = finite(sv.awayRpg);
  const homeSpEra = finite(sv.homeSpEra);
  const awaySpEra = finite(sv.awaySpEra);
  if (homeRpg == null || awayRpg == null || homeSpEra == null || awaySpEra == null) {
    return {
      modelId: MLB_DEEP_ID,
      version: "research-v2",
      role: "shadow",
      family: "run-allocation",
      ok: false,
      reason: "starter-or-team-offense-missing",
      independent: true,
      marketInformed: false,
      canQualify: false,
    };
  }

  const homeBpEra = finite(ctx.homeBullpenEra);
  const awayBpEra = finite(ctx.awayBullpenEra);
  const homePitch = pitcherBlend(homeSpEra, homeBpEra ?? MLB_DEEP_CONSTANTS.leagueEra, ctx.homeStarterExpectedInnings);
  const awayPitch = pitcherBlend(awaySpEra, awayBpEra ?? MLB_DEEP_CONSTANTS.leagueEra, ctx.awayStarterExpectedInnings);
  const env = environmentFactor(ctx);
  const homePlatoon = factorFromWoba(ctx.homePlatoonWoba ?? ctx.homeLineupWoba);
  const awayPlatoon = factorFromWoba(ctx.awayPlatoonWoba ?? ctx.awayLineupWoba);
  const homeDefenseOpp = defenseFactor(ctx.awayDefenseRunsSaved);
  const awayDefenseOpp = defenseFactor(ctx.homeDefenseRunsSaved);
  const homePalMatchup = palMatchupFactor(ctx.homePalRcVsTypical, ctx.homePalMatchupN);
  const awayPalMatchup = palMatchupFactor(ctx.awayPalRcVsTypical, ctx.awayPalMatchupN);

  const home = round1(clamp(
    offenseRpg(homeRpg) * awayPitch.factor * homePlatoon * homeDefenseOpp * homePalMatchup * env * MLB_DEEP_CONSTANTS.homeEdge,
    1.4,
    8.5
  ));
  const away = round1(clamp(
    offenseRpg(awayRpg) * homePitch.factor * awayPlatoon * awayDefenseOpp * awayPalMatchup * env,
    1.4,
    8.5
  ));
  const margin = round1(home - away);
  const total = round1(home + away);
  const coverage = coverageSummary({
    teamOffense: homeRpg != null && awayRpg != null,
    starters: homeSpEra != null && awaySpEra != null,
    bullpen: homeBpEra != null && awayBpEra != null,
    platoonLineup: finite(ctx.homePlatoonWoba ?? ctx.homeLineupWoba) != null && finite(ctx.awayPlatoonWoba ?? ctx.awayLineupWoba) != null,
    park: finite(ctx.palParkRunFactor ?? ctx.parkFactor) != null,
    weather: finite(ctx.weatherRunFactor) != null,
    defense: finite(ctx.homeDefenseRunsSaved) != null && finite(ctx.awayDefenseRunsSaved) != null,
    umpire: finite(ctx.umpireRunFactor) != null,
    palMatchup: finite(ctx.homePalRcVsTypical) != null && finite(ctx.awayPalRcVsTypical) != null,
    officialLineups: ctx.palLineupsOfficial === true,
  });

  return {
    modelId: MLB_DEEP_ID,
    version: "research-v2",
    role: "shadow",
    family: "run-allocation",
    ok: true,
    home,
    away,
    margin,
    total,
    pHomeWin: pGreater(margin, 0, MLB_DEEP_CONSTANTS.marginSigma),
    sigmaMargin: MLB_DEEP_CONSTANTS.marginSigma,
    sigmaTotal: MLB_DEEP_CONSTANTS.totalSigma,
    independent: true,
    marketInformed: false,
    canQualify: false,
    coverage,
    missingnessPenalty: round1((1 - coverage.share) * 10) / 10,
    decomposition: {
      home: {
        offenseRpg: homeRpg,
        opposingStarterEra: awaySpEra,
        opposingBullpenEra: awayBpEra,
        starterShare: awayPitch.starterShare,
        bullpenShare: awayPitch.bullpenShare,
        pitcherFactor: awayPitch.factor,
        platoonFactor: homePlatoon,
        defenseFactor: homeDefenseOpp,
        environmentFactor: env,
        palMatchupFactor: homePalMatchup,
        palRcVsTypical: finite(ctx.homePalRcVsTypical),
        palMatchupN: finite(ctx.homePalMatchupN),
        homeEdge: MLB_DEEP_CONSTANTS.homeEdge,
      },
      away: {
        offenseRpg: awayRpg,
        opposingStarterEra: homeSpEra,
        opposingBullpenEra: homeBpEra,
        starterShare: homePitch.starterShare,
        bullpenShare: homePitch.bullpenShare,
        pitcherFactor: homePitch.factor,
        platoonFactor: awayPlatoon,
        defenseFactor: awayDefenseOpp,
        environmentFactor: env,
        palMatchupFactor: awayPalMatchup,
        palRcVsTypical: finite(ctx.awayPalRcVsTypical),
        palMatchupN: finite(ctx.awayPalMatchupN),
        homeEdge: 1,
      },
    },
    provenance: {
      marketUsed: false,
      championOverwritten: false,
      ballparkPalRole: "features-plus-external-challenger",
      palFinalProjectionUsed: false,
      palWinProbabilityUsed: false,
      palFeatureInputs: {
        parkRunFactor: finite(ctx.palParkRunFactor),
        parkHrFactor: finite(ctx.palParkHrFactor),
        lineupsOfficial: ctx.palLineupsOfficial === true,
        homeRcVsTypical: finite(ctx.homePalRcVsTypical),
        awayRcVsTypical: finite(ctx.awayPalRcVsTypical),
      },
      genericFallbacks: [
        ...(homeBpEra == null || awayBpEra == null ? ["league-average-bullpen-era"] : []),
        ...(finite(ctx.parkFactor) == null ? ["neutral-park-factor"] : []),
        ...(finite(ctx.weatherRunFactor) == null ? ["neutral-weather-factor"] : []),
        ...(finite(ctx.umpireRunFactor) == null ? ["neutral-umpire-factor"] : []),
      ],
    },
  };
}

export function attachMlbDeepShadow(games = []) {
  let available = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "mlb") return game;
    const projection = projectMlbDeep(game);
    if (projection.ok) available += 1;
    return {
      ...game,
      challengers: { ...(game.challengers || {}), [MLB_DEEP_ID]: projection },
      mlbDeepShadow: projection,
    };
  });
  return {
    games: next,
    meta: {
      modelId: MLB_DEEP_ID,
      role: "shadow",
      available,
      games: next.length,
      qualificationAllowed: false,
      note: "Run-allocation challenger. Ballpark Pal remains a separate external model and Pinnacle remains market benchmark.",
    },
  };
}
