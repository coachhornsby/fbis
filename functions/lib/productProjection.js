/** Subscriber/public projection contract. Never returns raw SYS, executed-bet or source payloads. */
import { recommendBundle, pinMarkets } from "./slateEngine.js";
import { DEFAULT_WEIGHTS } from "./weights.js";

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function team(team = {}) {
  return {
    id: team.canonicalId || team.id || null,
    name: team.fullName || team.school || team.name || team.abbr || null,
    abbr: team.abbr || null,
    logo: team.logo || null,
  };
}

function americanFromProbability(p) {
  const q = finite(p);
  if (q == null || q <= 0 || q >= 1) return null;
  return Math.round(q >= 0.5 ? (-100 * q) / (1 - q) : (100 * (1 - q)) / q);
}

function modelIdentity(sport, game = {}) {
  const research =
    String(game.projectionMaturity || game.model?.maturity || "").toUpperCase() === "RESEARCH" ||
    game.canQualify === false;
  const independentFbis =
    (game.projectionKind === "FBIS" || game.model?.projectionKind === "FBIS") &&
    (Number.isFinite(Number(game.model?.projHome ?? game.projHome ?? game.projHomeScore)) &&
      Number.isFinite(Number(game.model?.projAway ?? game.projAway ?? game.projAwayScore)));

  if (sport === "mlb") {
    return {
      name: "FBIS MLB",
      engine: "Savant + Starter/Offense",
      independent: game.projectionKind === "FBIS" || game.model?.projectionKind === "FBIS",
      state: game.savant?.source || "MLB",
      maturity: "PRODUCTION",
    };
  }
  if (sport === "cfb") {
    return {
      name: "FBIS CFB",
      engine: "Power + Opponent Residual + Context",
      independent: game.projectionKind === "FBIS" || game.model?.projectionKind === "FBIS",
      state: game.cfb?.projectionState || game.projectionState || null,
      maturity: "PRODUCTION",
    };
  }
  if (sport === "cbb") {
    return {
      name: research ? "FBIS CBB Research" : "FBIS CBB",
      engine: research
        ? game.researchProjection?.modelId || "CBB-FBIS-PURE possessions×PPP"
        : "Production model pending validation",
      independent: Boolean(independentFbis),
      state: game.projectionState || game.projectionMaturity || null,
      maturity: research ? "RESEARCH" : "PENDING",
      canQualify: false,
    };
  }
  if (sport === "nfl") {
    return {
      name: research ? "FBIS NFL Research" : "FBIS NFL",
      engine: research
        ? game.researchProjection?.modelId || "NFL-FBIS-PURE research-v0-form"
        : "Independent production model pending validation",
      independent: Boolean(independentFbis),
      state: game.projectionState || game.projectionMaturity || null,
      maturity: research ? "RESEARCH" : "PENDING",
      canQualify: false,
    };
  }
  return { name: "FBIS", engine: null, independent: false, state: null };
}

function projection(game = {}) {
  const kind = game.model?.projectionKind || game.projectionKind || null;
  const home = finite(game.model?.projHome ?? game.projHome ?? game.projHomeScore);
  const away = finite(game.model?.projAway ?? game.projAway ?? game.projAwayScore);
  const margin = finite(game.model?.projMargin ?? (home != null && away != null ? home - away : null));
  const total = finite(game.model?.projTotal ?? (home != null && away != null ? home + away : null));
  const pHome = finite(game.model?.pHomeFinal);
  const independent = kind === "FBIS" && home != null && away != null;
  const research =
    String(game.projectionMaturity || game.model?.maturity || "").toUpperCase() === "RESEARCH" ||
    game.canQualify === false;
  return {
    kind,
    independent,
    maturity: research ? "RESEARCH" : kind === "FBIS" ? "PRODUCTION" : null,
    home: independent ? home : null,
    away: independent ? away : null,
    margin: independent ? margin : null,
    total: independent ? total : null,
    // Never expose calibrated EV / fair odds for uncalibrated research.
    pHome: independent && !research && pHome != null && pHome > 0 && pHome < 1 ? pHome : null,
    fairHomeMl: independent && !research ? americanFromProbability(pHome) : null,
    lifecycle: "PREGAME",
    liveReforecast: false,
    unavailableReason: independent ? null : "independent-production-projection-unavailable",
    canQualify: false,
    calibratedEvAvailable: false,
  };
}

