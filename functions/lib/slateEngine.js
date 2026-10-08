import {currentActionDisplay} from './actionDisplayFreshness.js';
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
import { attachNflGameMatchups } from "./nflGameMatchup.js";
import { attachNflWagerDecisions } from "./nflWagerDecision.js";
import { loadNflTeamProfiles, attachNflPersistentProfiles } from "./nflTeamProfiles.js";
import { NFL_WAGER_CONFIDENCE_V1 } from "../../data/models/nfl-wager-confidence-v1.js";
import { attachNflVerseFeatures, loadNflVerseFeatures } from "./nflVerseFeed.js";
import { attachMlbDeepShadow } from "./mlbDeepModel.js";
import { attachBasketballFormResearch } from "./basketballFormModel.js";
import { attachSoccerV2Research } from "./soccerFbisV2.js";
import { attachSoccerV3Research } from "./soccerFbisV3.js";
import { attachMlbBullpenContext, loadMlbBullpenContext } from "./mlbBullpenFeed.js";
import { attachMlbPostseasonContext, loadMlbPostseasonContext } from "./mlbPostseasonContext.js";
import { loadMlbPitchMatchupContext } from "./mlbPitchMatchupFeed.js";
import { loadMlbPersistentState, buildPersistentBullpenFeed, attachMlbPersistentState, attachMlbPersistentFeatureContext } from "./mlbPersistentProfiles.js";
import { attachCfbMatchupV2 } from "./cfbMatchupV2.js";
import { attachCfbFbisV2, promoteCfbFbisV2ToBoard } from "./cfbFbisV2.js";
import { attachCfbPlayerV1 } from "./cfbPlayerModel.js";
import { attachCfbDeepFeatures, loadCfbDeepFeatures } from "./cfbDeepFeed.js";
import { promoteMlbResearchToBoard, promoteNflResearchToBoard, promoteCbbResearchToBoard, promoteNhlResearchToBoard } from "./researchBoardPromote.js";
import { loadNhlResearchPrior, attachNhlResearch } from "./nhlResearchModel.js";
import { attachNhlV1, NHL_FBIS_V1_ID, NHL_FBIS_V1_VERSION } from "./nhlFbisV1.js";
import { loadNhlProV2Context, attachNhlProV2, NHL_PRO_V2_ID, NHL_PRO_V2_VERSION } from "./nhlProV2.js";
import { attachNhlGoalieProbabilityShadow } from "./nhlGoalieProbabilityShadow.js";
import { evaluateNhlGameWagers } from "./nhlWagerV1.js";
import { loadCbbdCatalog } from "./collegeApply.js";
import { attachCbbPro } from "./cbbProModel.js";
import { loadCbbPlayerContext } from "./cbbPlayerFeed.js";
import { attachCbbPlayerGameResearch } from "./cbbPlayerGameModel.js";
import { applyCbbPlayerMarginV1 } from "./cbbPlayerValidated.js";
import { attachCbbPlayerProps } from "./cbbPlayerPropModel.js";
import { pinMarkets } from "./pricing.js";
import { canonicalProjectionConfidence } from "./projectionConfidence.js";
import { applyAvailabilityAdjustment } from "./availability.js";
import { attachMatchupFactors } from "./matchupFactors.js";
import { attachMlbPlayerProjectionResearch, attachNpbPlayerProjectionResearch, attachKboPlayerProjectionResearch, attachNflPlayerProjectionResearch, attachNhlPlayerProjectionResearch, attachNbaPlayerProjectionBlocked } from "./proPlayerProjectionLayer.js";
import { attachNbaBoardProjection } from "./nbaBoardProjection.js";
import { loadWnbaPlayerContext, attachWnbaPlayerProjectionResearch } from "./wnbaPlayerProjection.js";
import { loadWnbaImpactContext, attachWnbaImpactShadows } from "./wnbaPlayerImpactShadow.js";
import { loadWnbaPossessionChallengerContext, attachWnbaProspectiveGameChallengers, attachWnbaPlayerOpportunityShadows } from "./wnbaProspectiveChallenger.js";
import { attachWnbaV2Research } from "./wnbaFbisV2.js";
import { buildWnbaGameDecisions, WNBA_WAGER_DECISION_VERSION } from "./wnbaWagerDecision.js";
import {
  marketImpliedAuthority,
  deriveBoardDecision,
  qualificationBlockersFromGame,
  evaluateDqGate,
  REASON_CODE,
} from "./canonical/index.js";

