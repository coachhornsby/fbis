import { replayNflProScore } from "./nflScoreReplayAudit.js";

/**
 * Forward-only pregame audit attachment. No reconstructed historical rows.
 * This packet is diagnostic evidence and never qualifies a model or wager.
 */
export function buildNflFrozenAuditPacket(game = {}, slate = {}) {
  const shadow = game.nflProShadow;
  if (!shadow?.ok || !shadow.decomposition) {
    return { schema: "nfl-frozen-score-audit-v1", ok: false, reason: "model-decomposition-unavailable", canQualify: false };
  }
  const replay = replayNflProScore(shadow);
  if (!replay.ok || !replay.reconciled) {
    return { schema: "nfl-frozen-score-audit-v1", ok: false, reason: replay.reason, replay, canQualify: false };
  }
  const scoreHome = game.model?.projHome ?? game.projHomeScore ?? null;
  const scoreAway = game.model?.projAway ?? game.projAwayScore ?? null;
  const displayedScoreMatches = typeof scoreHome === "number" && typeof scoreAway === "number"
    && Math.abs(scoreHome - shadow.home) <= 0.11 && Math.abs(scoreAway - shadow.away) <= 0.11;
  const pitInput = game.nflFeatures;
  const hasInput = pitInput && Object.keys(pitInput.home || {}).length && Object.keys(pitInput.away || {}).length;
  return {
    schema: "nfl-frozen-score-audit-v1",
    ok: true,
    modelId: shadow.modelId,
    modelVersion: shadow.version,
    projection: { home: shadow.home, away: shadow.away, total: shadow.total, margin: shadow.margin },
    replay,
    publishedScoreMatches: displayedScoreMatches,
    // Snapshot provenance metadata and source freshness must be verified separately.
    inputSnapshot: hasInput ? structuredClone(pitInput) : null,
    inputStatus: hasInput ? "attached-at-publication" : "unavailable",
    feedMetadata: slate.research?.nflVerse || null,
    pitVerified: false,
    canQualify: false,
    canAuthorizeWager: false,
  };
}
