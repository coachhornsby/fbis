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
import { attachNflVerseFeatures, loadNflVerseFeatures } from "./nflVerseFeed.js";
import { attachMlbDeepShadow } from "./mlbDeepModel.js";
import { attachMlbBullpenContext, loadMlbBullpenContext } from "./mlbBullpenFeed.js";
import { attachCfbMatchupV2 } from "./cfbMatchupV2.js";
import { attachCfbFbisV2, promoteCfbFbisV2ToBoard } from "./cfbFbisV2.js";
import { attachCfbPlayerV1 } from "./cfbPlayerModel.js";
import { attachCfbDeepFeatures, loadCfbDeepFeatures } from "./cfbDeepFeed.js";
import { promoteNflResearchToBoard, promoteCbbResearchToBoard } from "./researchBoardPromote.js";
import { loadCbbdCatalog } from "./collegeApply.js";
import { pinMarkets } from "./pricing.js";
import { attachActionIntelToGames } from "./boardActionIntel.js";
import {
  marketImpliedAuthority,
  deriveBoardDecision,
  qualificationBlockersFromGame,
  evaluateDqGate,
  REASON_CODE,
} from "./canonical/index.js";

export * from "./slateEngineCore.js";
export { pinMarkets } from "./pricing.js";

const INDEPENDENT_SCORE_REQUIRED = new Set(["cbb", "nba", "nfl"]);
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
    const enriched = attachMlbBullpenContext(slate.games || [], bullpen);
    const deep = attachMlbDeepShadow(enriched);
    next = {
      ...slate,
      games: deep.games,
      research: { ...(slate.research || {}), mlbBullpen: bullpen.meta, mlbDeep: deep.meta },
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
      byTeam: {}, meta: { source: "nflverse", teams: 0, error: String(err?.message || err), marketInformed: false },
    }));
    const enriched = attachNflVerseFeatures(baseline.games, verse);
    const pro = attachNflProShadow(enriched);
    // Research board: independent form/pure scores are displayable + freezable,
    // but never qualify or authorize.
    const research = promoteNflResearchToBoard(pro.games);
    next = {
      ...slate,
      games: research.games,
      nfl: baseline.meta,
      research: {
        ...(slate.research || {}),
        nflBaseline: baseline.meta,
        nflVerse: verse.meta,
        nflPro: pro.meta,
        nflResearchBoard: research.meta,
      },
    };
  } else if (id === "cbb") {
    // Core already attached CBBD challengers + market-implied board scores.
    // Promote possessions×PPP research onto the board; strip market masquerade.
    const catalog = await loadCbbdCatalog(env).catch(() => null);
    const research = promoteCbbResearchToBoard(slate.games || [], catalog);
    next = {
      ...slate,
      games: research.games,
      research: { ...(slate.research || {}), cbbResearchBoard: research.meta },
    };
  }

  // ACTION market intelligence — display on every board sport; never odds authority.
  if (env.DB && Array.isArray(next.games) && next.games.length) {
    try {
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
