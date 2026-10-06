/** Subscriber/public projection contract. Never returns raw SYS, executed-bet or source payloads. */
import { recommendBundle, pinMarkets } from "./slateEngine.js";
import { DEFAULT_WEIGHTS } from "./weights.js";
import { buildSportAvailabilityPreflight } from "./availability.js";
import { canonicalConfidenceStars } from "./projectionConfidence.js";

function finite(v) {
  if (v == null || v === "") return null;
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

  if (sport === "kbo") {
    return {
      name: "FBIS KBO Research",
      engine: game.kboV1?.modelId || "KBO-FBIS-v1",
      independent: Boolean(independentFbis),
      state: game.quality?.state || game.projectionState || null,
      maturity: "RESEARCH",
      canQualify: false,
    };
  }
  if (sport === "npb") {
    return {
      name: "FBIS NPB Research",
      engine: game.npbV1?.modelId || "NPB-FBIS-v1",
      independent: Boolean(independentFbis),
      state: game.quality?.state || game.projectionState || null,
      maturity: "RESEARCH",
      canQualify: false,
    };
  }
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
  if (sport === "nhl") {
    return {
      name: research ? "FBIS NHL Research" : "FBIS NHL",
      engine: research
        ? game.researchProjection?.modelId || game.nhlV1?.modelId || "NHL-FBIS-v1"
        : "Independent production model pending validation",
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
  if (sport === "soccer") {
    return {
      name: "FBIS Soccer Research",
      engine: game.researchProjection?.modelId || game.soccerFbisV2?.modelId || game.soccerFbis?.modelId || "SOCCER-FBIS-v2",
      independent: Boolean(independentFbis),
      state: game.projectionState || game.projectionMaturity || null,
      maturity: "RESEARCH",
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

function mlbSubprojections(game = {}) {
  const deep = game.mlbDeepShadow || game.challengers?.["MLB-FBIS-v2"] || null;
  if (!deep?.ok) return { available: false, source: "MLB-FBIS-v2.1" };
  const f5 = deep.f5 || null;
  const homeK = deep.pitcherKs?.home || null;
  const awayK = deep.pitcherKs?.away || null;
  const palF5 = game.bpp?.f5 || null;
  const palHomeK = finite(game.bpp?.homeSp?.k);
  const palAwayK = finite(game.bpp?.awaySp?.k);
  const delta = (a,b) => a == null || b == null ? null : Math.round((a-b)*10)/10;
  return {
    available: Boolean(f5 || homeK || awayK),
    source: "MLB-FBIS-v2.1",
    maturity: "RESEARCH",
    canQualify: false,
    f5: f5 ? {
      fbis: {
        home: finite(f5.home),
        away: finite(f5.away),
        total: finite(f5.total),
        margin: finite(f5.margin),
        probabilities: f5.probabilities ? {
          homeWin: finite(f5.probabilities.homeWin),
          awayWin: finite(f5.probabilities.awayWin),
          tie: finite(f5.probabilities.tie),
          homeConditional: finite(f5.probabilities.homeConditional),
          awayConditional: finite(f5.probabilities.awayConditional),
        } : null,
      },
      sportsbook: game.odds?.f5 ? {
        homeMl: finite(game.odds.f5.homeMl),
        awayMl: finite(game.odds.f5.awayMl),
        spread: finite(game.odds.f5.spread),
        spreadHomePrice: finite(game.odds.f5.spreadHomePrice),
        spreadAwayPrice: finite(game.odds.f5.spreadAwayPrice),
        total: finite(game.odds.f5.total),
        overPrice: finite(game.odds.f5.overPrice),
        underPrice: finite(game.odds.f5.underPrice),
        book: game.odds.f5.book || null,
      } : null,
      marketEvaluation: f5.market ? {
        available: Boolean(f5.market.available),
        qualificationState: f5.market.qualificationState || "RESEARCH_ONLY",
        canQualify: false,
        lineupsOfficial: f5.market.lineupsOfficial ?? null,
        riskFlags: f5.market.riskFlags || [],
        markets: f5.market.markets || [],
        bestResearchSignal: f5.market.bestResearchSignal || null,
        reason: f5.market.reason || null,
      } : null,
      ballparkPal: palF5 ? {
        home: finite(palF5.homeRuns),
        away: finite(palF5.awayRuns),
        total: finite(palF5.total),
        homeWin: finite(palF5.homeWin),
        awayWin: finite(palF5.awayWin),
      } : null,
      comparison: palF5 ? {
        homeDelta: delta(f5.home, palF5.homeRuns),
        awayDelta: delta(f5.away, palF5.awayRuns),
        totalDelta: delta(f5.total, palF5.total),
      } : null,
    } : null,
    pitcherKs: {
      home: homeK ? {
        playerId: homeK.playerId ?? null,
        playerName: homeK.playerName ?? null,
        team: homeK.team ?? null,
        fbis: finite(homeK.projection),
        ballparkPal: palHomeK,
        delta: delta(homeK.projection, palHomeK),
        expectedInnings: finite(homeK.expectedInnings),
        kPer9: finite(homeK.kPer9),
        opponentKRate: finite(homeK.opponentKRate),
      } : null,
      away: awayK ? {
        playerId: awayK.playerId ?? null,
        playerName: awayK.playerName ?? null,
        team: awayK.team ?? null,
        fbis: finite(awayK.projection),
        ballparkPal: palAwayK,
        delta: delta(awayK.projection, palAwayK),
        expectedInnings: finite(awayK.expectedInnings),
        kPer9: finite(awayK.kPer9),
        opponentKRate: finite(awayK.opponentKRate),
      } : null,
    },
    policy: "Ballpark Pal values are external comparisons; FBIS F5/K projections are generated separately.",
  };
}

function soccerSubprojections(game = {}) {
  const p = game.soccerFbisV2 || game.soccerFbis || game.challengers?.["SOCCER-FBIS-v2"] || game.challengers?.["SOCCER-FBIS-v1"] || null;
  if (!p?.ok) return { available: false, source: "SOCCER-FBIS-v2", maturity: "RESEARCH", canQualify: false };
  return {
    available: true,
    source: p.modelId || "SOCCER-FBIS-v2",
    modelVersion: p.modelVersion || game.modelVersion || null,
    maturity: "RESEARCH",
    canQualify: false,
    canAuthorize: false,
    expectedGoals: { home: finite(p.home), away: finite(p.away), total: finite(p.total) },
    oneXTwo: { home: finite(p.pHomeWin), draw: finite(p.pDraw), away: finite(p.pAwayWin) },
    btts: { yes: finite(p.pBttsYes), no: finite(p.pBttsNo) },
    totals: p.totals || null,
    homeAsian: p.homeAsian || null,
    uncertainty: p.uncertainty || null,
    diagnostics: p.diagnostics || null,
    ensemble: p.ensemble || null,
    challenger: p.challenger || null,
    v1: p.v1 || null,
    confidencePick: game.soccerConfidence || game.confidencePick || p.confidencePick || null,
    policy: "Independent soccer research probabilities. Stars measure model confidence; they do not grant wager authority.",
  };
}

function kboSubprojections(game = {}) {
  const p = game.kboV1;
  if (!p?.ok) return { available:false, source:"KBO-FBIS-v1" };
  return {
    available:true,
    source:"KBO-FBIS-v1",
    maturity:"RESEARCH",
    canQualify:false,
    f5:p.f5 ? {home:finite(p.f5.home),away:finite(p.f5.away),total:finite(p.f5.total),margin:finite(p.f5.margin)} : null,
    pitcherKs:{
      home:p.pitcherKs?.home ? {
        playerId:p.starters?.home?.playerId || null,playerName:p.starters?.home?.name || null,team:game?.home?.abbr || null,
        fbis:finite(p.pitcherKs.home.projection),expectedInnings:finite(p.pitcherKs.home.expectedInnings),
        kPer9:finite(p.pitcherKs.home.kPer9),opponentKRate:finite(p.pitcherKs.home.opponentKRate)
      } : null,
      away:p.pitcherKs?.away ? {
        playerId:p.starters?.away?.playerId || null,playerName:p.starters?.away?.name || null,team:game?.away?.abbr || null,
        fbis:finite(p.pitcherKs.away.projection),expectedInnings:finite(p.pitcherKs.away.expectedInnings),
        kPer9:finite(p.pitcherKs.away.kPer9),opponentKRate:finite(p.pitcherKs.away.opponentKRate)
      } : null
    },
    starterState:p.starterState || "PROVISIONAL_OFFICIAL_STARTER_UNRESOLVED",
    advanced:p.advanced || null,
    policy:"Independent KBO official-data advanced research projection. Starter K projections activate only when official KBO starter identity resolves."
  };
}

function npbSubprojections(game = {}) {
  const p = game.npbV1;
  if (!p?.ok) return { available:false, source:"NPB-FBIS-v1" };
  const packK = (side) => {
    const k=p.pitcherKs?.[side], st=p.starters?.[side];
    return k ? {
      playerId:st?.playerId || null, playerName:st?.name || null,
      team:game?.[side]?.abbr || null, fbis:finite(k.projection),
      expectedInnings:finite(k.expectedInnings), kPer9:finite(k.kPer9),
      opponentKRate:finite(k.opponentKRate)
    } : null;
  };
  return {
    available:true,source:"NPB-FBIS-v1",maturity:"RESEARCH",canQualify:false,
    f5:p.f5 ? {home:finite(p.f5.home),away:finite(p.f5.away),total:finite(p.f5.total),margin:finite(p.f5.margin)} : null,
    pitcherKs:{home:packK("home"),away:packK("away")},
    policy:"Independent NPB official-data research projection; no sportsbook inputs."
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

function proPlayerProjections(game = {}, sport = "") {
  const supported = new Set(["mlb","npb","kbo","cfb","cbb","nfl","nba","nhl"]);
  if (!supported.has(sport)) return undefined;
  const status = game.playerProjectionStatus || {
    sport,
    state: sport === "kbo" ? "PROBABLE_STARTER_UNRESOLVED" : "NOT_ATTACHED",
    model: null,
    independent: false,
    marketInformed: false,
    canQualify: false,
  };
  const rows = (game.playerProjectionRows || []).map((row) => {
    const clean = {
      playerId: row.playerId ?? null,
      playerName: row.playerName ?? null,
      team: row.team ?? null,
      position: row.position ?? null,
      market: row.market ?? null,
      fbisProjection: finite(row.fbisProjection),
      fbisSigma: finite(row.fbisSigma),
      source: row.source || null,
      modelSource: row.source || null,
      modelVersion: row.modelVersion || (sport === "mlb" ? (status.propModel || status.version || null) : (status.version || null)),
      sourceObservedAt: row.sourceObservedAt || row.stateAsOf || (sport === "mlb" ? game?.mlbPersistentState?.asOf || null : null),
      stateAsOf: row.stateAsOf || (sport === "mlb" ? game?.mlbPersistentState?.asOf || null : null),
      eventId: String(game?.id || ""),
      opponent: row.team && String(row.team).toUpperCase() === String(game?.home?.abbr || "").toUpperCase()
        ? (game?.away?.abbr || game?.away?.name || null)
        : (game?.home?.abbr || game?.home?.name || null),
      eventStartAt: game?.start || null,
      projectionSnapshotAt: new Date().toISOString(),
      maturity: row.maturity || "RESEARCH",
      independent: row.independent !== false,
      marketInformed: Boolean(row.marketInformed),
      canQualify: false,
      canAuthorizeWager: false,
    };
    if (sport === "mlb" && clean.market === "strikeouts") {
      const homeId = String(game.bpp?.homeSp?.id ?? "");
      const awayId = String(game.bpp?.awaySp?.id ?? "");
      const pid = String(clean.playerId ?? "");
      const pal = pid && pid === homeId
        ? finite(game.bpp?.homeSp?.k)
        : pid && pid === awayId
          ? finite(game.bpp?.awaySp?.k)
          : null;
      clean.externalComparison = pal == null ? null : {
        source: "Ballpark Pal",
        projection: pal,
        deltaFbisMinusExternal: Math.round((Number(clean.fbisProjection) - pal) * 10) / 10,
      };
    }
    return clean;
  });
  return {
    status,
    rows,
    count: rows.length,
    policy: "FBIS player projections are independent research outputs. Sportsbook lines and external projections may be compared after projection but never substituted as the FBIS projection.",
  };
}

function projectionSnapshotStage(game = {}) {
  const startMs = Date.parse(game?.start || "");
  const nowMs = Date.now();
  if (!Number.isFinite(startMs)) return { stage:"CURRENT", hoursToStart:null };
  const hoursToStart = (startMs - nowMs) / 3600000;
  let stage = "MORNING";
  if (hoursToStart <= 0) stage = "LIVE_OR_FINAL";
  else if (hoursToStart <= 1.5) stage = "CLOSE";
  else if (hoursToStart <= 4) stage = "PREGAME";
  else if (hoursToStart <= 10) stage = "MIDDAY";
  return {
    stage,
    hoursToStart: Math.round(hoursToStart * 10) / 10,
    capturedAt: new Date(nowMs).toISOString(),
    immutableBaselineRequired: true,
  };
}

function leagueTiming(game = {}, sport = "") {
  const start = game?.start || null;
  if (!start) return undefined;
  const zone = sport === "npb" ? "Asia/Tokyo" : sport === "kbo" ? "Asia/Seoul" : null;
  if (!zone) return undefined;
  const fmt = (timeZone) => {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone, year:"numeric", month:"2-digit", day:"2-digit",
        hour:"2-digit", minute:"2-digit", hour12:false
      }).format(new Date(start));
    } catch { return null; }
  };
  return {
    kickoffUtc:start,
    userTimeZone:"America/Chicago",
    kickoffUserLocal:fmt("America/Chicago"),
    leagueTimeZone:zone,
    kickoffLeagueLocal:fmt(zone),
    selectionRule:"NEXT_UP_BY_ABSOLUTE_KICKOFF",
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
  const deepHome = game.cfbDeepInput?.home || {};
  const deepAway = game.cfbDeepInput?.away || {};
  const hasCurrentForm = (row) =>
    finite(row.gamesPlayed) != null &&
    finite(row.gamesPlayed) >= 1 &&
    finite(row.currentPointsForPerGame) != null &&
    finite(row.currentPointsAgainstPerGame) != null;
  const formSides = Number(hasCurrentForm(deepHome)) + Number(hasCurrentForm(deepAway));
  // A game with valid completed-game form on both sides is not "Q0" simply
  // because an FCS opponent lacks CFBD's FBS-only advanced table.
  const currentFormFloor = formSides === 2 ? 40 : formSides === 1 ? 20 : 0;
  const score = game.cfbFbisV2?.ok
    ? Math.max(baseScore ?? 0, v2Score ?? 0, currentFormFloor)
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

function gameConditions(game = {}, sport = "") {
  const availability = game.availabilityImpact || null;
  const availabilityPreflight = buildSportAvailabilityPreflight(game, sport || game?.sport || game?.league || "");
  const weather = game.weather || null;
  const weatherImpact = game.weatherImpact || null;
  const slimPlayers = (side) => (availability?.[side]?.players || [])
    .filter((p) => Number(p?.impactPoints || 0) > 0 || ["OUT","IR","DOUBTFUL","QUESTIONABLE","SUSPENDED"].includes(String(p?.status || "").toUpperCase()))
    .slice(0, 12)
    .map((p) => ({
      name: p.name || null,
      position: p.position || null,
      depthRank: p.depthRank ?? null,
      status: p.status || null,
      practiceStatus: p.practiceStatus || null,
      injury: p.injury || null,
      impactPoints: finite(p.impactPoints),
      source: p.source || null,
      observedAt: p.observedAt || null,
      stale: Boolean(p.stale),
    }));
  return {
    weather: weather ? {
      source: weather.source || "open-meteo",
      indoor: Boolean(weather.indoor),
      summary: weather.summary || weather.condition || weather.description || null,
      temperature: finite(weather.temperature),
      windSpeed: finite(weather.windSpeed),
      precipProbability: finite(weather.precipProbability),
      totalFactor: finite(weatherImpact?.footballTotalFactor ?? weatherImpact?.runFactor),
    } : null,
    availabilityPreflight,
    availability: availability ? {
      source: availability.source || null,
      configured: Boolean(availability.configured),
      stale: Boolean(availability.stale),
      criticalUnresolved: Boolean(availability.criticalUnresolved),
      homeScoreAdjustment: finite(availability.homeScoreAdjustment),
      awayScoreAdjustment: finite(availability.awayScoreAdjustment),
      marginAdjustment: finite(availability.marginAdjustment),
      totalAdjustment: finite(availability.totalAdjustment),
      home: {
        impactedCount: availability.home?.impactedCount || 0,
        players: slimPlayers("home"),
      },
      away: {
        impactedCount: availability.away?.impactedCount || 0,
        players: slimPlayers("away"),
      },
      methodology: availability.methodology || null,
    } : null,
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
        availabilityAdjusted: Boolean(game.availabilityAdjustmentApplied),
        availability: gameConditions(game).availability,
        weather: gameConditions(game).weather,
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
    confidenceStars: canonicalConfidenceStars({ ...game, sport }),
    start: game.start || null,
    away: team(game.away),
    home: team(game.home),
    neutral: Boolean(game.neutralSite),
    gameState: gameState(game),
    leagueTiming: leagueTiming(game, sport),
    snapshot: projectionSnapshotStage(game),
    model: modelIdentity(sport, game),
    modelVersion: game.modelVersion || game.championModel || null,
    projection: proj,
    market: pin,
    externalModels: sport === "mlb" ? { ballparkPal: ballparkPal(game, proj) } : undefined,
    subprojections: sport === "mlb" ? mlbSubprojections(game) : sport === "npb" ? npbSubprojections(game) : sport === "kbo" ? kboSubprojections(game) : sport === "soccer" ? soccerSubprojections(game) : undefined,
    playerProjections: proPlayerProjections(game, sport),
    decision: {
      status: d.status,
      market: tier === "pro" ? d.market : null,
      pick: tier === "pro" ? d.pick : null,
      blocked: d.blocked,
      blockReason: d.blockReason,
    },
    quality: quality(game),
    conditions: gameConditions(game, sport),
    llmFeatures: llmFeatureDigest(game, sport),
    confidence: sport === "soccer"
      ? (game.soccerConfidence || game.confidencePick || game.soccerFbis?.confidencePick || null)
      : undefined,
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

function productBoardGames(games = [], sport = "") {
  if (sport !== "mlb") return games;
  const groups = new Map();
  for (const game of games) {
    const away = String(game?.away?.abbr || game?.away?.name || "").trim().toUpperCase();
    const home = String(game?.home?.abbr || game?.home?.name || "").trim().toUpperCase();
    const start = String(game?.start || "");
    const date = start ? start.slice(0, 10) : "";
    const key = away && home ? [date, away, home].join("|") : `__raw:${String(game?.id || start || groups.size)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }
  const kept = [];
  for (const group of groups.values()) {
    const official = group.filter((g) => /^\d+$/.test(String(g?.id || "")));
    if (!official.length) {
      kept.push(...group);
      continue;
    }
    kept.push(...official);
    for (const game of group) {
      if (/^\d+$/.test(String(game?.id || ""))) continue;
      const ms = Date.parse(game?.start || "");
      const nearOfficial = official.some((g) => {
        const oms = Date.parse(g?.start || "");
        return Number.isFinite(ms) && Number.isFinite(oms) && Math.abs(ms - oms) <= 90 * 60 * 1000;
      });
      if (!nearOfficial) kept.push(game);
    }
  }
  return kept;
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
    games: productBoardGames(slate.games || [], sport).map((game) => productProjectionCard(game, sport, { tier })),
    disclaimer: "FBIS is the proprietary projection. Ballpark Pal, when shown for MLB, is an independent cross-check and never replaces the FBIS projection. Pinnacle is the market benchmark. PASS means no qualifying FBIS wager at the frozen/current market state.",
  };
}

export const FORBIDDEN_PRODUCT_KEYS = [
  "executedBets", "strategyTickets", "harvestSecret", "strategySecret", "raw", "sys", "sourceObservations", "playerProps", "palProps"
];
