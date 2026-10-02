import { buildBoardGameViewModel } from "./boardViewModel.js";

const TIER_FALLBACK = Object.freeze({
  CONVICTION: 5,
  QUALIFIED: 4,
  LEAN: 3,
  WATCH: 3,
  PASS: 2,
  RESEARCH: 2,
  BLOCKED: 1,
  NO_MODEL: 1,
});

export function confidenceStars(game) {
  const vm = buildBoardGameViewModel(game);
  const tier = String(vm.decision?.tier || "").toUpperCase();
  const qualification = String(vm.decision?.qualification || "").toUpperCase();
  const q = Number(vm.quality?.score);
  let stars = Number.isFinite(q)
    ? q >= 90 ? 5 : q >= 80 ? 4 : q >= 68 ? 3 : q >= 55 ? 2 : 1
    : (TIER_FALLBACK[tier] || 2);

  if (qualification === "QUALIFIED" && !Number.isFinite(q)) stars = Math.max(stars, 4);
  if (tier === "CONVICTION" && !Number.isFinite(q)) stars = 5;

  // Governance caps: research/watch states can be useful signals, but cannot
  // visually outrank fully qualified production decisions.
  if (vm.authority?.research || qualification === "RESEARCH_ONLY") stars = Math.min(stars, 3);
  if (qualification === "WATCH" || tier === "LEAN") stars = Math.min(stars, 4);
  if (qualification === "NO_QUALIFY" || tier === "PASS") stars = Math.min(stars, 3);
  if (tier === "BLOCKED" || tier === "NO_MODEL" || vm.decision?.dqState) stars = 1;

  return Math.max(1, Math.min(5, stars));
}

export function sortByConfidence(games = []) {
  return [...games].sort((a, b) => {
    const starDiff = confidenceStars(b) - confidenceStars(a);
    if (starDiff) return starDiff;
    const qa = Number(buildBoardGameViewModel(a).quality?.score);
    const qb = Number(buildBoardGameViewModel(b).quality?.score);
    if (Number.isFinite(qa) || Number.isFinite(qb)) {
      const qualityDiff = (Number.isFinite(qb) ? qb : -1) - (Number.isFinite(qa) ? qa : -1);
      if (qualityDiff) return qualityDiff;
    }
    const ta = Date.parse(a?.start || a?.startTime || "") || Number.POSITIVE_INFINITY;
    const tb = Date.parse(b?.start || b?.startTime || "") || Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta - tb;
    return String(a?.id || "").localeCompare(String(b?.id || ""));
  });
}
