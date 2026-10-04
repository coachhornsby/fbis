/**
 * Public slate-engine facade.
 *
 * The original implementation lives in slateEngineCore.js. This facade keeps
 * every existing export intact while enforcing qualification-integrity rules
 * at the recommendation boundary and attaching research-only sport shadows.
 */

import * as core from "./slateEngineCore.js";
import { attachNflShadow } from "./nflModel.js";
import { attachNflProShadow } from "./nflProModel.js";
import { attachNflWagerDecisions } from "./nflWagerDecision.js";
import { NFL_WAGER_CONFIDENCE_V1 } from "../../data/models/nfl-wager-confidence-v1.js";
import { attachNflVerseFeatures, loadNflVerseFeatures } from "./nflVerseFeed.js";
import { attachMlbDeepShadow } from "./mlbDeepModel.js";
import { attachBasketballFormResearch } from "./basketballFormModel.js";
import { attachSoccerResearch } from "./soccerFbisV1.js";
import { attachMlbBullpenContext, loadMlbBullpenContext } from "./mlbBullpenFeed.js";
import { attachCfbMatchupV2 } from "./cfbMatchupV2.js";
import { attachCfbFbisV2, promoteCfbFbisV2ToBoard } from "./cfbFbisV2.js";
import { attachCfbPlayerV1 } from "./cfbPlayerModel.js";
import { attachCfbDeepFeatures, loadCfbDeepFeatures } from "./cfbDeepFeed.js";
import { promoteMlbResearchToBoard, promoteNflResearchToBoard, promoteCbbResearchToBoard, promoteNhlResearchToBoard } from "./researchBoardPromote.js";
import { loadNhlResearchPrior, attachNhlResearch } from "./nhlResearchModel.js";
import { attachNhlV1, NHL_FBIS_V1_ID, NHL_FBIS_V1_VERSION } from "./nhlFbisV1.js";
import { loadNhlProV2Context, attachNhlProV2, NHL_PRO_V2_ID, NHL_PRO_V2_VERSION } from "./nhlProV2.js";
import { loadCbbdCatalog } from "./collegeApply.js";
import { attachCbbPro } from "./cbbProModel.js";
import { loadCbbPlayerContext } from "./cbbPlayerFeed.js";
import { attachCbbPlayerGameResearch } from "./cbbPlayerGameModel.js";
import { applyCbbPlayerMarginV1 } from "./cbbPlayerValidated.js";
import { attachCbbPlayerProps } from "./cbbPlayerPropModel.js";
import { pinMarkets } from "./pricing.js";
import { applyAvailabilityAdjustment } from "./availability.js";
import { attachMatchupFactors } from "./matchupFactors.js";
import { attachMlbPlayerProjectionResearch, attachNpbPlayerProjectionResearch, attachKboPlayerProjectionResearch, attachNflPlayerProjectionResearch, attachNhlPlayerProjectionResearch, attachNbaPlayerProjectionBlocked } from "./proPlayerProjectionLayer.js";
import { loadWnbaPlayerContext, attachWnbaPlayerProjectionResearch } from "./wnbaPlayerProjection.js";
import { attachWnbaV2Research } from "./wnbaFbisV2.js";
import {
  marketImpliedAuthority,
  deriveBoardDecision,
  qualificationBlockersFromGame,
  evaluateDqGate,
  REASON_CODE,
} from "./canonical/index.js";

export * from "./slateEngineCore.js";
export { pinMarkets } from "./pricing.js";

const INDEPENDENT_SCORE_REQUIRED = new Set(["cbb", "nba", "wnba", "nhl", "nfl", "soccer"]);
const CRITICAL_QUALITY_FLAGS = new Set(["pinnacle_implied_score", "market_unresolved"]);
const MLB_STARTER_FLAGS = new Set(["missing_home_sp", "missing_away_sp"]);

/**
 * Research shadows attach under challengers. CFB-FBIS-v2 fitted A/A is the
 * production projection engine after cutover; qualification stays disabled.
 */