export * from "./slateEngineCore.js";
export { pinMarkets } from "./pricing.js";

const INDEPENDENT_SCORE_REQUIRED = new Set(["cbb", "nba", "wnba", "nhl", "nfl", "soccer", "npb", "kbo"]);
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
    const persistent = await loadMlbPersistentState(slate.games || [], env, { maxAgeHours: 14 }).catch((err) => ({
      byGameId: {},
      meta: { configured: false, error: String(err?.message || err) },
    }));
    const persistentGames = attachMlbPersistentState(slate.games || [], persistent);
    const featureGames = attachMlbPersistentFeatureContext(persistentGames, persistent);
    const persistentBullpen = buildPersistentBullpenFeed(featureGames, persistent);
    const usePersistentBullpen = persistentBullpen.meta.available > 0 || Boolean(env?.DB?.prepare);
    const bullpen = usePersistentBullpen
      ? persistentBullpen
      : await loadMlbBullpenContext(featureGames, env).catch((err) => ({
          byTeamId: {}, meta: { source: "MLB Stats relief split", teams: 0, available: 0, error: String(err?.message || err), marketInformed: false },
        }));

    // Production board requests consume one batched persistent D1 state read.
    // Expensive MLB Stats/Statcast fanout belongs to scheduled profile refreshes.
    const baseEnriched = attachMlbBullpenContext(featureGames, bullpen).map((game) => {
      const pal = game.bpp || {};
      const parkRunsPct = Number(pal.park?.runsPct);
      const parkHrPct = Number(pal.park?.hrPct);
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

    const postseason = await loadMlbPostseasonContext(baseEnriched, env, { persistentState: persistent }).catch((err) => ({
      byGameId: {},
      meta: { version: "research-v1-october-usage", postseasonGames: 0, available: 0, error: String(err?.message || err), marketInformed: false, canQualify: false },
    }));
    const octoberEnriched = attachMlbPostseasonContext(baseEnriched, postseason);

    // Statcast profile loader sees postseason state and shortens recency windows
    // for pitcher arsenal/pitch mix and hitter contact-zone behavior.
    const pitchMatchup = await loadMlbPitchMatchupContext(octoberEnriched, env, { persistentState: persistent }).catch((err) => ({
      byGameId: {},
      meta: { source: "Baseball Savant Statcast pitch-level", games: 0, available: 0, error: String(err?.message || err), marketInformed: false, canQualify: false },
    }));
    const enriched = octoberEnriched.map((game) => ({
      ...game,
      mlbPitchMatchup: pitchMatchup.byGameId?.[String(game.id || game.bpp?.gamePk || "")] || null,
    }));

    const deep = attachMlbDeepShadow(enriched);
    const research = promoteMlbResearchToBoard(deep.games);
    const playerResearch = attachMlbPlayerProjectionResearch(research.games, persistent);
    next = {
      ...slate,
      games: playerResearch,
      research: {
        ...(slate.research || {}),
        mlbPersistentProfiles: {
          ...persistent.meta,
          profileAgePolicyHours: 14,
          singleSlateRead: true,
          boardLiveFanout: Boolean(!env?.DB?.prepare),
        },
        mlbBullpen: bullpen.meta,
        mlbPostseason: postseason.meta,
        mlbPitchMatchup: pitchMatchup.meta,
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
    const gameMatchups = attachNflGameMatchups(pro.games);
    // Research board: independent form/pure scores are displayable + freezable,
    // but never qualify or authorize.
    const research = promoteNflResearchToBoard(gameMatchups.games);
    const playerResearch = attachNflPlayerProjectionResearch(research.games, { byTeam: verse.playersByTeam || {}, leaguePositionDefense: verse.leaguePositionDefense || {} });
    const profileKeys=[...new Set(playerResearch.flatMap(g=>[g?.home?.abbr,g?.away?.abbr]).filter(Boolean).map(x=>String(x).toLowerCase()))];
    const persistentProfiles=await loadNflTeamProfiles(env.DB||null,profileKeys).catch(()=>({teams:{},players:{}}));
    const profiledGames=attachNflPersistentProfiles(playerResearch,persistentProfiles);
    next = {
      ...slate,
      games: profiledGames,
      nfl: baseline.meta,
      research: {
        ...(slate.research || {}),
        nflBaseline: baseline.meta,
        nflVerse: verse.meta,
        nflPro: pro.meta,
        nflGameMatchup: gameMatchups.meta,
        nflResearchBoard: research.meta,
        nflPersistentProfiles: {
          version:"NFL-TEAM-PROFILE-v1",
          teams:Object.keys(persistentProfiles.teams||{}).length,
          players:Object.values(persistentProfiles.players||{}).reduce((n,x)=>n+x.length,0),
          scheduleStressResearchOnly:true,
        },
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
      loadNhlProV2Context(slate.date || date, slate.games || [], { DB: env.DB }).catch((err) => ({
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
    const goalieShadow = attachNhlGoalieProbabilityShadow(proV2.games, proContext.persistentProfiles||{});
    const research = promoteNhlResearchToBoard(goalieShadow.games);
    const playerResearch = attachNhlPlayerProjectionResearch(research.games, {...v1Context, playerEdge:proContext.playerEdge||null, opportunity:proContext.opportunity||null, persistentProfiles:proContext.persistentProfiles||null});
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
          opportunityRequested: Number(proContext.opportunity?.requested||0),
          opportunityAvailable: Number(proContext.opportunity?.available||0),
          opportunityCoverage: Number(proContext.opportunity?.coverage||0),
          opportunityStatus: proContext.opportunity?.__timeout ? "TIMEOUT_FAIL_SOFT" : proContext.opportunity?.__error ? "DEGRADED_FAIL_SOFT" : "ACTIVE",
          persistentProfileTeams: Object.keys(proContext.persistentProfiles?.teams||{}).length,
          persistentProfileStatus: proContext.persistentProfiles?.__timeout ? "TIMEOUT_FAIL_SOFT" : proContext.persistentProfiles?.__error ? "DEGRADED_FAIL_SOFT" : proContext.persistentProfiles?.ok ? "ACTIVE" : "UNAVAILABLE",
          persistentProfileRequestTimeSourceFetches: 0,
        },
        nhlGoalieProbabilityShadow: goalieShadow.meta,
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
        kboFbisV2: next.kbo || { modelId:"KBO-FBIS-v2", maturity:"RESEARCH", canQualify:false, canAuthorize:false },
      },
    };
  }

  if (id === "npb" && Array.isArray(next.games)) {
    next = {
      ...next,
      games: attachNpbPlayerProjectionResearch(next.games),
      research: {
        ...(next.research || {}),
        npbFbisV2: next.npb || { modelId:"NPB-FBIS-v2", maturity:"RESEARCH", canQualify:false, canAuthorize:false },
      },
    };
  }

  if (id === "soccer" && Array.isArray(next.games)) {
    const soccer = await attachSoccerV2Research(next.games, env);
    const v3 = await attachSoccerV3Research(soccer.games, env);
    next = {
      ...next,
      games: v3.games,
      modelVersion: soccer.meta?.version || next.modelVersion,
      research: {
        ...(next.research || {}),
        soccerFbisV2: soccer.meta,
        soccerFbisV3: v3.meta,
      },
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
    const impactCtx = await loadWnbaImpactContext(env.DB || null);
    const impactShadow = attachWnbaImpactShadows(wnbaPlayers.games, impactCtx);
    const opportunityShadow = attachWnbaPlayerOpportunityShadows(impactShadow.games, impactCtx);
    const possessionCtx = await loadWnbaPossessionChallengerContext(env.DB || null);
    const possessionShadow = attachWnbaProspectiveGameChallengers(opportunityShadow.games, possessionCtx);
    next = {
      ...next,
      games: possessionShadow.games,
      research: {
        ...(next.research || {}),
        wnbaPlayerProjection: wnbaPlayers.meta,
        wnbaPlayerImpact: {
          ...impactShadow.meta,
          context: impactCtx.meta,
          incumbentPlayerModel: "WNBA-PLAYER-PROJ-v2",
          challenger: "WNBA-PLAYER-PROP-IMPACT-v1",
          incumbentGameModel: "WNBA-FBIS-v2",
          gameChallenger: "WNBA-FBIS-IMPACT-v1",
        },
        wnbaPlayerOpportunity: opportunityShadow.meta,
        wnbaPossessionChallengers: {
          ...possessionShadow.meta,
          context: possessionCtx.meta,
          incumbentGameModel: "WNBA-FBIS-v2",
          productionAuthorityChanged: false,
        },
      },
    };
  }

  if (id === "nba" && Array.isArray(next.games)) {
    const hydrated = await attachNbaBoardProjection(next.games, env.DB || null);
    next = {
      ...next,
      games: attachNbaPlayerProjectionBlocked(hydrated.games),
      research: {
        ...(next.research || {}),
        nbaBoardProjection: hydrated.meta,
        nbaPlayerProjection: {
          state: "BLOCKED_RIGHTS_CLEARED_PLAYER_FEED",
          canQualify: false,
          canAuthorize: false,
          marketInformed: false,
        },
      },
    };
  }

  // State-before-weight governance:
  // - CFB retains its approved availability adjustment.
  // - NFL persistent state is attached broadly but MUST NOT alter the production
  //   champion. The only historically validated NFL state-derived model effect
  //   is the QB-personnel overlay, and that remains SHADOW-only until
  //   prospective validation + operator approval.
  if (Array.isArray(next.games) && id === "cfb") {
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

  // Validate ACTION inputs before any derived wager/market intelligence, including
  // preattached inputs and projection exports that bypass today's display filter.
  if (Array.isArray(next.games)) {
    const actionDecisionAt = Date.now();
    next = {...next, games: next.games.map(game => currentActionDisplay(game, actionDecisionAt))};
  }

  // NHL wager decisioning must run after ACTION intelligence is attached.
  // ACTION remains downstream context only and cannot alter NHL-PRO-v2.
  if (id === "nhl" && Array.isArray(next.games)) {
    next = {
      ...next,
      games: next.games.map(game=>({...game,nhlWagerV1:evaluateNhlGameWagers(game)})),
      nhlWagerArchitecture: {
        version: "NHL-WAGER-v1",
        independentProjectionMarketFree: true,
        actionDirectQualification: false,
        closeUsedAsDecisionInput: false,
        confidenceValidated: false,
        stakingValidated: false,
        opportunityLayer: "NHL-OPPORTUNITY-v4",
      },
    };
  }

  // WNBA wagering mirrors NFL game-level decisioning: the independent
  // projection stays market-free; actual offer/price and ACTION context are
  // downstream inputs. Closing information is evaluation-only.
  if (id === "wnba" && Array.isArray(next.games)) {
    const wagerGames = [];
    for (const game of next.games) {
      let packet;
      try {
        packet = await buildWnbaGameDecisions(game, env.DB || null, { minEv: 0.03 });
      } catch (err) {
        packet = { ok:false, gameId:String(game?.id||""), reason:String(err?.message||err), offers:[], candidates:[] };
      }
      wagerGames.push({ ...game, wnbaWagerDecision: packet });
    }
    next = {
      ...next,
      games: wagerGames,
      wnbaWagerArchitecture: {
        version: WNBA_WAGER_DECISION_VERSION,
        independentProjectionMarketFree: true,
        actionDirectQualification: false,
        closeUsedAsDecisionInput: false,
        confidenceValidated: wagerGames.some(g => g.wnbaWagerDecision?.confidenceValidated === true),
        stakingValidated: false,
        objective: "positive-expected-value-at-offered-price",
      },
    };
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

  next = {
    ...next,
    games: (next?.games || []).map((game) => {
      const confidence = canonicalProjectionConfidence({ ...game, sport: id });
      return {
        ...game,
        confidenceStars: confidence.stars,
        confidenceScore: confidence.score,
        confidenceVersion: confidence.version,
        confidenceSource: confidence.source,
      };
    }),
  };

  return next;
}

export function qualificationIntegrity(sport, game) {
  const id = String(sport || game?.sport || "").toLowerCase();
  const projectionKind = game?.projectionKind || game?.model?.projectionKind || null;
  const flags = new Set(game?.quality?.flags || []);

  // Explicit qualification approval is allowed to override a RESEARCH maturity label.
  // This separates "may surface a qualified edge" from "may size/authorize a wager".
  const explicitlyQualificationEnabled =
    game?.canQualify === true ||
    game?.model?.canQualify === true ||
    game?.nflProShadow?.canQualify === true ||
    game?.nhlProV2?.canQualify === true ||
    game?.mlbDeepShadow?.canQualify === true;
  if (
    game?.canQualify === false ||
    game?.qualificationBlocked === true ||
    game?.model?.canQualify === false ||
    (!explicitlyQualificationEnabled && String(game?.projectionMaturity || game?.model?.maturity || "").toUpperCase() === "RESEARCH") ||
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