function market(game = {}) {
  const pin = game.pin || pinMarkets(game);
  return {
    homeMl: finite(game.odds?.pinHomeMl ?? pin?.ml?.priceA),
    awayMl: finite(game.odds?.pinAwayMl ?? pin?.ml?.priceB),
    spread: finite(game.odds?.pinSpread ?? game.odds?.spread),
    total: finite(game.odds?.pinTotal ?? game.odds?.total),
    noVigHome: finite(pin?.ml?.noVigA),
    complete: Boolean(pin?.ml?.complete || pin?.spread?.complete || pin?.total?.complete),
    source: "Pinnacle",
  };
}

function ballparkPal(game = {}, proj = {}) {
  const home = finite(game.bpp?.homeRuns);
  const away = finite(game.bpp?.awayRuns);
  const available = home != null && away != null;
  if (!available) return { available: false, source: "Ballpark Pal" };
  const total = home + away;
  const margin = home - away;
  const totalDelta = proj.independent && proj.total != null ? proj.total - total : null;
  const marginDelta = proj.independent && proj.margin != null ? proj.margin - margin : null;
  const maxDelta = Math.max(Math.abs(totalDelta ?? 0), Math.abs(marginDelta ?? 0));
  const agreement = !proj.independent ? null : maxDelta <= 0.75 ? "AGREE" : maxDelta <= 1.5 ? "MIXED" : "DISAGREE";
  return {
    available: true,
    source: "Ballpark Pal",
    role: "INDEPENDENT_CROSS_CHECK",
    home,
    away,
    total: Math.round(total * 10) / 10,
    margin: Math.round(margin * 10) / 10,
    pHome: finite(game.bpp?.pHome),
    f5: game.bpp?.f5 ? {
      home: finite(game.bpp.f5.homeRuns),
      away: finite(game.bpp.f5.awayRuns),
      total: finite(game.bpp.f5.total),
    } : null,
    lineupsOfficial: game.bpp?.lineupsOfficial === true,
    comparison: {
      totalDelta: totalDelta == null ? null : Math.round(totalDelta * 10) / 10,
      marginDelta: marginDelta == null ? null : Math.round(marginDelta * 10) / 10,
      agreement,
    },
  };
}

function gameState(game = {}) {
  const status = game.status || {};
  const state = status.live ? "LIVE" : status.completed ? "FINAL" : "SCHEDULED";
  return {
    state,
    detail: status.detail || null,
    live: Boolean(status.live),
    completed: Boolean(status.completed),
    currentScore: {
      away: finite(game.away?.score),
      home: finite(game.home?.score),
    },
  };
}

function decision(game, sport) {
  const bundle = recommendBundle(sport, game, game.model, DEFAULT_WEIGHTS);
  const rec = bundle?.qualified || null;
  const lean = bundle?.lean || null;
  return {
    status: rec ? (String(rec.tag || "").toUpperCase() === "CONVICTION" ? "CONVICTION" : "QUALIFIED") : "PASS",
    market: rec?.market || null,
    pick: rec?.pick || null,
    modelProbability: finite(rec?.modelProbability),
    expectedRoi: finite(rec?.ev),
    lean: lean ? { market: lean.market || null, pick: lean.pick || null, reason: lean.reason || null } : null,
    blocked: Boolean(bundle?.blocked),
    blockReason: bundle?.blockReason || game.blockReason || null,
  };
}

function quality(game = {}) {
  const baseScore = finite(game.quality?.score ?? game.cfb?.dataQuality);
  const v2Completeness = finite(game.cfbFbisV2?.dataCompleteness);
  const v2Score = v2Completeness == null ? null : Math.round(v2Completeness * 100);
  const score = game.cfbFbisV2?.ok && v2Score != null
    ? Math.max(baseScore ?? 0, v2Score)
    : baseScore;
  return {
    score,
    state: game.cfbFbisV2?.ok
      ? (game.cfbFbisV2?.provisional ? "PROVISIONAL" : "COMPLETE")
      : game.cfb?.projectionState || game.projectionState || null,
    flags: Array.isArray(game.quality?.flags) ? game.quality.flags.slice(0, 12) : [],
    sigmaMargin: finite(game.cfbFbisV2?.sigmaMargin ?? game.cfb?.sigmaMargin ?? game.model?.sigmaMargin),
    sigmaTotal: finite(game.cfbFbisV2?.sigmaTotal ?? game.cfb?.sigmaTotal ?? game.model?.sigmaTotal),
  };
}

