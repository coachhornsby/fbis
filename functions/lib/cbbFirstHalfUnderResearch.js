/**
 * CBB first-half under research screener.
 * Research only: does not issue picks, stakes, or change CBB-PRO production authority.
 * First-half projection must be independently modeled, never full-game / 2.
 */
export const CBB_1H_UNDER_RESEARCH_VERSION = "research-v0.1";
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const ISO = (x) => typeof x === "string" && Number.isFinite(Date.parse(x));
export function screenCbbFirstHalfUnder(input, options = {}) {
  const reasons = [];
  const asOf = options.asOf;
  const maxAgeMs = options.maxAgeMs ?? 120_000;
  const preferredGap = options.preferredGap ?? 3;
  if (!ISO(asOf)) reasons.push("MISSING_REVIEW_TIMESTAMP");
  if (input?.sport !== "cbb") reasons.push("NOT_CBB");
  if (input?.market?.period !== "1H" || input?.market?.type !== "total" || input?.market?.side !== "under") reasons.push("NOT_FIRST_HALF_UNDER_MARKET");
  if (!finite(input?.market?.line) || input.market.line <= 0) reasons.push("MISSING_1H_LINE");
  if (!finite(input?.projection?.firstHalfTotal) || input.projection.firstHalfTotal <= 0) reasons.push("MISSING_INDEPENDENT_1H_PROJECTION");
  if (input?.projection?.method !== "independent_first_half") reasons.push("UNVERIFIED_1H_MODEL");
  if (input?.projection?.validated !== true) reasons.push("1H_MODEL_NOT_VALIDATED");
  if (!input?.projection?.modelId || !input?.projection?.version) reasons.push("MISSING_MODEL_PROVENANCE");
  if (!ISO(input?.projection?.capturedAt)) reasons.push("MISSING_PROJECTION_TIMESTAMP");
  if (!ISO(input?.market?.capturedAt)) reasons.push("MISSING_MARKET_TIMESTAMP");
  if (!["kalshi","polymarket_us","pinnodds"].includes(input?.market?.source)) reasons.push("UNKNOWN_MARKET_SOURCE");
  if (input?.market?.contractVerified !== true) reasons.push("MARKET_RULES_UNVERIFIED");
  if (input?.market?.executable !== true) reasons.push("QUOTE_NOT_EXECUTABLE");
  if (!finite(input?.market?.allInCost) || input.market.allInCost <= 0) reasons.push("MISSING_ALL_IN_COST");
  if (!finite(input?.market?.depth) || input.market.depth <= 0) reasons.push("MISSING_DEPTH");
  const at = ISO(asOf) ? Date.parse(asOf) : NaN;
  const age = (stamp) => ISO(stamp) ? at - Date.parse(stamp) : NaN;
  if (Number.isFinite(age(input?.market?.capturedAt)) && (age(input.market.capturedAt) < 0 || age(input.market.capturedAt) > maxAgeMs)) reasons.push("STALE_OR_FUTURE_MARKET");
  if (Number.isFinite(age(input?.projection?.capturedAt)) && (age(input.projection.capturedAt) < 0 || age(input.projection.capturedAt) > (options.projectionMaxAgeMs ?? 6 * 60 * 60 * 1000))) reasons.push("STALE_OR_FUTURE_PROJECTION");
  if (input?.game?.started === true) reasons.push("GAME_STARTED");
  const gap = finite(input?.market?.line) && finite(input?.projection?.firstHalfTotal)
    ? Math.round((input.market.line - input.projection.firstHalfTotal) * 10) / 10 : null;
  if (gap !== null && gap < preferredGap) reasons.push("BELOW_PREFERRED_RESEARCH_GAP");
  return {
    marketFamily: "CBB_1H_UNDER", version: CBB_1H_UNDER_RESEARCH_VERSION,
    status: reasons.length ? "BLOCKED" : "RESEARCH_CANDIDATE",
    gapPoints: gap, reasons, source: input?.market?.source ?? null,
    authority: { canQualify: false, canAuthorizeWager: false, stakeUnits: 0,
      reason: "CBB first-half total qualification and price-aware validation are not approved; research output only." }
  };
}
