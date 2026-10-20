import { buildBoardGameViewModel } from "./boardViewModel.js";

export const CONFIDENCE_STARS_DISPLAY_MAX = 5;

function bounded(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(CONFIDENCE_STARS_DISPLAY_MAX, Math.round(n)));
}

/**
 * Display ceiling supplied by the server. A sport whose confidence head cannot
 * reach the top of the score scale (NHL, whose evidence ladder tops out at 69)
 * sends a ceiling below five. Drawing those ratings on a five-star row is what
 * made a capped rating look like a partial five-star pick.
 *
 * When the ceiling is absent but the server has explicitly ruled five stars out,
 * the row still cannot show five. The client never derives the rating itself.
 */
export function confidenceStarsMax(game = {}) {
  if (Number.isFinite(Number(game?.confidenceStarsMax))) return bounded(game.confidenceStarsMax, CONFIDENCE_STARS_DISPLAY_MAX);
  if (game?.confidenceFiveStarEligible === false) return CONFIDENCE_STARS_DISPLAY_MAX - 1;
  return CONFIDENCE_STARS_DISPLAY_MAX;
}

/**
 * Display-only accessor.
 *
 * FBIS-CONFIDENCE-v2 is computed server-side. The client must never recalculate
 * confidence from quality, edge, maturity, or sport-specific fields because that
 * can make the same game display different ratings on different pages. It does
 * clamp a supplied star count to the supplied ceiling, so a stale or hand-edited
 * payload cannot paint five stars on a head that is not eligible for them.
 */
export function confidenceStars(game) {
  return Math.min(bounded(game?.confidenceStars, 1), confidenceStarsMax(game));
}

export function confidenceStarPresentation(game = {}) {
  const max = confidenceStarsMax(game);
  const stars = confidenceStars(game);
  const fiveStarEligible = max >= CONFIDENCE_STARS_DISPLAY_MAX && game?.confidenceFiveStarEligible !== false;
  return {
    stars,
    max,
    fiveStarEligible,
    label: `${stars} of ${max} confidence stars`,
  };
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
