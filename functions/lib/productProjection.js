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
    const h = game.cfb?.homeEst || {};
    const a = game.cfb?.awayEst || {};
    const side = (est, tm) => {
      const raw = est.featureVector?.raw || {};
      const comp = est.featureVector?.components || {};
      return {
        team: tm?.school || tm?.fullName || tm?.name || tm?.abbr || null,
        rank: finite(est.rank),
        gamesPlayed: finite(est.n),
        priorOffense: finite(est.priorOff),
        priorDefense: finite(est.priorDef),
        currentPointsForPerGame: finite(est.currentOff),
        currentPointsAgainstPerGame: finite(est.currentDef),
        teamSpecificPrior: Boolean(est.teamSpecificPrior),
        currentSeasonFormSource: est.currentOff != null ? "CFBD_COMPLETED_GAMES_OR_HARVEST" : null,
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
    const home = side(h, game.home);
    const away = side(a, game.away);
    const numeric = (obj) => [
      obj.gamesPlayed,obj.priorOffense,obj.priorDefense,obj.currentPointsForPerGame,obj.currentPointsAgainstPerGame,
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