export async function buildSlate(sport, date, env = {}) {
  const slate = await core.buildSlate(sport, date, env);
  const id = String(slate?.sport || sport).toLowerCase();

  let next = slate;

  if (id === "mlb") {
    const bullpen = await loadMlbBullpenContext(slate.games || [], env).catch((err) => ({
      byTeamId: {}, meta: { source: "MLB Stats relief split", teams: 0, available: 0, error: String(err?.message || err), marketInformed: false },
    }));
    const enriched = attachMlbBullpenContext(slate.games || [], bullpen).map((game) => {
      const pal = game.bpp || {};
      const parkRunsPct = Number(pal.park?.runsPct);
      const parkHrPct = Number(pal.park?.hrPct);
      // Pal matchup is expressed from the offense perspective vs the opposing starter.
      const homeVsAwaySp = pal.matchup?.vsAwaySp || null;
      const awayVsHomeSp = pal.matchup?.vsHomeSp || null;
      return {
        ...game,
        mlbContext: {
          ...(game.mlbContext || {}),
          palParkRunFactor: Number.isFinite(parkRunsPct) ? 1 + parkRunsPct / 100 : null,
          palParkHrFactor: Number.isFinite(parkHrPct) ? 1 + parkHrPct / 100 : null,
          palLineupsOfficial: pal.lineupsOfficial === true,
          homePalRcVsTypical: homeVsAwaySp?.rcVs ?? null,
          homePalHrVsTypical: homeVsAwaySp?.hrVs ?? null,
          homePalKVsTypical: homeVsAwaySp?.kVs ?? null,
          homePalMatchupN: homeVsAwaySp?.n ?? null,
          awayPalRcVsTypical: awayVsHomeSp?.rcVs ?? null,
          awayPalHrVsTypical: awayVsHomeSp?.hrVs ?? null,
          awayPalKVsTypical: awayVsHomeSp?.kVs ?? null,
          awayPalMatchupN: awayVsHomeSp?.n ?? null,
          homePalStarterExpectedInnings: pal.homeSp?.innings ?? null,
          awayPalStarterExpectedInnings: pal.awaySp?.innings ?? null,
          homePalStarterProjectedKs: pal.homeSp?.k ?? null,
          awayPalStarterProjectedKs: pal.awaySp?.k ?? null,
          // Keep Pal's finished game/F5 predictions available for auditing and
          // external comparison, but MLB-FBIS-v2 never consumes them as score inputs.
          palProjectedHomeRuns: pal.homeRuns ?? null,
          palProjectedAwayRuns: pal.awayRuns ?? null,
          palHomeWinProbability: pal.pHome ?? null,
          palAwayWinProbability: pal.pAway ?? null,
          palF5HomeRuns: pal.f5?.homeRuns ?? null,
          palF5AwayRuns: pal.f5?.awayRuns ?? null,
          palF5Total: pal.f5?.total ?? null,
          palTeamTotalCount: Array.isArray(pal.teamTotals) ? pal.teamTotals.length : 0,
          palPropCount: Array.isArray(pal.props) ? pal.props.length : 0,
          palAsOf: pal.asOf || null,
          palRequestId: pal.requestId || null,
        },
      };
    });
    const deep = attachMlbDeepShadow(enriched);
    const research = promoteMlbResearchToBoard(deep.games);
    const playerResearch = attachMlbPlayerProjectionResearch(research.games);
    next = {
      ...slate,
      games: playerResearch,
      research: {
        ...(slate.research || {}),
        mlbBullpen: bullpen.meta,
        mlbDeep: deep.meta,
        mlbResearchBoard: research.meta,
      },
    };
  } else if (id === "cfb") {
    const feed = await loadCfbDeepFeatures(env).catch((err) => ({
      byEspnId: {}, bySchool: {}, meta: { configured: false, records: 0, error: String(err?.message || err) },
    }));
    const enriched = attachCfbDeepFeatures(slate.games || [], feed);
    const deep = attachCfbMatchupV2(enriched);
    const v2 = attachCfbFbisV2(deep.games);
    const promoted = promoteCfbFbisV2ToBoard(v2.games);
    // Player model consumes game environment only — no CFBD fanout on customer refresh
    const players = attachCfbPlayerV1(promoted.games);
    next = {
      ...slate,
      games: players.games,
      modelVersion: "CFB-FBIS-v2",
      research: {
        ...(slate.research || {}),
        cfbDeepFeed: feed.meta,
        cfbMatchupV2: deep.meta,
        cfbFbisV2: v2.meta,
        cfbFbisV2Board: promoted.meta,
        cfbPlayerV1: players.meta,
      },
    };
  } else if (id === "nfl") {
    const baseline = await attachNflShadow(slate.games || [], env);
    const verse = await loadNflVerseFeatures(env).catch((err) => ({
      byTeam: {}, playersByTeam: {}, meta: { source: "nflverse", teams: 0, error: String(err?.message || err), marketInformed: false },
    }));
    const enriched = attachNflVerseFeatures(baseline.games, verse);
    const pro = attachNflProShadow(enriched);
    // Research board: independent form/pure scores are displayable + freezable,
    // but never qualify or authorize.
    const research = promoteNflResearchToBoard(pro.games);
    const playerResearch = attachNflPlayerProjectionResearch(research.games, { byTeam: verse.playersByTeam || {} });
    next = {
      ...slate,
      games: playerResearch,
      nfl: baseline.meta,
      research: {
        ...(slate.research || {}),
        nflBaseline: baseline.meta,
        nflVerse: verse.meta,
        nflPro: pro.meta,
        nflResearchBoard: research.meta,
      },
    };
  } else if (id === "nhl") {
    const [prior, proContext] = await Promise.all([
      loadNhlResearchPrior(slate.date || date).catch((err) => ({
        ok: false,
        source: "NHL_STATS_TEAM_SUMMARY",
        error: String(err?.message || err),
        byAbbr: {},
        canQualify: false,
        canAuthorize: false,
      })),
      loadNhlProV2Context(slate.date || date, slate.games || []).catch((err) => ({
        ok: false,
        error: String(err?.message || err),
        base: {
          ok: false,
          teams: {},
          priorGoalies: [],
          currentGoalies: [],
          schedule: [],
          artifact: null,
          canQualify: false,
          canAuthorize: false,
        },
        edge: {},
        artifact: null,
        canQualify: false,
        canAuthorize: false,
      })),
    ]);
    const v1Context = proContext.base || {};
    const baseline = attachNhlResearch(slate.games || [], prior);
    const fiveLayer = attachNhlV1(baseline.games, v1Context);
    const proV2 = attachNhlProV2(fiveLayer.games, proContext);
    const research = promoteNhlResearchToBoard(proV2.games);
    const playerResearch = attachNhlPlayerProjectionResearch(research.games, {...v1Context, playerEdge:proContext.playerEdge||null});
    const v2Promoted = Boolean(proV2.meta.historicalPromotionEligible && proV2.meta.projected > 0);
    next = {
      ...slate,
      games: playerResearch,
      modelVersion: v2Promoted
        ? `${NHL_PRO_V2_ID}@${NHL_PRO_V2_VERSION}`
        : fiveLayer.meta.projected > 0
          ? `${NHL_FBIS_V1_ID}@${NHL_FBIS_V1_VERSION}`
          : "NHL-FBIS-PURE@research-v0-team-prior",
      research: {
        ...(slate.research || {}),
        nhlPrior: {
          ok: Boolean(prior.ok),
          source: prior.source || "NHL_STATS_TEAM_SUMMARY",
          seasonId: prior.seasonId || null,
          teams: prior.teams || 0,
          marketInformed: false,
          canQualify: false,
          canAuthorize: false,
          error: prior.error || null,
        },
        nhlResearch: baseline.meta,
        nhlFiveLayer: {
          ...fiveLayer.meta,
          contextOk: Boolean(v1Context.ok),
          contextError: v1Context.error || null,
        },
        nhlProV2: {
          ...proV2.meta,
          contextOk: Boolean(proContext.ok),
          contextError: proContext.error || null,
          edgeTeams: Object.values(proContext.edge || {}).filter((x) => x?.available).length,
          playerEdgeRequested: Number(proContext.playerEdge?.requested||0),
          playerEdgeAvailable: Number(proContext.playerEdge?.available||0),
          playerEdgeCoverage: Number(proContext.playerEdge?.coverage||0),
          playerEdgeStatus: proContext.playerEdge?.__timeout ? "TIMEOUT_ADVISORY_ONLY" : proContext.playerEdge?.__error ? "DEGRADED_ADVISORY_ONLY" : "ACTIVE_ADVISORY_ONLY",
        },
        nhlResearchBoard: research.meta,
      },
    };
  } else if (id === "cbb") {
    const pro = attachCbbPro(slate.games || []);
    const playerContext = await loadCbbPlayerContext(env, slate.date || date).catch((err) => ({
      ok: false,
      byTeam: {},
      meta: {
        source: "CBBD /stats/player/season + /games/players",
        marketInformed: false,
        error: String(err?.message || err),
      },
    }));
    const playerGame = attachCbbPlayerGameResearch(pro.games, playerContext);
    const withPlayerMargin = playerGame.games.map(game=>({
      ...game,
      cbbPlayerAdjustedMargin: applyCbbPlayerMarginV1(game),
    }));
    const players = attachCbbPlayerProps(withPlayerMargin, playerContext);
    next = {
      ...slate,
      games: players.games,
      modelVersion: pro.meta.version,
      research: {
        ...(slate.research || {}),
        cbbPro: pro.meta,
        cbbPlayerGame: playerGame.meta,
        cbbPlayerProps: players.meta,
      },
    };
  }

  if (id === "kbo" && Array.isArray(next.games)) {
    next = {
      ...next,
      games: attachKboPlayerProjectionResearch(next.games),
      research: {
        ...(next.research || {}),
        kboFbisV1: next.kbo || { modelId:"KBO-FBIS-v1", maturity:"RESEARCH", canQualify:false, canAuthorize:false },
      },
    };
  }

  if (id === "npb" && Array.isArray(next.games)) {
    next = {
      ...next,
      games: attachNpbPlayerProjectionResearch(next.games),
      research: {
        ...(next.research || {}),
        npbFbisV1: next.npb || { modelId:"NPB-FBIS-v1", maturity:"RESEARCH", canQualify:false, canAuthorize:false },
      },
    };
  }

  if (id === "soccer" && Array.isArray(next.games)) {
    const soccer = await attachSoccerResearch(next.games, env);
    next = {
      ...next,
      games: soccer.games,
      modelVersion: soccer.meta?.version || next.modelVersion,
      research: { ...(next.research || {}), soccerFbisV1: soccer.meta },
    };
  }

  if (["nba","wnba"].includes(id) && Array.isArray(next.games)) {
    const basketball = await attachBasketballFormResearch(next.games, env, id);
    next = {
      ...next,
      games: basketball.games,
      modelVersion: basketball.meta?.version || next.modelVersion,
      research: {
        ...(next.research || {}),
        basketballForm: basketball.meta,
      },
    };
  }

  if (id === "wnba" && Array.isArray(next.games)) {
    try {
      const wnbaV2 = await attachWnbaV2Research(next.games, env, next.date || date);
      if (wnbaV2.meta?.projected > 0) {
        next = {
          ...next,
          games: wnbaV2.games,
          modelVersion: wnbaV2.meta.version || next.modelVersion,
          research: { ...(next.research || {}), wnbaFbisV2: wnbaV2.meta },
        };
      } else {
        next = {
          ...next,
          research: { ...(next.research || {}), wnbaFbisV2: wnbaV2.meta },
        };
      }
    } catch (err) {
      next = {
        ...next,
        research: { ...(next.research || {}), wnbaFbisV2: { modelId:"WNBA-FBIS-v2", state:"CONTEXT_UNAVAILABLE", error:String(err?.message||err), canQualify:false, canAuthorize:false } },
      };
    }

    const wnbaCtx = await loadWnbaPlayerContext(next.games, next.date || date).catch((err) => ({
      byTeam: {},
      meta: { source:"ESPN_WNBA_ATHLETE_STATS", error:String(err?.message||err), marketInformed:false },
    }));
    const wnbaPlayers = attachWnbaPlayerProjectionResearch(next.games, wnbaCtx);
    next = {
      ...next,
      games: wnbaPlayers.games,
      research: {
        ...(next.research || {}),
        wnbaPlayerProjection: wnbaPlayers.meta,
      },
    };
  }

  if (id === "nba" && Array.isArray(next.games)) {
    next = {
      ...next,
      games: attachNbaPlayerProjectionBlocked(next.games),
      research: {
        ...(next.research || {}),
        nbaPlayerProjection: {
          state: "BLOCKED_RIGHTS_CLEARED_PLAYER_FEED",
          canQualify: false,
          canAuthorize: false,
          marketInformed: false,
        },
      },
    };
  }

  // Availability adjustment is applied only after the sport's final board model
  // has been selected/promoted, so it cannot be overwritten by research-board
  // promotion. This remains bounded and fully captured in the frozen snapshot.
  if (Array.isArray(next.games) && ["nfl","cfb"].includes(id)) {
    next = {
      ...next,
      games: next.games.map((game) => applyAvailabilityAdjustment(game, id)),
    };
  }

  // Publish sport-specific, source-backed analysis factors after the final
  // projection/decomposition has been selected. Presentation only.
  if (Array.isArray(next.games)) {
    next = { ...next, games: attachMatchupFactors(next.games) };
  }

  // ACTION market intelligence — display on every board sport; never odds authority.
  if (env.DB && Array.isArray(next.games) && next.games.length) {
    try {
      // Dynamic import keeps ACTION/node:crypto off the browser slateEngine graph.
      const { attachActionIntelToGames } = await import("./boardActionIntel.js");
      const attached = await attachActionIntelToGames(next.games, env.DB);
      next = {
        ...next,
        games: attached.games,
        actionIntel: {
          role: "market_intelligence",
          governanceMode: "shadow",
          displayOnly: true,
          inProductionRouter: false,
          canQualify: false,
          attached: attached.attached || 0,
          checked: attached.checked || 0,
        },
      };
    } catch {
      // Fail-open.
    }
  }

  // NFL wager decisioning is downstream of the independent projection and the
  // executable market. ACTION may inform confidence context but never enters
  // the projection and can never create a wager by itself.
  if (id === "nfl" && Array.isArray(next.games)) {
    next = {
      ...next,
      games: attachNflWagerDecisions(next.games, NFL_WAGER_CONFIDENCE_V1),
      nflWagerArchitecture: {
        version: "NFL-WAGER-v2",
        independentProjectionMarketFree: true,
        confidenceValidated: Boolean(NFL_WAGER_CONFIDENCE_V1.validated),
        stakingValidated: false,
        actionDirectQualification: false,
        closeUsedAsDecisionInput: false,
      },
    };
    if (env.DB) {
      try {
        const { persistNflWagerDecisionSnapshots } = await import("./nflWagerDecisionStore.js");
        const persisted = await persistNflWagerDecisionSnapshots(env.DB, next.games);
        next.nflWagerArchitecture = {
          ...next.nflWagerArchitecture,
          decisionSnapshotsPersisted: persisted.inserted || 0,
        };
      } catch {
        next.nflWagerArchitecture = {
          ...next.nflWagerArchitecture,
          decisionSnapshotsPersisted: 0,
        };
      }
    }
  }

  return next;
}

