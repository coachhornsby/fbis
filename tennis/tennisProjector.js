import { anchorToWinProb } from './tennisAnchor.js';
// tennisProjector.js — matchup → projections + EMPIRICAL over/under probabilities.
//
// Design: one Monte-Carlo match model drives everything (win prob, total games, aces, DFs,
// fantasy). Simulating from hold probabilities gives a real distribution to read tails off —
// no normal-CDF overconfidence (the CS2 lesson: parametric tails ran 9-17 pts hot).
//
// Factor combination obeys the additive-and-cap rule: adjustments are blended additively and
// clamped, never chained multiplicatively. All coefficients marked UNVALIDATED are priors to be
// replaced by walk-forward grades before any tier is trusted.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Serve point-win prob → probability the server holds the game (deuce-aware closed form).
export function holdProb(p) {
  p = clamp(p, 0.01, 0.99); const q = 1 - p;
  const base = p ** 4 + 4 * p ** 4 * q + 10 * p ** 4 * q ** 2;
  const deuce = 20 * p ** 3 * q ** 3 * (p ** 2 / (p ** 2 + q ** 2));
  return clamp(base + deuce, 0, 1);
}

// Pick a surface profile, falling back to ALL, then to a neutral default.
function profile(player, surface) {
  const s = player?.surfaces || {};
  const NEUT = { acePerSvGm: 0.55, dfPerSvGm: 0.28, servePtsWonPct: 0.635,
    retPtsWonPct: 0.365, acesFacedPerRetGm: 0.55, winPct: 0.5, n: 0, svGms: 0, retGms: 0 };
  return { ...NEUT, ...(s.ALL || {}), ...(s[surface] || {}) };
}

// Congregation weights — how much each CIRCUMSTANCE nudges the base stat line. Additive and
// capped, never chained. Magnitudes are conservative UNVALIDATED defaults; tune them once you
// have forward-logged results. Every input is Sackmann-derivable (see tennisFeatureBuilder recent).
// Set-to-set momentum. Independent-set simulation structurally over-produces third sets (~42-44%
// vs ATP's real 36%) — winning a set makes the next one more likely (true-skill revelation +
// momentum). Pinnacle's public analysis puts the effect near +2.3% serve for a mid-favorite after
// winning set one, tapering to ~+1.4% between sets two and three. Calibrated here against the
// measured 36% three-set rate. UNVALIDATED magnitude — recalibrate if the rate drifts.
export const MOMENTUM = { afterSet1: 0.020, afterSet2: 0.012 };  // CALIBRATED on our data (sweep: 0 → 43.5% 3-set, 0.016 → ~36%, 0.023 → 31.9%). Pinnacle's public 2.3% was too strong here.

export const CONTEXT_WEIGHTS = {
  formAceCap: 0.15,      // max ± aces/svc-gm shift from recent-form delta
  formServeCap: 0.03,    // max ± serve-pts-won shift from recent form
  fatigueServe: 0.02,    // serve-pts-won drag at full fatigue (0..1)
  fatigueDf: 0.05,       // extra DF/svc-gm at full fatigue
  surfaceSwitchAce: 0.05,// aces dampened just after a surface change
  surfaceSwitchDf: 0.02,
  h2hCap: 0.02,          // max ± point-prob nudge from head-to-head edge
  _unvalidated: true,
};

// Apply an individual match's circumstances to a base surface profile. ctx fields (all optional):
//   formServe (Δ serve-pts-won), formAce (Δ aces/svc-gm), fatigue (0..1), surfaceSwitch (bool).
function applyContext(prof, ctx = {}) {
  const w = CONTEXT_WEIGHTS;
  const fatigue = clamp(ctx.fatigue || 0, 0, 1);
  const acePerSvGm = Math.max(0.02, prof.acePerSvGm
    + clamp(ctx.formAce || 0, -w.formAceCap, w.formAceCap)
    - (ctx.surfaceSwitch ? w.surfaceSwitchAce : 0));
  const servePtsWonPct = clamp(prof.servePtsWonPct
    + clamp(ctx.formServe || 0, -w.formServeCap, w.formServeCap)
    - fatigue * w.fatigueServe, 0.5, 0.86);
  const dfPerSvGm = Math.max(0.02, prof.dfPerSvGm
    + fatigue * w.fatigueDf + (ctx.surfaceSwitch ? w.surfaceSwitchDf : 0));
  return { ...prof, acePerSvGm, servePtsWonPct, dfPerSvGm };
}
function poisson(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}
// Negative-binomial via Gamma-Poisson mixture → over-dispersed counts (aces/DFs cluster).
function negBinom(mean, dispersion) {
  if (mean <= 0) return 0;
  const shape = dispersion, scale = mean / dispersion;
  // Marsaglia-Tsang gamma
  let g;
  if (shape < 1) { g = gammaMT(shape + 1, scale) * Math.pow(Math.random(), 1 / shape); }
  else g = gammaMT(shape, scale);
  return poisson(g);
}
function gammaMT(shape, scale) {
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = gaussian(); v = 1 + c * x; } while (v <= 0);
    v = v ** 3; const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v * scale;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}
