import { buildBoardGameViewModel } from "./boardViewModel.js";

function canonicalStars(game = {}) {
  const value = Number(game?.confidenceStars);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.round(value)));
}

/**
 * Display-only accessor.
 *
 * FBIS-CONFIDENCE-v2 is computed server-side. The client must never recalculate
 * confidence from quality, edge, maturity, or sport-specific fields because that
 * can make the same game display different ratings on different pages.
 */
export function confidenceStars(game) {
  return canonicalStars(game);
}

export function sortByConfidence(games = []) {
  return [...games].sort((a, b) => {
    const finalA = buildBoardGameViewModel(a).event?.final ? 1 : 0;
    const finalB = buildBoardGameViewModel(b).event?.final ? 1 : 0;
    if (finalA !== finalB) return finalA - finalB;

    // A five-star shell with no independent NHL forecast must never outrank an evidence-backed card.
    const effectiveStars = g => String(g?.sport||"").toLowerCase()==="nhl" && !buildBoardGameViewModel(g)?.projection?.available ? -1 : confidenceStars(g);
    const starDiff = effectiveStars(b) - effectiveStars(a);
    if (starDiff) return starDiff;

    const scoreA = Number(a?.confidenceScore);
    const scoreB = Number(b?.confidenceScore);
    if (Number.isFinite(scoreA) || Number.isFinite(scoreB)) {
      const scoreDiff =
        (Number.isFinite(scoreB) ? scoreB : -1) -
        (Number.isFinite(scoreA) ? scoreA : -1);
      if (scoreDiff) return scoreDiff;
    }

    const ta =
      Date.parse(a?.start || a?.startTime || "") || Number.POSITIVE_INFINITY;
    const tb =
      Date.parse(b?.start || b?.startTime || "") || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