export function qualificationIntegrity(sport, game) {
  const id = String(sport || game?.sport || "").toLowerCase();
  const projectionKind = game?.projectionKind || game?.model?.projectionKind || null;
  const flags = new Set(game?.quality?.flags || []);

  // Research / maturity-gated models may display and publish but never qualify.
  if (
    game?.canQualify === false ||
    game?.qualificationBlocked === true ||
    game?.model?.canQualify === false ||
    String(game?.projectionMaturity || game?.model?.maturity || "").toUpperCase() === "RESEARCH" ||
    game?.bettingAuthority === "NOT_ELIGIBLE"
  ) {
    return {
      ok: false,
      reason: "Qualification blocked — research / non-production projection has no wager authority",
      code: "research-no-wager-authority",
      reasonCode: REASON_CODE.NO_PURE_MODEL,
    };
  }

  // Canonical authority: projectionKind != FBIS (incl. market-implied) never qualifies.
  const implied = marketImpliedAuthority(projectionKind);
  if (implied.canQualify === false) {
    const board = deriveBoardDecision({
      hasPureProjection: false,
      projectionKind,
      qualified: false,
    });
    const label = id.toUpperCase();
    const reason =
      id === "nfl"
        ? "NFL qualification blocked — no independent NFL model"
        : implied.isMarketImplied
          ? `Qualification blocked — ${implied.displayLabel} is market context, not an independent model`
          : `${label} qualification blocked — no independent FBIS projection`;
    return {
      ok: false,
      reason,
      code: implied.reasonCode || "independent-projection-required",
      boardDecision: board.decision,
      reasonCode: implied.reasonCode || REASON_CODE.NO_PURE_MODEL,
    };
  }

  if (INDEPENDENT_SCORE_REQUIRED.has(id) && projectionKind !== "FBIS") {
    const label = id.toUpperCase();
    const reason = id === "nfl"
      ? "NFL qualification blocked — no independent NFL model"
      : `${label} qualification blocked — no independent FBIS projection`;
    return { ok: false, reason, code: "independent-projection-required" };
  }

  // Preserve specific starter flag codes for callers/tests before generic DQ collapse.
  if (id === "mlb") {
    for (const flag of MLB_STARTER_FLAGS) {
      if (flags.has(flag)) {
        return { ok: false, reason: "MLB qualification blocked — probable starter is unresolved", code: flag };
      }
    }
  }

  const dq = evaluateDqGate(qualificationBlockersFromGame({ ...game, sport: id }));
  if (!dq.okForQualification) {
    const first = dq.qualificationBlocks[0] || dq.modelBlocks[0];
    return {
      ok: false,
      reason: first?.message || "Qualification blocked — data quality gate",
      code: first?.reasonCode || REASON_CODE.DATA_QUALITY_BLOCK,
      reasonCode: first?.reasonCode || REASON_CODE.DATA_QUALITY_BLOCK,
    };
  }

  for (const flag of CRITICAL_QUALITY_FLAGS) {
    if (flags.has(flag)) {
      return {
        ok: false,
        reason: flag === "pinnacle_implied_score" ? "Qualification blocked — Pinnacle-implied scores are market context, not an independent model" : "Qualification blocked — market/team identity unresolved",
        code: flag,
      };
    }
  }
  return { ok: true, reason: null, code: null };
}

