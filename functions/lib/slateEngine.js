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
import { pinMarkets } from "./pricing.js";

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

  if (id === "mlb") {
    const bullpen = await loadMlbBullpenContext(slate.games || [], env).catch((err) => ({
      byTeamId: {}, meta: { source: "MLB Stats relief split", teams: 0, available: 0, error: String(err?.message || err), marketInformed: false },
    }));
    const enriched = attachMlbBullpenContext(slate.games || [], bullpen);
    const deep = attachMlbDeepShadow(enriched);
    return {
      ...slate,
      games: deep.games,
      research: { ...(slate.research || {}), mlbBullpen: bullpen.meta, mlbDeep: deep.meta },
    };
  }

  if (id === "cfb") {
    const feed = await loadCfbDeepFeatures(env).catch((err) => ({
      byEspnId: {}, bySchool: {}, meta: { configured: false, records: 0, error: String(err?.message || err) },
    }));
    const enriched = attachCfbDeepFeatures(slate.games || [], feed);
    const deep = attachCfbMatchupV2(enriched);
    const v2 = attachCfbFbisV2(deep.games);
    const promoted = promoteCfbFbisV2ToBoard(v2.games);
    // Player model consumes game environment only — no CFBD fanout on customer refresh
    const players = attachCfbPlayerV1(promoted.games);
    return {
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
  }

  if (id === "nfl") {
    const baseline = await attachNflShadow(slate.games || [], env);
    const verse = await loadNflVerseFeatures(env).catch((err) => ({
      byTeam: {}, meta: { source: "nflverse", teams: 0, error: String(err?.message || err), marketInformed: false },
    }));
    const enriched = attachNflVerseFeatures(baseline.games, verse);
    const pro = attachNflProShadow(enriched);
    return {
      ...slate,
      games: pro.games,
      nfl: baseline.meta,
      research: { ...(slate.research || {}), nflBaseline: baseline.meta, nflVerse: verse.meta, nflPro: pro.meta },
    };
  }

  return slate;
}

export function qualificationIntegrity(sport, game) {
  const id = String(sport || game?.sport || "").toLowerCase();
  const projectionKind = game?.projectionKind || game?.model?.projectionKind || null;
  const flags = new Set(game?.quality?.flags || []);
  if (INDEPENDENT_SCORE_REQUIRED.has(id) && projectionKind !== "FBIS") {
    const label = id.toUpperCase();
    const reason = id === "nfl"
      ? "NFL qualification blocked — no independent NFL model"
      : `${label} qualification blocked — no independent FBIS projection`;
    return { ok: false, reason, code: "independent-projection-required" };
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
  if (id === "mlb") {
    for (const flag of MLB_STARTER_FLAGS) {
      if (flags.has(flag)) return { ok: false, reason: "MLB qualification blocked — probable starter is unresolved", code: flag };
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
