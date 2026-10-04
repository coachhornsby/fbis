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
import { evaluateMlbF5Market, f5MoneylineProbabilities } from "./mlbF5.js";

export const MLB_DEEP_ID = "MLB-FBIS-v2";
export const MLB_DEEP_VERSION = "research-v2.3-pitch-zone";
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

function firstFivePitchFactor(starterEra, bullpenEra, starterInnings) {
  const ip = clamp(finite(starterInnings) ?? MLB_DEEP_CONSTANTS.expectedStarterInnings, 3, 7.5);
  const spF5 = Math.min(5, ip);
  const bpF5 = Math.max(0, 5 - spF5);
  return {
    factor: factorFromEra(starterEra) * (spF5 / 5) + factorFromEra(bullpenEra) * (bpF5 / 5),
    starterInningsF5: spF5,
    bullpenInningsF5: bpF5,
  };
}

function pitcherKProjection({ kPer9, inningsPerStart, expectedInnings, opponentKRate, leagueKRate, battersFacedPerInning, pitchMatchup }) {
  const k9 = finite(kPer9);
  const ip = clamp(
    finite(expectedInnings) ?? finite(inningsPerStart) ?? MLB_DEEP_CONSTANTS.expectedStarterInnings,
    3,
    7.5
  );
  const detailedKRate = finite(pitchMatchup?.lineupKRate);
  const bfPerIp = finite(battersFacedPerInning);
  if (detailedKRate != null && bfPerIp != null) {
    const bf = clamp(bfPerIp * ip, 12, 36);
    const projection = clamp(detailedKRate * bf, 1.0, 12.5);
    return {
      projection: round1(projection),
      sigma: round1(Math.sqrt(Math.max(0.25, bf * detailedKRate * (1 - detailedKRate)))),
      kPer9: k9 == null ? null : round1(k9),
      expectedInnings: round1(ip),
      battersFacedPerInning: Math.round(bfPerIp * 100) / 100,
      expectedBattersFaced: round1(bf),
      lineupKRate: Math.round(detailedKRate * 1000) / 1000,
      matchupCoverage: finite(pitchMatchup?.coverage),
      matchupWhiffRate: finite(pitchMatchup?.whiffPerSwing),
      matchupContactRate: finite(pitchMatchup?.contactPerSwing),
      matchupDynamicDifficulty: finite(pitchMatchup?.dynamicDifficulty),
      source: "STATCAST_PITCH_SHAPE_X_HITTER_ZONE_X_WORKLOAD",
      independentOfPalFinalProjection: true,
      calibrationState: pitchMatchup?.calibrationState || "RESEARCH_UNVALIDATED",
    };
  }
  if (k9 == null) return null;
  const opp = finite(opponentKRate);
  const lg = finite(leagueKRate) ?? 0.225;
  const opponentFactor = opp != null && lg > 0 ? clamp(opp / lg, 0.78, 1.22) : 1;
  return {
    projection: round1(clamp((k9 / 9) * ip * opponentFactor, 1.0, 12.5)),
    kPer9: round1(k9),
    expectedInnings: round1(ip),
    opponentKRate: opp,
    leagueKRate: lg,
    opponentFactor: Math.round(opponentFactor * 1000) / 1000,
    source: "MLB_STATS_STARTER_K_RATE_X_WORKLOAD_X_OPPONENT_K_RATE_FALLBACK",
    independentOfPalFinalProjection: true,
  };
}

function defenseFactor(runsSaved) {
  const rs = finite(runsSaved);
  if (rs == null) return 1;
  return clamp(1 - rs / 700, 0.94, 1.06);
}

function palParkFactor(ctx = {}) {
  const run = finite(ctx.palParkRunFactor ?? ctx.parkFactor) ?? 1;
  const hr = finite(ctx.palParkHrFactor);
  if (hr == null) return run;
  // Park run factor already contains much of the HR environment. Use only the
  // HR-vs-run residual as a small incremental feature to avoid double counting.
  const residual = clamp(hr - run, -0.25, 0.25);
  return clamp(run * (1 + residual * 0.12), 0.78, 1.28);
}

