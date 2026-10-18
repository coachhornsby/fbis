/**
 * Compact Projection Reliability payload for CFB game cards.
 * Research/display only — never authorizes wagers.
 */

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build reliability block from a CFB-FBIS-v2 projection + deep inputs.
 */
export function buildCfbProjectionReliability(game = {}, projection = null) {
  const proj = projection || game?.cfbFbisV2 || game?.challengers?.["CFB-FBIS-v2"] || {};
  const home = game?.cfbFbisV2Input?.home || game?.cfbDeepInput?.home || {};
  const away = game?.cfbFbisV2Input?.away || game?.cfbDeepInput?.away || {};
  const homeGames = num(home.gamesPlayed) || 0;
  const awayGames = num(away.gamesPlayed) || 0;
  const throughWeek =
    num(home.coreThroughWeek) ?? num(away.coreThroughWeek) ?? null;
  const priorDecay = proj.priorDecay || null;
  const missing = Array.isArray(proj.missingCurrentSignals) ? proj.missingCurrentSignals : [];
  const homeSource = home.gamesPlayedSource || null;
  const awaySource = away.gamesPlayedSource || null;
  const uncertainty =
    home.gamesPlayedUncertainty === true ||
    away.gamesPlayedUncertainty === true ||
    homeSource === "coreThroughWeekFallback" ||
    awaySource === "coreThroughWeekFallback";

  const homeOffPpa = num(home.offensePpa ?? home.ppaOff);
  const homeCurrOff = homeOffPpa == null ? null : 26.5 + homeOffPpa * 40;
  const projectedHome = num(proj.home ?? game.projHome ?? game.homeProj);
  // Material gap vs current-season PPA→points (Oklahoma repaired 30.4 vs ~24.9 = +5.5).
  const OFFENSE_EXCEED_THRESHOLD = 5;
  const exceedsCurrentOffenseProfile =
    homeCurrOff != null &&
    projectedHome != null &&
    projectedHome > homeCurrOff + OFFENSE_EXCEED_THRESHOLD;

  const provisional =
    proj.provisional === true ||
    game.projectionState === "PROVISIONAL" ||
    missing.length > 0 ||
    !(homeGames > 0 && awayGames > 0) ||
    uncertainty;

  return {
    available: true,
    authority: "research_display_only",
    canAuthorizeWager: false,
    currentSeasonGamesIncluded: { home: homeGames, away: awayGames },
    gamesPlayedSource: { home: homeSource, away: awaySource },
    gamesPlayedUncertainty: uncertainty,
    currentSeasonOffenseUsed: {
      homePpa: homeOffPpa,
      awayPpa: num(away.offensePpa ?? away.ppaOff),
      homePpaPoints: homeCurrOff,
      awayPpaPoints:
        num(away.offensePpa ?? away.ppaOff) == null
          ? null
          : 26.5 + num(away.offensePpa ?? away.ppaOff) * 40,
    },
    currentSeasonDefenseUsed: {
      homePpa: num(home.defensePpa ?? home.ppaDef),
      awayPpa: num(away.defensePpa ?? away.ppaDef),
    },
    throughWeek,
    priorSeasonContribution: priorDecay || {
      formula: "currentWeight = n/(n+6)",
      homeCurrentWeight: homeGames / (homeGames + 6),
      awayCurrentWeight: awayGames / (awayGames + 6),
    },
    sourceDataAge: {
      home: home.snapshotAsOf || home.coreSourceAsOf || null,
      away: away.snapshotAsOf || away.coreSourceAsOf || null,
    },
    missingCriticalInputs: missing,
    coreAvailability: {
      home: num(home.coreOffense) != null && num(home.coreDefense) != null,
      away: num(away.coreOffense) != null && num(away.coreDefense) != null,
      note: "CORE ratings are research-only; fitted champion does not consume CORE offense/defense",
    },
    projectionModelVersion: proj.modelId || "CFB-FBIS-v2",
    modelConfidence: provisional ? "provisional" : "supported",
    validationStatus: provisional
      ? "Incomplete evidence — treat as provisional"
      : "Current-season inputs present for both sides",
    exceedsCurrentOffenseProfile,
    exceedsCurrentOffenseEvidence: exceedsCurrentOffenseProfile
      ? {
          projectedHome,
          currentOffensePpaPoints: homeCurrOff,
          priorInfluence:
            priorDecay?.homeCurrentWeight != null
              ? 1 - priorDecay.homeCurrentWeight
              : homeGames / (homeGames + 6) === 0
                ? 1
                : 1 - homeGames / (homeGames + 6),
          note: "Projection exceeds current-season PPA-implied offense by >5 points; prior and/or fitted intercept may dominate",
        }
      : null,
    provisional,
  };
}