function pinF5Complete(game, market) {
  const m = String(market || "").toUpperCase();
  if (!m.startsWith("F5")) return true;
  const pin = game?.pin || pinMarkets(game);
  if (m === "F5 ML") return Boolean(pin?.f5ml?.complete);
  if (m === "F5 TOTAL") return Boolean(pin?.f5total?.complete);
  if (m === "F5 SPREAD") return Boolean(pin?.f5spread?.complete);
  return false;
}

function leanFromCandidate(candidate, reason) {
  if (!candidate) return null;
  return { ...candidate, qualified: false, lean: true, tag: "LEAN", reason };
}

export function recommendBundle(sport, game, model, weights) {
  const integrity = qualificationIntegrity(sport, game);
  if (!integrity.ok) return { qualified: null, lean: null, blocked: true, blockReason: integrity.reason, integrityCode: integrity.code };
  const bundle = core.recommendBundle(sport, game, model, weights);
  const candidate = bundle?.qualified || bundle?.pausedCandidate || null;
  if (candidate && !pinF5Complete(game, candidate.market)) {
    const reason = "F5 qualification blocked — complete two-way Pinnacle market required";
    return { ...bundle, qualified: null, pausedCandidate: null, lean: bundle?.lean || leanFromCandidate(candidate, reason), blocked: false, integrityCode: "f5-pinnacle-two-way-required", blockReason: reason };
  }
  return bundle;
}

export function recommend(sport, game, model, weights) { return recommendBundle(sport, game, model, weights).qualified; }