function environmentFactor(ctx = {}) {
  const park = palParkFactor(ctx);
  const weather = finite(ctx.weatherRunFactor) ?? 1;
  const umpire = finite(ctx.umpireRunFactor) ?? 1;
  return clamp(park * weather * umpire, 0.78, 1.28);
}

function offenseRpg(teamRpg) {
  const n = finite(teamRpg);
  return n ?? MLB_DEEP_CONSTANTS.leagueRpg;
}

function palMatchupComponents(rcVsTypical, hrVsTypical, kVsTypical, n) {
  const rc = finite(rcVsTypical);
  const hr = finite(hrVsTypical);
  const k = finite(kVsTypical);
  const sample = finite(n);
  if (sample == null || sample < 3 || (rc == null && hr == null && k == null)) {
    return { factor: 1, rcFactor: 1, hrFactor: 1, kFactor: 1, reliability: 0 };
  }
  const reliability = clamp(sample / 10, 0.30, 1);
  const rcAdj = rc == null ? 0 : clamp((rc / 100) * 0.06 * reliability, -0.06, 0.06);
  const hrAdj = hr == null ? 0 : clamp((hr / 100) * 0.025 * reliability, -0.025, 0.025);
  // Higher K-vs-typical is adverse to the offense, so its sign is inverted.
  const kAdj = k == null ? 0 : clamp(-(k / 100) * 0.025 * reliability, -0.025, 0.025);
  return {
    factor: clamp(1 + rcAdj + hrAdj + kAdj, 0.90, 1.10),
    rcFactor: 1 + rcAdj,
    hrFactor: 1 + hrAdj,
    kFactor: 1 + kAdj,
    reliability,
  };
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
      version: MLB_DEEP_VERSION,
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
  const homeInternalStarterInnings = finite(ctx.homeStarterExpectedInnings) ?? finite(sv.homeSpInningsPerStart);
  const awayInternalStarterInnings = finite(ctx.awayStarterExpectedInnings) ?? finite(sv.awaySpInningsPerStart);
  const homeStarterInnings = homeInternalStarterInnings ?? finite(ctx.homePalStarterExpectedInnings);
  const awayStarterInnings = awayInternalStarterInnings ?? finite(ctx.awayPalStarterExpectedInnings);
  const homePitch = pitcherBlend(homeSpEra, homeBpEra ?? MLB_DEEP_CONSTANTS.leagueEra, homeStarterInnings);
  const awayPitch = pitcherBlend(awaySpEra, awayBpEra ?? MLB_DEEP_CONSTANTS.leagueEra, awayStarterInnings);
  const env = environmentFactor(ctx);
  const homePlatoon = factorFromWoba(ctx.homePlatoonWoba ?? ctx.homeLineupWoba);
  const awayPlatoon = factorFromWoba(ctx.awayPlatoonWoba ?? ctx.awayLineupWoba);
  const homeDefenseOpp = defenseFactor(ctx.awayDefenseRunsSaved);
  const awayDefenseOpp = defenseFactor(ctx.homeDefenseRunsSaved);
  const homePal = palMatchupComponents(
    ctx.homePalRcVsTypical,
    ctx.homePalHrVsTypical,
    ctx.homePalKVsTypical,
    ctx.homePalMatchupN
  );
  const awayPal = palMatchupComponents(
    ctx.awayPalRcVsTypical,
    ctx.awayPalHrVsTypical,
    ctx.awayPalKVsTypical,
    ctx.awayPalMatchupN
  );
  const homePalMatchup = homePal.factor;
  const awayPalMatchup = awayPal.factor;
  const pitchMatchup = game.mlbPitchMatchup || {};
  const homeDetailed = pitchMatchup.homeOffense || null;
  const awayDetailed = pitchMatchup.awayOffense || null;
  const homeStarterRunFactor = finite(homeDetailed?.runFactor);
  const awayStarterRunFactor = finite(awayDetailed?.runFactor);
  const homeMatchupFactor = homeStarterRunFactor != null
    ? clamp(1 + (homeStarterRunFactor - 1) * awayPitch.starterShare, 0.92, 1.08)
    : homePalMatchup;
  const awayMatchupFactor = awayStarterRunFactor != null
    ? clamp(1 + (awayStarterRunFactor - 1) * homePitch.starterShare, 0.92, 1.08)
    : awayPalMatchup;

  const home = round1(clamp(
    offenseRpg(homeRpg) * awayPitch.factor * homePlatoon * homeDefenseOpp * homeMatchupFactor * env * MLB_DEEP_CONSTANTS.homeEdge,
    1.4,
    8.5
  ));
  const away = round1(clamp(
    offenseRpg(awayRpg) * homePitch.factor * awayPlatoon * awayDefenseOpp * awayMatchupFactor * env,
    1.4,
    8.5
  ));
  const margin = round1(home - away);
  const total = round1(home + away);

  const homeF5Pitch = firstFivePitchFactor(homeSpEra, homeBpEra ?? MLB_DEEP_CONSTANTS.leagueEra, homeInternalStarterInnings);
  const awayF5Pitch = firstFivePitchFactor(awaySpEra, awayBpEra ?? MLB_DEEP_CONSTANTS.leagueEra, awayInternalStarterInnings);
  const homeF5MatchupFactor = homeStarterRunFactor != null
    ? clamp(1 + (homeStarterRunFactor - 1) * (awayF5Pitch.starterInningsF5 / 5), 0.90, 1.10)
    : homePalMatchup;
  const awayF5MatchupFactor = awayStarterRunFactor != null
    ? clamp(1 + (awayStarterRunFactor - 1) * (homeF5Pitch.starterInningsF5 / 5), 0.90, 1.10)
    : awayPalMatchup;
  const f5Home = round1(clamp(
    offenseRpg(homeRpg) * (5 / 9) * awayF5Pitch.factor * homePlatoon * homeDefenseOpp * homeF5MatchupFactor * env * MLB_DEEP_CONSTANTS.homeEdge,
    0.5,
    6.5
  ));
  const f5Away = round1(clamp(
    offenseRpg(awayRpg) * (5 / 9) * homeF5Pitch.factor * awayPlatoon * awayDefenseOpp * awayF5MatchupFactor * env,
    0.5,
    6.5
  ));
  const f5Moneyline = f5MoneylineProbabilities(f5Home, f5Away);
  const f5 = {
    home: f5Home,
    away: f5Away,
    total: round1(f5Home + f5Away),
    margin: round1(f5Home - f5Away),
    probabilities: f5Moneyline ? {
      homeWin: f5Moneyline.home.win,
      awayWin: f5Moneyline.away.win,
      tie: f5Moneyline.home.push,
      homeConditional: f5Moneyline.home.conditionalWin,
      awayConditional: f5Moneyline.away.conditionalWin,
    } : null,
    source: "FBIS_F5_RUN_ALLOCATION",
    marketInformed: false,
    canQualify: false,
  };
  f5.market = evaluateMlbF5Market({
    projection: f5,
    market: game.odds?.f5 || null,
    lineupsOfficial: ctx.palLineupsOfficial,
  });

  const pitcherKs = {
    home: pitcherKProjection({
      kPer9: sv.homeSpKPer9,
      inningsPerStart: sv.homeSpInningsPerStart,
      expectedInnings: finite(ctx.homeStarterExpectedInnings),
      opponentKRate: sv.homeOpponentKRate,
      leagueKRate: sv.leagueKRate,
      battersFacedPerInning: sv.homeSpBattersFacedPerInning,
      pitchMatchup: awayDetailed,
    }),
    away: pitcherKProjection({
      kPer9: sv.awaySpKPer9,
      inningsPerStart: sv.awaySpInningsPerStart,
      expectedInnings: finite(ctx.awayStarterExpectedInnings),
      opponentKRate: sv.awayOpponentKRate,
      leagueKRate: sv.leagueKRate,
      battersFacedPerInning: sv.awaySpBattersFacedPerInning,
      pitchMatchup: homeDetailed,
    }),
  };
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
    pitchShapeZoneMatchup: Boolean(homeDetailed || awayDetailed),
    officialLineups: ctx.palLineupsOfficial === true,
  });

  return {
    modelId: MLB_DEEP_ID,
    version: MLB_DEEP_VERSION,
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
    f5,
    pitcherKs: {
      home: pitcherKs.home ? { ...pitcherKs.home, playerId: game.homeSp?.id ?? null, playerName: game.homeSp?.name ?? null, team: game.home?.abbr ?? null } : null,
      away: pitcherKs.away ? { ...pitcherKs.away, playerId: game.awaySp?.id ?? null, playerName: game.awaySp?.name ?? null, team: game.away?.abbr ?? null } : null,
    },
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
        matchupFactor: homeMatchupFactor,
        matchupSource: homeDetailed ? "STATCAST_PITCH_SHAPE_X_HITTER_ZONE" : "BALLPARK_PAL_AGGREGATE_FALLBACK",
        detailedStarterRunFactor: homeStarterRunFactor,
        detailedMatchup: homeDetailed,
        palMatchupFactor: homePalMatchup,
        palRcFactor: homePal.rcFactor,
        palHrFactor: homePal.hrFactor,
        palKFactor: homePal.kFactor,
        palReliability: homePal.reliability,
        palRcVsTypical: finite(ctx.homePalRcVsTypical),
        palHrVsTypical: finite(ctx.homePalHrVsTypical),
        palKVsTypical: finite(ctx.homePalKVsTypical),
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
        matchupFactor: awayMatchupFactor,
        matchupSource: awayDetailed ? "STATCAST_PITCH_SHAPE_X_HITTER_ZONE" : "BALLPARK_PAL_AGGREGATE_FALLBACK",
        detailedStarterRunFactor: awayStarterRunFactor,
        detailedMatchup: awayDetailed,
        palMatchupFactor: awayPalMatchup,
        palRcFactor: awayPal.rcFactor,
        palHrFactor: awayPal.hrFactor,
        palKFactor: awayPal.kFactor,
        palReliability: awayPal.reliability,
        palRcVsTypical: finite(ctx.awayPalRcVsTypical),
        palHrVsTypical: finite(ctx.awayPalHrVsTypical),
        palKVsTypical: finite(ctx.awayPalKVsTypical),
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
        homeHrVsTypical: finite(ctx.homePalHrVsTypical),
        awayHrVsTypical: finite(ctx.awayPalHrVsTypical),
        homeKVsTypical: finite(ctx.homePalKVsTypical),
        awayKVsTypical: finite(ctx.awayPalKVsTypical),
        homeStarterExpectedInnings: finite(ctx.homePalStarterExpectedInnings),
        awayStarterExpectedInnings: finite(ctx.awayPalStarterExpectedInnings),
        homeStarterProjectedKs: finite(ctx.homePalStarterProjectedKs),
        awayStarterProjectedKs: finite(ctx.awayPalStarterProjectedKs),
      },
      f5Policy: "FBIS first-five projection is independent of market prices. When Statcast pitch-shape x hitter-zone coverage is available it adjusts the starter component of F5 run allocation; Ballpark Pal aggregate matchup is fallback. Sportsbook F5 and Pal final F5 remain comparison-only.",
      pitcherKPolicy: "FBIS pitcher K projection prefers Statcast pitch-shape x hitter contact-zone matchup K-rate times expected batters faced/workload; MLB Stats K/9 x opponent team K-rate is fallback only. Pal projected Ks are comparison-only.",
      palUsageAudit: {
        scoreInputs: [
          "park run factor",
          "bounded park HR residual",
          "runs-created vs typical",
          "HR vs typical",
          "K vs typical",
          "starter expected innings fallback",
        ],
        qualityContext: ["official lineup flag", "matchup sample size", "as-of/request lineage"],
        externalCrossChecksOnly: ["Pal team run projection", "Pal win probability", "Pal F5 score/win projection", "Pal team-total probabilities"],
        propOnly: ["Pal player prop probabilities", "starter projected strikeouts"],
        prohibitedAsFbisScoreInputs: ["Pal final game score", "Pal final win probability", "Pal probabilities as sportsbook prices"],
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
      note: "Run-allocation challenger. Uses bounded Pal feature-level signals while Pal final scores/probabilities remain external cross-checks; Pinnacle remains the market benchmark.",
    },
  };
}
