// tennisMatchRead.js — assembles the judgment-filtered "match read" for a matchup.
//
// This is the answer to "does all the ATP-page info get incorporated?": the read pulls the
// PREDICTIVE fields (serve/return rates by surface, rank, H2H, recent form) into projections and
// drivers, and deliberately ignores decorative fields (prize money, career titles, weight,
// turned-pro) that add noise without signal — same judgment-strip philosophy as the other sports.

import { projectMatch } from './tennisProjector.js';
import { tennisClassify } from './tennisClassify.js';

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
const r2 = (x) => (x == null ? '—' : Number(x).toFixed(2));

function surfProf(pl, surface) {
  const s = pl?.surfaces || {};
  return { ...(s.ALL || {}), ...(s[surface] || {}), _n: (s[surface]?.n ?? s.ALL?.n ?? 0) };
}

// Build the driver bullets for a given prop, in plain language, from the actual rates used.
function aceDrivers(A, B, surface, proj) {
  return [
    `${A.name}: ${r2(A.p.acePerSvGm)} aces/service game on ${surface} (${A.p._n} matches)`,
    `${B.name} concedes ${r2(B.p.acesFacedPerRetGm)} aces/return game — ${B.p.acesFacedPerRetGm > 0.55 ? 'aceable' : 'hard to ace'}`,
    `adjusted ace rate ${r2(proj.acesA.adjRate)}/svc gm → proj ${proj.acesA.mean.toFixed(1)} aces`,
  ];
}