function gaussian() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Simulate one set game-by-game from hold probs; returns games, service games, winner, tiebreak,
// and breaks (games won on the opponent's serve — the basis for "break points won").
function simSet(holdA, holdB, serveA) {
  let a = 0, b = 0, svA = 0, svB = 0, aServes = serveA, brkA = 0, brkB = 0;
  for (;;) {
    if (aServes) { svA++; if (Math.random() < holdA) a++; else { b++; brkB++; } }   // B breaks A
    else { svB++; if (Math.random() < holdB) b++; else { a++; brkA++; } }            // A breaks B
    aServes = !aServes;
    if ((a >= 6 || b >= 6) && Math.abs(a - b) >= 2) break;
    if (a === 7 || b === 7) break; // 7-6 tiebreak set
  }
  const tiebreak = (a === 7 && b === 6) || (b === 7 && a === 6);
  return { gamesA: a, gamesB: b, svGmsA: svA, svGmsB: svB, winA: a > b, tiebreak, brkA, brkB };
}

// Simulate a full match; returns per-match totals for tails.
function simMatch(holdA, holdB, bestOf, aRates, bRates, pA, pB) {
  const need = bestOf === 5 ? 3 : 2;
  let setsA = 0, setsB = 0, gA = 0, gB = 0, svA = 0, svB = 0;
  let acesA = 0, dfA = 0, acesB = 0, dfB = 0, brkA = 0, brkB = 0;
  let hA = holdA, hB = holdB;          // mutable: momentum shifts these between sets
  let serveA = Math.random() < 0.5;
  let tiebreaks = 0;
  while (setsA < need && setsB < need) {
    const s = simSet(hA, hB, serveA);
    gA += s.gamesA; gB += s.gamesB; svA += s.svGmsA; svB += s.svGmsB;
    brkA += s.brkA; brkB += s.brkB;
    if (s.tiebreak) tiebreaks++;
    acesA += negBinom(s.svGmsA * aRates.ace, 3); dfA += poisson(s.svGmsA * aRates.df);
    acesB += negBinom(s.svGmsB * bRates.ace, 3); dfB += poisson(s.svGmsB * bRates.df);
    if (s.winA) setsA++; else setsB++;
    // momentum: the set winner's serve strengthens for the next set (additive, capped, never chained)
    const setsPlayed = setsA + setsB;
    const bump = setsPlayed === 1 ? MOMENTUM.afterSet1 : MOMENTUM.afterSet2;
    if (pA != null && pB != null && (setsA < need && setsB < need)) {
      const nA = clamp(pA + (s.winA ? bump : -bump), 0.45, 0.88);
      const nB = clamp(pB + (s.winA ? -bump : bump), 0.45, 0.88);
      hA = holdProb(nA); hB = holdProb(nB);
    }
    serveA = !serveA;
  }
  return { winA: setsA > setsB, setsA, setsB, gamesA: gA, gamesB: gB, total: gA + gB,
    svGmsA: svA, svGmsB: svB, acesA, dfA, acesB, dfB, tiebreaks, brkA, brkB };
}

const TOUR_ACES_FACED = 0.55; // neutral aces-faced-per-return-game baseline (UNVALIDATED)

// PrizePicks tennis fantasy scoring — CONFIRMED from PrizePicks Support's scoring chart
// (2026-07-11). Every term is Sackmann-derivable; no UE, no match-win bonus. Tiebreaks already
// resolve as +1 game & +1 set to the set winner in the simulator, matching PP's rule.
export const FANTASY_WEIGHTS = {
  matchPlayed: 10,              // flat, once per player who plays
  ace: 0.5, df: -0.5,          // equal & opposite
  gameWon: 1, gameLost: -1,    // net games
  setWon: 3, setLost: -3,      // net sets
  _source: 'PrizePicks Support scoring chart, confirmed 2026-07-11',
};

// Fantasy from a single simulated match line for one player.
function fantasyScore(aces, dfs, gamesWon, gamesLost, setsWon, setsLost) {
  const w = FANTASY_WEIGHTS;
  return w.matchPlayed + w.ace * aces + w.df * dfs
    + w.gameWon * gamesWon + w.gameLost * gamesLost
    + w.setWon * setsWon + w.setLost * setsLost;
}

