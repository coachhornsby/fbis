// tennisContext.mjs — the "unseen edge" layer. Sackmann gives the baseline; this adjusts a specific
// match for what the career average can't see: recent FORM and FATIGUE. Everything here is DATA-driven
// and bounded — no fabricated injury reads, no guessing. Each adjustment is small and capped, and the
// engine still leads; context only nudges. This is additive, never multiplicative (per the model's
// discipline), so two signals can't compound into a fake mega-edge.

// Weight recent results toward recency: last match counts most, decaying over ~10 matches.
// Returns a form score in [-1, +1]: +1 = won everything recently, -1 = lost everything.
export function formScore(recentResults /* [{won:bool, date}] newest-first */) {
  if (!Array.isArray(recentResults) || !recentResults.length) return 0;
  let num = 0, den = 0;
  recentResults.slice(0, 10).forEach((r, i) => {
    const w = Math.pow(0.85, i);            // decay: most recent match weighted 1.0, then 0.85, 0.72...
    num += w * (r.won ? 1 : -1);
    den += w;
  });
  return den ? num / den : 0;
}

// Fatigue: games played in the last N days. A player who just went deep in a 3-hour match is tired.
// Returns a fatigue penalty in [0, 1] where higher = more tired.
export function fatigueScore(recentMatches /* [{date, totalGames}] */, asOf = Date.now()) {
  if (!Array.isArray(recentMatches) || !recentMatches.length) return 0;
  let load = 0;
  for (const m of recentMatches) {
    const days = (asOf - new Date(m.date).getTime()) / 86400000;
    if (days < 0 || days > 3) continue;                    // only last 3 days matter
    const recencyMul = days <= 1 ? 1.0 : days <= 2 ? 0.6 : 0.3;
    load += (m.totalGames || 20) * recencyMul;
  }
  // ~25 games in a day is heavy; normalize and cap
  return Math.min(1, load / 45);
}

// Combine into a WIN-PROB adjustment for player A vs B. Bounded to ±0.06 total so context nudges,
// never dominates the Elo anchor. Form gap and fatigue gap each contribute, additively and capped.
export function contextWinAdj({ formA = 0, formB = 0, fatigueA = 0, fatigueB = 0 }) {
  const FORM_MAX = 0.04, FATIGUE_MAX = 0.03;
  const formAdj = Math.max(-FORM_MAX, Math.min(FORM_MAX, (formA - formB) * FORM_MAX));
  const fatigueAdj = Math.max(-FATIGUE_MAX, Math.min(FATIGUE_MAX, (fatigueB - fatigueA) * FATIGUE_MAX));
  const total = Math.max(-0.06, Math.min(0.06, formAdj + fatigueAdj));
  const factors = [];
  if (Math.abs(formA - formB) >= 0.3)
    factors.push({ key: 'form', text: `${formA > formB ? 'A' : 'B'} in sharper recent form`, weight: Math.abs(formAdj) });
  if (Math.abs(fatigueA - fatigueB) >= 0.3)
    factors.push({ key: 'fatigue', text: `${fatigueA > fatigueB ? 'A' : 'B'} carrying more recent workload`, weight: Math.abs(fatigueAdj) });
  return { adj: Math.round(total * 1e4) / 1e4, factors };
}

export default { formScore, fatigueScore, contextWinAdj };