export function buildMatchRead({
  playerA, playerB, surface = 'Hard', bestOf = 3, eloWinProb = null,
  rankA = null, rankB = null, h2h = null, h2hEdge = 0, recentFormA = null, recentFormB = null,
  recentRetirementA = false, recentRetirementB = false,
  lines = {}, sims = 4000,
} = {}) {
  // Congregate each player's individual-match circumstances from the index's recent block.
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ctxOf = (pl) => {
    const r = pl?.recent; if (!r) return {};
    return {
      formAce: r.formAce || 0, formServe: r.formServe || 0,
      fatigue: clamp01((r.minutesLast10 || 0) / 900),   // ~15h of tennis in 10 days ≈ fully gassed
      surfaceSwitch: r.lastSurface != null && r.lastSurface !== surface,
    };
  };
  const contextA = ctxOf(playerA), contextB = ctxOf(playerB);
  const proj = projectMatch({ playerA, playerB, surface, bestOf, sims, contextA, contextB, h2hEdge, eloWinProb });
  const A = { name: playerA?.name || 'A', p: surfProf(playerA, surface) };
  const B = { name: playerB?.name || 'B', p: surfProf(playerB, surface) };
  const rankGap = (rankA != null && rankB != null) ? Math.abs(rankA - rankB) : null;

  // Helper to classify one over/under prop off the projection's empirical distribution.
  const doProp = (market, arrProj, line, forcedLean, surfaceN, retire) => {
    if (line == null) return null;
    const ou = arrProj(line);
    const lean = forcedLean || (ou.under >= ou.over ? 'UNDER' : 'OVER');
    const prob = Math.min(0.72, lean === 'UNDER' ? ou.under : ou.over); // CS2 display cap
    const verdict = tennisClassify({ market, lean, line, prob, mean: ou.mean,
      surfaceN, rankGap, recentRetirement: retire });
    // variance-aware confidence: tier + how far the projection sits from the line in SDs.
    // When the projection and the market line disagree by a lot, flag it — the market may know
    // something the priors miss (injury, form). Low edgeSds = the line is inside the noise.
    const tier = ou.tier || (prob >= 0.70 ? 'strong' : prob >= 0.62 ? 'lean' : 'coinflip');
    const edgeSds = ou.edgeSds != null ? ou.edgeSds : null;
    const marketGap = (line != null) ? Math.round((ou.mean - line) * 10) / 10 : null;
    const marketDisagrees = (marketGap != null && Math.abs(marketGap) >= 2.5);
    return { market, lean, line, prob, mean: ou.mean, verdict, tier, edgeSds, marketGap, marketDisagrees, stdev: ou.stdev };
  };

  const props = {
    acesA: doProp('aces', proj.acesA.prob, lines.acesA, null, A.p._n, recentRetirementA),
    acesB: doProp('aces', proj.acesB.prob, lines.acesB, null, B.p._n, recentRetirementB),
    dfA: doProp('doubleFaults', proj.dfA.prob, lines.dfA, null, A.p._n, recentRetirementA),
    totalGames: doProp('totalGames', proj.totalGames.prob, lines.totalGames, null,
      Math.min(A.p._n, B.p._n), recentRetirementA || recentRetirementB),
    fantasyA: doProp('fantasy', proj.fantasyA.prob, lines.fantasyA, null, A.p._n, recentRetirementA),
    fantasyB: doProp('fantasy', proj.fantasyB.prob, lines.fantasyB, null, B.p._n, recentRetirementB),
    gamesWonA: doProp('gamesWon', proj.gamesWonA.prob, lines.gamesWonA, null, A.p._n, recentRetirementA),
    gamesWonB: doProp('gamesWon', proj.gamesWonB.prob, lines.gamesWonB, null, B.p._n, recentRetirementB),
    breakPointsWonA: doProp('breakPointsWon', proj.breakPointsWonA.prob, lines.breakPointsWonA, null, A.p._n, recentRetirementA),
    breakPointsWonB: doProp('breakPointsWon', proj.breakPointsWonB.prob, lines.breakPointsWonB, null, B.p._n, recentRetirementB),
    totalTieBreaks: doProp('totalTieBreaks', proj.totalTieBreaks.prob, lines.totalTieBreaks, null, Math.min(A.p._n, B.p._n), recentRetirementA || recentRetirementB),
  };

  // Projected means — always present, so the fantasy score (and the rest) shows even with no line.
  const projected = {
    [A.name]: { aces: proj.acesA.mean, doubleFaults: proj.dfA.mean,
      gamesWon: proj.gamesWonA.mean, fantasy: proj.fantasyA.mean },
    [B.name]: { aces: proj.acesB.mean, doubleFaults: proj.dfB.mean,
      gamesWon: proj.gamesWonB.mean, fantasy: proj.fantasyB.mean },
    totalGames: proj.totalGames.mean,
    fantasyNote: 'PrizePicks scoring confirmed: match +10, game ±1, set ±3, ace +0.5, DF −0.5',
  };

  // Match-outcome context (used by fantasy + as a gate, not sold as a standalone bet by default).
  const favored = proj.winProbA >= 0.5 ? A.name : B.name;
  const winEdge = Math.abs(proj.winProbA - 0.5);

  const describeCtx = (name, ctx) => {
    const parts = [];
    if (ctx.formAce > 0.05) parts.push('serving hot');
    else if (ctx.formAce < -0.05) parts.push('serve cooled off');
    if (ctx.formServe > 0.01) parts.push('form up');
    else if (ctx.formServe < -0.01) parts.push('form down');
    if (ctx.fatigue > 0.5) parts.push(`heavy recent load (${Math.round(ctx.fatigue * 100)}% fatigue)`);
    if (ctx.surfaceSwitch) parts.push('just changed surface');
    return `${name}: ${parts.length ? parts.join(', ') : 'steady, no flags'}`;
  };

  const drivers = {
    aces: props.acesA ? aceDrivers(A, B, surface, proj) : [],
    totalGames: [
      `${A.name} hold ${pct(proj.holdA)} vs ${B.name} hold ${pct(proj.holdB)} on ${surface}`,
      rankGap != null ? `rank gap ${rankGap}${rankGap >= 60 ? ' → rout risk (UNDER context)' : ''}` : 'ranks unknown',
      h2h ? `H2H ${h2h}` : 'no H2H supplied',
      `projected total ${proj.totalGames.mean.toFixed(1)} games`,
    ],
    circumstances: [describeCtx(A.name, contextA), describeCtx(B.name, contextB)],
  };

  // What the read INTENTIONALLY ignores (documented so it's a choice, not an omission).
  const ignored = ['prize money', 'career titles', 'weight', 'turned-pro year', 'doubles record'];

  // Tier disclosure — what the read is actually built on, so a Futures read isn't mistaken for a
  // tour read. Baselines are measured from real completed Bo3 matches (2023-24), not assumed:
  //   ITF Futures  mean 21.35 games, 29.0% 3-set, 23.5% w/ tiebreak
  //   Challenger   mean 22.57 games, 34.3% 3-set, 30.5% w/ tiebreak
  //   ATP Tour     mean 23.49 games, 36.0% 3-set, 38.5% w/ tiebreak
  // Note ITF runs SHORTER than tour (big early-round skill gaps → blowouts), the opposite of the
  // common assumption that lower-tier matches grind long.
  const coldA = playerA?._coldStart, coldB = playerB?._coldStart;
  const disclaimer = (coldA || coldB)
    ? `Off-index player${coldA && coldB ? 's' : ''} (${[coldA ? A.name : null, coldB ? B.name : null].filter(Boolean).join(', ')}) — profile built from ~${playerA?._sampleMatches || playerB?._sampleMatches || 10} recent matches via live feed, not deep history. Lower-tier fields (ITF/Challenger) are less predictable and this read carries a wider error bar. For reference, real ITF Bo3 averages 21.4 games (29% go 3 sets) vs 23.5 on tour — lower tiers run SHORTER, not longer.`
    : null;

  // Total games & games-won lean on BOTH players' serve profiles. If either is thin (few matches),
  // the profile defaults toward average and totals cluster at ~22.5 with false precision — exactly
  // the Hibino/Costoulas blowups (2 and 23 matches → projected 22 → actual 35). Flag it so the UI
  // can fade the totals read instead of trusting it.
  const nA = (playerA.surfaces?.ALL?.n) || 0, nB = (playerB.surfaces?.ALL?.n) || 0;
  const thinTotals = Math.min(nA, nB) < 50;
  // Match-flow explanation: how the match is likely to PLAY OUT, in plain language, from the sim's
  // win prob, hold rates, decider probability, and projected total games. Plus a close-game flag.
  const favLast = favored.split(' ').pop();
  const dogLast = (favored === A.name ? B.name : A.name).split(' ').pop();
  const decider = proj.deciderProb != null ? proj.deciderProb : null;
  const totG = (proj.totalGames && proj.totalGames.mean) || null;
  const hFav = favored === A.name ? proj.holdA : proj.holdB;
  const hDog = favored === A.name ? proj.holdB : proj.holdA;
  // close game when the winner is genuinely in doubt OR a deciding set is more likely than not
  const closeGame = winEdge < 0.12 || (decider != null && decider >= 0.50);
  let matchFlow;
  if (winEdge < 0.08) {
    matchFlow = `Near coin-flip. ${favLast} and ${dogLast} are separated by a hair — expect it to come down to a few points, and don't be surprised by either winner.`;
  } else if (closeGame) {
    matchFlow = `${favLast} is favored but ${dogLast} should hang around — ${decider != null ? Math.round(decider * 100) + '% chance it goes the distance' : 'a deciding set is live'}. Competitive throughout rather than a rout.`;
  } else if (winEdge >= 0.30) {
    matchFlow = `${favLast} is a heavy favorite and should close it out in straight sets. ${dogLast} would need something to go wrong for the favorite to keep it interesting.`;
  } else {
    matchFlow = `${favLast} is the clear pick but not a lock — ${dogLast} can take a set. Lean ${favLast}, but a three-setter is on the table.`;
  }
  // serve texture: both holding well → long/tight; both breakable → swingy
  if (hFav != null && hDog != null) {
    if (hFav >= 0.78 && hDog >= 0.75) matchFlow += ` Both hold serve well, so expect tight sets and maybe a tiebreak — games could run high.`;
    else if (hFav < 0.68 && hDog < 0.68) matchFlow += ` Neither holds serve reliably, so expect breaks both ways and a lower game count.`;
  }

  return {
    matchup: `${A.name} vs ${B.name}`, surface, bestOf,
    thinTotals, sampleA: nA, sampleB: nB,
    tier: (coldA || coldB) ? 'off-index (ITF/Challenger/new)' : 'indexed',
    disclaimer,
    matchFlow, closeGame, deciderProb: decider,
    tiebreakProb: proj.tiebreakProb != null ? proj.tiebreakProb : null,
    expTiebreaks: proj.expTiebreaks != null ? proj.expTiebreaks : null,
    // one label a bettor can act on: how likely the match drags long (3-set and/or tiebreaks)
    matchShape: (function(){
      const d = proj.deciderProb || 0, tb = proj.tiebreakProb || 0;
      if (tb >= 0.6) return { key:'tb', text:`Tiebreak likely (${Math.round(tb*100)}%) — big-serving matchup, games run high`, pushesOver:true };
      if (d >= 0.55) return { key:'3set', text:`Third set more likely than not (${Math.round(d*100)}%) — lean toward the over on games`, pushesOver:true };
      if (d <= 0.30 && tb <= 0.25) return { key:'clean', text:`Should be clean — ${Math.round((1-d)*100)}% straight sets, tiebreak unlikely (${Math.round(tb*100)}%)`, pushesOver:false };
      return { key:'even', text:`${Math.round(d*100)}% chance of a third set, ${Math.round(tb*100)}% of a tiebreak`, pushesOver:false };
    })(),
    winProb: { [A.name]: proj.winProbA, [B.name]: proj.winProbB, favored, edge: winEdge },
    holds: { [A.name]: proj.holdA, [B.name]: proj.holdB },
    circumstances: { [A.name]: contextA, [B.name]: contextB, h2hEdge },
    props, drivers, projected,
    // BEST PLAY: rank this match's props by winnability, not just confidence. Fantasy is the
    // proven market (4/4 in live testing); total-games is coin-flip (±5.8 variance); games-won is
    // now bias-corrected. Score = market reliability × confidence tier × variance edge. Only props
    // that clear a real bar surface as a 'best play' — most matches have none, and that's honest.
    bestPlay: (function () {
      const MARKET_WEIGHT = { fantasyA: 1.0, fantasyB: 1.0, totalGames: 0.55, gamesWonA: 0.7, gamesWonB: 0.7, acesA: 0.5, acesB: 0.5, dfA: 0.4 };
      let best = null;
      for (const [k, pr] of Object.entries(props || {})) {
        if (!pr || pr.line == null || pr.prob == null) continue;
        const mw = MARKET_WEIGHT[k] || 0.4;
        const tierMul = pr.tier === 'strong' ? 1.0 : pr.tier === 'lean' ? 0.6 : 0.25;
        const edge = pr.edgeSds != null ? Math.min(1, pr.edgeSds) : 0.3;
        const score = mw * tierMul * (0.5 + edge);        // 0..~1.5
        if (!best || score > best.score) best = { market: k, lean: pr.lean, line: pr.line, prob: pr.prob, tier: pr.tier, score: Math.round(score * 100) / 100 };
      }
      // only call it a 'best play' if it clears the bar — fantasy strong, or any strong-tier edge
      if (best && best.score >= 0.62) {
        best.label = best.market.startsWith('fantasy') ? 'Best play — fantasy is the model\'s strongest market'
          : best.tier === 'strong' ? 'Best play — line sits outside the variance'
          : 'Best available, but modest';
        best.recommend = best.score >= 0.62;
      } else if (best) { best.label = 'No strong play here — all props are inside the noise'; best.recommend = false; }
      return best;
    })(),
    gates: {
      thinSampleA: A.p._n < 20, thinSampleB: B.p._n < 20,
      retirementA: recentRetirementA, retirementB: recentRetirementB,
      blowout: rankGap != null && rankGap >= 60,
    },
    usesFields: ['serve rates by surface', 'return rates by surface', 'aces-faced', 'rank', 'H2H', 'recent form/retirement'],
    ignoresFields: ignored,
    note: 'All props return bet:false — priors only until a real slate is graded.',
  };
}

export default { buildMatchRead };