function llmFeatureDigest(game = {}, sport = "") {
  if (sport === "mlb") {
    const homeRpg = finite(game.savant?.homeRpg);
    const awayRpg = finite(game.savant?.awayRpg);
    const homeSpEra = finite(game.savant?.homeSpEra);
    const awaySpEra = finite(game.savant?.awaySpEra);
    const values = [homeRpg, awayRpg, homeSpEra, awaySpEra].filter((v) => v != null);
    return {
      version: "llm-features-v1",
      independentInputsOnly: true,
      featureCount: values.length,
      sources: ["MLB_STATS", "BASEBALL_SAVANT"],
      neutralSite: Boolean(game.neutralSite),
      home: {
        team: game.home?.fullName || game.home?.name || game.home?.abbr || null,
        runsPerGame: homeRpg,
        starter: game.homeSp?.name || null,
        starterEraEquivalent: homeSpEra,
      },
      away: {
        team: game.away?.fullName || game.away?.name || game.away?.abbr || null,
        runsPerGame: awayRpg,
        starter: game.awaySp?.name || null,
        starterEraEquivalent: awaySpEra,
      },
    };
  }
  if (sport === "cfb") {
    const h = game.cfb?.homeEst || {};
    const a = game.cfb?.awayEst || {};
    const hd = game.cfbDeepInput?.home || {};
    const ad = game.cfbDeepInput?.away || {};
    const side = (est, deep, tm) => {
      const raw = est.featureVector?.raw || {};
      const comp = est.featureVector?.components || {};
      return {
        team: tm?.school || tm?.fullName || tm?.name || tm?.abbr || null,
        rank: finite(est.rank),
        gamesPlayed: finite(deep.gamesPlayed ?? est.n),
        priorOffense: finite(est.priorOff),
        priorDefense: finite(est.priorDef),
        currentPointsForPerGame: finite(deep.currentPointsForPerGame ?? est.currentOff),
        currentPointsAgainstPerGame: finite(deep.currentPointsAgainstPerGame ?? est.currentDef),
        teamSpecificPrior: Boolean(est.teamSpecificPrior),
        currentSeasonFormSource: (deep.currentPointsForPerGame != null || est.currentOff != null)
          ? (deep.sourceForm || "CFBD_COMPLETED_GAMES_OR_HARVEST")
          : null,
        offensePpa: finite(deep.offensePpa),
        defensePpa: finite(deep.defensePpa),
        passEpa: finite(deep.passEpa),
        rushEpa: finite(deep.rushEpa),
        passEpaAllowed: finite(deep.passEpaAllowed),
        rushEpaAllowed: finite(deep.rushEpaAllowed),
        successRate: finite(deep.successRate),
        successRateAllowed: finite(deep.successRateAllowed),
        explosiveRate: finite(deep.explosiveRate),
        explosiveRateAllowed: finite(deep.explosiveRateAllowed),
        havocRate: finite(deep.havocRate),
        havocAllowed: finite(deep.havocAllowed),
        lineYards: finite(deep.lineYards),
        lineYardsAllowed: finite(deep.lineYardsAllowed),
        stuffRate: finite(deep.stuffRate),
        pointsPerOpportunity: finite(deep.pointsPerOpportunity),
        pointsPerOpportunityAllowed: finite(deep.pointsPerOpportunityAllowed),
        pacePlays: finite(deep.pacePlays),
        epaNet: finite(raw.epaNet),
        transferNet: finite(raw.transferNet),
        transferStarDelta: finite(raw.transferStarDelta),
        returningPct: finite(raw.returningPct),
        talent: finite(raw.talent),
        coachTenure: finite(raw.coachTenure),
        newCoach: Boolean(raw.newCoach),
        qbPriorPpa: finite(raw.qbPriorPpa),
        qbPriorSuccessRate: finite(raw.qbPriorSuccessRate),
        qbPriorYpa: finite(raw.qbPriorYpa),
        qbPriorGamesStarted: finite(raw.qbPriorGamesStarted),
        qbStarterKnown: Boolean(raw.qbStarterKnown),
        qbStarterClass: finite(raw.qbStarterClass),
        qbStarterTransfer: Boolean(raw.qbStarterTransfer),
        normalizedSignals: {
          epa: finite(comp.epa),
          transfer: finite(comp.transfer),
          qb: finite(comp.qb),
          coaching: finite(comp.coaching),
          returning: finite(comp.returning),
          talent: finite(comp.talent),
        },
        sourceMap: est.featureVector?.source || {},
        missing: Array.isArray(est.featureVector?.missing) ? est.featureVector.missing : [],
      };
    };
    const home = side(h, hd, game.home);
    const away = side(a, ad, game.away);
    const numeric = (obj) => [
      obj.gamesPlayed,obj.priorOffense,obj.priorDefense,obj.currentPointsForPerGame,obj.currentPointsAgainstPerGame,
      obj.offensePpa,obj.defensePpa,obj.passEpa,obj.rushEpa,obj.passEpaAllowed,obj.rushEpaAllowed,
      obj.successRate,obj.successRateAllowed,obj.explosiveRate,obj.explosiveRateAllowed,obj.havocRate,obj.havocAllowed,
      obj.lineYards,obj.lineYardsAllowed,obj.stuffRate,obj.pointsPerOpportunity,obj.pointsPerOpportunityAllowed,obj.pacePlays,
      obj.epaNet,obj.transferNet,obj.transferStarDelta,obj.returningPct,obj.talent,obj.coachTenure,
      obj.qbPriorPpa,obj.qbPriorSuccessRate,obj.qbPriorYpa,obj.qbPriorGamesStarted,obj.qbStarterClass,
      obj.normalizedSignals?.epa,obj.normalizedSignals?.transfer,obj.normalizedSignals?.qb,
      obj.normalizedSignals?.coaching,obj.normalizedSignals?.returning,obj.normalizedSignals?.talent
    ].filter((v)=>v!=null).length;
    return {
      version: "llm-features-v2-cfbd",
      independentInputsOnly: true,
      featureCount: numeric(home) + numeric(away),
      sources: ["CFBD", "ESPN"],
      neutralSite: Boolean(game.neutralSite),
      home,
      away,
      context: {
        weatherAdjusted: Boolean(game.cfb?.constants?.weatherTotalFactor && game.cfb.constants.weatherTotalFactor !== 1),
        dataQuality: finite(game.cfb?.dataQuality),
        state: game.cfb?.projectionState || null,
      },
    };
  }
  return {
    version: "llm-features-v1",
    independentInputsOnly: true,
    featureCount: 0,
    sources: [],
    unsupported: true,
  };
}

