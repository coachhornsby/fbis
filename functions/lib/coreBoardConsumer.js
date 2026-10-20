/**
 * Production board-consumer path for CORE summaries.
 * Boards must call this instead of fan-out querying sport D1s.
 * Fail-closed on missing/stale/incomplete CORE snapshots.
 */
import {
  requireFreshCoreBoardSummary,
  CORE_BOARD_SUMMARY_MAX_AGE_MS,
} from "./coreBoardSummaries.js";

export const CORE_BOARD_CONSUMER_CONTRACT = "fbis-core-board-consumer-v1";

/**
 * Resolve a cross-sport board overview from CORE only.
 * Never opens sport D1 handles; never authorizes wager.
 */
export async function loadCoreBoardOverview(env, {
  now = new Date(),
  maxAgeMs = CORE_BOARD_SUMMARY_MAX_AGE_MS,
} = {}) {
  const required = await requireFreshCoreBoardSummary(env, { now, maxAgeMs });
  if (!required.ok) {
    return {
      contract: CORE_BOARD_CONSUMER_CONTRACT,
      ok: false,
      usable: false,
      reason: required.reason || "CORE_BOARD_UNUSABLE",
      asOf: required.asOf || null,
      freshness: required.freshness || null,
      sports: [],
      source: "CORE",
      canAuthorizeWager: false,
    };
  }
  const sports = Array.isArray(required.summary?.sports) ? required.summary.sports : [];
  return {
    contract: CORE_BOARD_CONSUMER_CONTRACT,
    ok: true,
    usable: true,
    reason: "CORE_FRESH",
    asOf: required.asOf,
    freshness: required.freshness,
    sports,
    sourceBinding: required.sourceBinding || "CORE_DB",
    source: "CORE",
    canAuthorizeWager: false,
  };
}