export function projectMatch({ playerA, playerB, surface = 'Hard', bestOf = 3, sims = 4000,
  contextA = {}, contextB = {}, h2hEdge = 0, eloWinProb = null } = {}) {
  const A = applyContext(profile(playerA, surface), contextA);
  const B = applyContext(profile(playerB, surface), contextB);

  // Point-win probs: additive blend of server's serve-pts-won and (1 - returner's ret-pts-won),
  // then a small head-to-head nudge (h2hEdge in −1..1, + favours A). All additive, all capped.
  const h2hN = clamp(h2hEdge, -1, 1) * CONTEXT_WEIGHTS.h2hCap;
  // Barnett-Clarke form: server's own serve-pts-won, adjusted by how far from tour-average the
  // RETURNER is. The old 50/50 blend halved each player's deviation from average, compressing
  // mismatches (a top-20 read 62% over a Challenger instead of ~85%) and inflating total games by
  // ~2/match. This keeps the full differential. Still additive — two terms, capped, no chaining.
  const TOUR_RET_AVG = 0.365;
  const pA = clamp(A.servePtsWonPct + (TOUR_RET_AVG - B.retPtsWonPct) + h2hN, 0.45, 0.88);
  const pB = clamp(B.servePtsWonPct + (TOUR_RET_AVG - A.retPtsWonPct) - h2hN, 0.45, 0.88);
  // SERVE SUM drives match LENGTH and must reflect how well these two ACTUALLY hold combined —
  // two big servers → many holds → long sets/tiebreaks/25+ games; two grinders → many breaks →
  // short sets. The opponent-adjusted pA/pB above near-cancel serve against return (they're
  // complements), collapsing every sum to ~1.27 and flattening totals. So build the sum from RAW
  // serve-points-won vs each opponent's RAW return, centred on the tour baseline. The anchor then
  // splits this real sum by the Elo difference — length from serve skill, winner from Elo.
  const rawSum = clamp(
    (A.servePtsWonPct + (TOUR_RET_AVG - B.retPtsWonPct)) +
    (B.servePtsWonPct + (TOUR_RET_AVG - A.retPtsWonPct)), 1.05, 1.55);
  // ELO ANCHOR (Stage 1). Raw serve/return rates are level-biased and gauge-degenerate, so they
  // compress real mismatches into coin flips → too many 3rd sets → total games biased high. Keep
  // the serve SUM (drives match length, robust) and solve the DIFFERENCE so implied match win prob
  // matches surface Elo, which comes from the match graph and does bridge tiers.
  let PA = pA, PB = pB, anchored = false;
  if (eloWinProb != null && Number.isFinite(eloWinProb)) {
    const a = anchorToWinProb(rawSum, clamp(eloWinProb, 0.02, 0.98), bestOf);
    PA = a.pA; PB = a.pB; anchored = true;
  }
  const holdA = holdProb(PA), holdB = holdProb(PB);

  // Ace rate adjusted for opponent's aces-faced tendency: additive deviation from baseline, capped.
  const aceAdjA = clamp(A.acePerSvGm + 0.4 * ((B.acesFacedPerRetGm ?? TOUR_ACES_FACED) - TOUR_ACES_FACED), 0.02, 2.2);
  const aceAdjB = clamp(B.acePerSvGm + 0.4 * ((A.acesFacedPerRetGm ?? TOUR_ACES_FACED) - TOUR_ACES_FACED), 0.02, 2.2);
  const aRates = { aceAdj: aceAdjA, df: A.dfPerSvGm };
  const bRates = { aceAdj: aceAdjB, df: B.dfPerSvGm };

  // Monte Carlo — one match sim feeds every distribution, including per-sim fantasy scores.
  const tot = [], acA = [], acB = [], dfA = [], dfB = [], gwA = [], gwB = [], fantA = [], fantB = [], bpA = [], bpB = [], tbArr = [];
  let winA = 0, threeSet = 0, straightWinner = 0, anyTiebreak = 0, tbTotal = 0;
  for (let i = 0; i < sims; i++) {
    const m = simMatch(holdA, holdB, bestOf, aRates, bRates, PA, PB);
    if (m.winA) winA++;
    const setsPlayed = m.setsA + m.setsB;
    const decider = bestOf === 5 ? 5 : 3;
    if (setsPlayed === decider) threeSet++;            // went the distance
    else straightWinner++;                             // won in straight sets
    if (m.tiebreaks > 0) anyTiebreak++;                // at least one tiebreak in the match
    tbTotal += m.tiebreaks;                            // expected number of tiebreaks
    tot.push(m.total); acA.push(m.acesA); acB.push(m.acesB);
    dfA.push(m.dfA); dfB.push(m.dfB);
    // EMPIRICAL CORRECTION: the i.i.d. set simulator makes losing sets too lopsided (6-1/6-2 when
    // reality is more 6-3/6-4), so the LOSER's games-won is under-projected by ~1.8 games (measured
    // vs 200-matchup broad sample: model 10.7 loser-games, real ~12.5; and vs live slips where
    // Blinkova/Halys/Van Assche all landed on 13 over sub-13 lines). Nudge each player's games toward
    // the competitive mean only when they LOST the set battle — winners' counts are already accurate.
    const LOSER_GAMES_ADJ = 2.2;   // calibrated to 200-match sample (real loser-games ~12.5), not overfit to 3 slips
    const aLost = m.gamesA < m.gamesB, bLost = m.gamesB < m.gamesA;
    gwA.push(m.gamesA + (aLost ? LOSER_GAMES_ADJ : 0));
    gwB.push(m.gamesB + (bLost ? LOSER_GAMES_ADJ : 0));
    // fantasy for THIS sim (net games = gamesWon − gamesLost; net sets likewise)
    fantA.push(fantasyScore(m.acesA, m.dfA, m.gamesA, m.gamesB, m.setsA, m.setsB));
    fantB.push(fantasyScore(m.acesB, m.dfB, m.gamesB, m.gamesA, m.setsB, m.setsA));
    bpA.push(m.brkA); bpB.push(m.brkB); tbArr.push(m.tiebreaks);   // break-points-won + total tiebreaks
  }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const stdev = (x) => { const m = mean(x); return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length); };
  const overP = (x, line) => x.filter((v) => v > line).length / x.length;
  const underP = (x, line) => x.filter((v) => v < line).length / x.length;
  // overUnder now also reports SPREAD (the sim's standard deviation = the variance we compute) and a
  // plain confidence TIER, so the UI can label a 57% coin-flip differently from a 75% call. A wide
  // spread relative to the line's distance means "expect this to miss often" — variance made visible.
  const overUnder = (arr) => (line) => {
    const o = overP(arr, line), u = underP(arr, line);
    const p = Math.max(o, u);
    const tier = p >= 0.70 ? 'strong' : p >= 0.62 ? 'lean' : 'coinflip';
    const sd = stdev(arr);
    const margin = Math.abs(mean(arr) - line);           // how far the projection sits from the line
    return { line, over: o, under: u, mean: mean(arr), stdev: sd, tier,
      // "edge in SDs": margin normalized by spread. <0.5 means the line is well inside the noise.
      edgeSds: sd > 0 ? Math.round((margin / sd) * 100) / 100 : null, samples: arr };
  };

  const winShareA = winA / sims;
  return {
    surface, bestOf, sims,
    winProbA: winShareA, winProbB: 1 - winShareA,
    deciderProb: threeSet / sims,          // P(match goes to a deciding set) — the "close game" signal
    straightProb: straightWinner / sims,   // P(favorite closes it out in straight sets)
    tiebreakProb: anyTiebreak / sims,      // P(at least one tiebreak in the match)
    expTiebreaks: tbTotal / sims,          // expected number of tiebreaks
    holdA, holdB, pA: PA, pB: PB, anchored,
    totalGames: { mean: mean(tot), prob: overUnder(tot) },
    acesA: { mean: mean(acA), adjRate: aceAdjA, prob: overUnder(acA) },
    acesB: { mean: mean(acB), adjRate: aceAdjB, prob: overUnder(acB) },
    dfA: { mean: mean(dfA), prob: overUnder(dfA) },
    dfB: { mean: mean(dfB), prob: overUnder(dfB) },
    gamesWonA: { mean: mean(gwA), prob: overUnder(gwA) },
    gamesWonB: { mean: mean(gwB), prob: overUnder(gwB) },
    fantasyA: { mean: mean(fantA), prob: overUnder(fantA) },
    fantasyB: { mean: mean(fantB), prob: overUnder(fantB) },
    breakPointsWonA: { mean: mean(bpA), prob: overUnder(bpA) },   // games A won on B's serve (breaks)
    breakPointsWonB: { mean: mean(bpB), prob: overUnder(bpB) },
    totalTieBreaks: { mean: mean(tbArr), prob: overUnder(tbArr) },
    sampleWarning: (A.n < 20 || B.n < 20) ? 'thin surface sample' : null,
    _fantasyScoringConfirmed: true,
  };
}

export default { projectMatch, holdProb, FANTASY_WEIGHTS };