export function productProjectionCard(game, sport, { tier = "public" } = {}) {
  const proj = projection(game);
  const pin = market(game);
  const d = decision(game, sport);
  const card = {
    id: String(game.id),
    sport,
    start: game.start || null,
    away: team(game.away),
    home: team(game.home),
    neutral: Boolean(game.neutralSite),
    gameState: gameState(game),
    model: modelIdentity(sport, game),
    modelVersion: game.modelVersion || game.championModel || null,
    projection: proj,
    market: pin,
    externalModels: sport === "mlb" ? { ballparkPal: ballparkPal(game, proj) } : undefined,
    decision: {
      status: d.status,
      market: tier === "pro" ? d.market : null,
      pick: tier === "pro" ? d.pick : null,
      blocked: d.blocked,
      blockReason: d.blockReason,
    },
    quality: quality(game),
    llmFeatures: llmFeatureDigest(game, sport),
  };
  if (tier === "pro") {
    card.intelligence = {
      modelProbability: d.modelProbability,
      expectedRoi: d.expectedRoi,
      lean: d.lean,
      marketDelta: proj.independent && proj.pHome != null && pin.noVigHome != null ? proj.pHome - pin.noVigHome : null,
      provenance: game.researchProvenance || null,
    };
  }
  return card;
}

export function productProjectionBoard(slate = {}, { tier = "public" } = {}) {
  const sport = String(slate.sport || "").toLowerCase();
  return {
    ok: true,
    tier,
    sport,
    date: slate.date || null,
    generatedAt: slate.generatedAt || new Date().toISOString(),
    modelVersion: slate.modelVersion || null,
    games: (slate.games || []).map((game) => productProjectionCard(game, sport, { tier })),
    disclaimer: "FBIS is the proprietary projection. Ballpark Pal, when shown for MLB, is an independent cross-check and never replaces the FBIS projection. Pinnacle is the market benchmark. PASS means no qualifying FBIS wager at the frozen/current market state.",
  };
}

export const FORBIDDEN_PRODUCT_KEYS = [
  "executedBets", "strategyTickets", "harvestSecret", "strategySecret", "raw", "sys", "sourceObservations", "playerProps", "palProps"
];
