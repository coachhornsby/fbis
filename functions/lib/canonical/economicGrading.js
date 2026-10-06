export const ECONOMIC_GRADE_VERSION = "FBIS-ECONOMIC-GRADE-v1";

function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampP(v) {
  const n = finite(v);
  if (n == null) return null;
  return Math.max(1e-9, Math.min(1 - 1e-9, n));
}

export function americanToDecimal(price) {
  const p = finite(price);
  if (p == null || p === 0) return null;
  return p > 0 ? 1 + p / 100 : 1 + 100 / Math.abs(p);
}

export function americanImpliedProbability(price) {
  const d = americanToDecimal(price);
  return d == null ? null : 1 / d;
}

export function noVigPair(priceA, priceB) {
  const a = americanImpliedProbability(priceA);
  const b = americanImpliedProbability(priceB);
  if (a == null || b == null || a + b <= 0) return { a: null, b: null, vig: null };
  return { a: a / (a + b), b: b / (a + b), vig: a + b - 1 };
}

export function binaryCalibrationLosses(projectedProbability, won) {
  const p = clampP(projectedProbability);
  if (p == null || typeof won !== "boolean") return { brier: null, logLoss: null };
  const y = won ? 1 : 0;
  return {
    brier: (p - y) ** 2,
    logLoss: -(y * Math.log(p) + (1 - y) * Math.log(1 - p)),
  };
}

export function profitUnitsFromAmerican(price, result, stakeUnits = 1) {
  const stake = finite(stakeUnits);
  const d = americanToDecimal(price);
  if (stake == null || d == null) return null;
  const r = String(result || "").toUpperCase();
  if (r === "PUSH" || r === "VOID") return 0;
  if (r === "LOSS" || r === "LOST") return -stake;
  if (r === "WIN" || r === "WON") return stake * (d - 1);
  return null;
}

export function probabilityClv(entryNoVigProbability, closeNoVigProbability) {
  const e = finite(entryNoVigProbability);
  const c = finite(closeNoVigProbability);
  if (e == null || c == null) return null;
  return c - e;
}

export function maximumDrawdown(profitUnits = []) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const raw of profitUnits) {
    const p = finite(raw);
    if (p == null) continue;
    equity += p;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return maxDrawdown;
}

export function buildEconomicGrade({
  gradeId,
  evidenceId,
  sport,
  eventId,
  marketFamily,
  selection,
  projectedProbability = null,
  entryLine = null,
  entryPrice = null,
  entryNoVigProbability = null,
  closeLine = null,
  closePrice = null,
  closeNoVigProbability = null,
  result = null,
  stakeUnits = 1,
  gradedAt = null,
  metadata = {},
} = {}) {
  if (!gradeId || !evidenceId || !sport || !eventId || !marketFamily || !selection) {
    throw new Error("economic_grade_incomplete");
  }
  const normalizedResult = result ? String(result).toUpperCase() : null;
  const won = ["WIN", "WON"].includes(normalizedResult)
    ? true
    : ["LOSS", "LOST"].includes(normalizedResult)
      ? false
      : null;
  const losses = binaryCalibrationLosses(projectedProbability, won);
  const profitUnits = profitUnitsFromAmerican(entryPrice, normalizedResult, stakeUnits);
  const stake = finite(stakeUnits);
  return Object.freeze({
    version: ECONOMIC_GRADE_VERSION,
    gradeId: String(gradeId),
    evidenceId: String(evidenceId),
    sport: String(sport).toLowerCase(),
    eventId: String(eventId),
    marketFamily: String(marketFamily),
    selection: String(selection),
    projectedProbability: finite(projectedProbability),
    entryLine: finite(entryLine),
    entryPrice: finite(entryPrice),
    entryNoVigProbability: finite(entryNoVigProbability),
    closeLine: finite(closeLine),
    closePrice: finite(closePrice),
    closeNoVigProbability: finite(closeNoVigProbability),
    result: normalizedResult,
    stakeUnits: stake,
    clvProbability: probabilityClv(entryNoVigProbability, closeNoVigProbability),
    profitUnits,
    roi: profitUnits == null || stake == null || stake === 0 ? null : profitUnits / stake,
    brier: losses.brier,
    logLoss: losses.logLoss,
    gradedAt: gradedAt || null,
    metadata: { ...metadata },
  });
}
