export function holdProb(p) {
  const q = 1 - p, dp = 2 * p * q;
  if (dp >= 1) return 0.5;
  const p3 = p * p * p, p4 = p3 * p;
  return p4 + 4 * p4 * q + 10 * p4 * q * q + 20 * p3 * q * q * q * ((p * p) / (1 - dp));
}
export function setWinProb(hA, hB) {
  const memo = new Map();
  const rec = (a, b, aServes) => {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    if (a === 7) return 1;
    if (b === 7) return 0;
    if (a === 6 && b === 6) return 0.5;
    const k = a * 100 + b * 2 + (aServes ? 1 : 0);
    if (memo.has(k)) return memo.get(k);
    const pWinGame = aServes ? hA : 1 - hB;
    const v = pWinGame * rec(a + 1, b, !aServes) + (1 - pWinGame) * rec(a, b + 1, !aServes);
    memo.set(k, v); return v;
  };
  return rec(0, 0, true);
}
export function matchWinProb(s, bestOf = 3) {
  if (bestOf === 5) return s ** 3 * (1 + 3 * (1 - s) + 6 * (1 - s) ** 2);
  return s * s * (1 + 2 * (1 - s));
}
const impliedWin = (pA, pB, bestOf) => matchWinProb(setWinProb(holdProb(pA), holdProb(pB)), bestOf);
export function anchorToWinProb(sum, targetWin, bestOf = 3) {
  const S = Math.min(1.60, Math.max(1.00, sum));
  const clampP = (x) => Math.min(0.88, Math.max(0.45, x));
  let lo = -0.30, hi = 0.30;
  const fdiff = (d) => impliedWin(clampP((S + d) / 2), clampP((S - d) / 2), bestOf);
  if (fdiff(lo) > targetWin) { const d = lo; return { pA: clampP((S + d) / 2), pB: clampP((S - d) / 2), anchored: true, clipped: true }; }
  if (fdiff(hi) < targetWin) { const d = hi; return { pA: clampP((S + d) / 2), pB: clampP((S - d) / 2), anchored: true, clipped: true }; }
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fdiff(mid) < targetWin) lo = mid; else hi = mid; }
  const d = (lo + hi) / 2;
  return { pA: clampP((S + d) / 2), pB: clampP((S - d) / 2), anchored: true, clipped: false };
}
export default { holdProb, setWinProb, matchWinProb, anchorToWinProb };
