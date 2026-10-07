// tennisNarrative.js — turn a match read into the plain-language, evidence-backed "tug-of-war".
// Design: show WHO's favored, BY HOW MUCH, WHAT drives it (weighted, with the number next to each
// label), WHAT could flip it, and the HONEST confidence banner. Every number traces to the index —
// nothing decorative. Weights: '++' biggest factor, '+' supporting, '!' thin/low-confidence.

const pct = (x) => Math.round(x * 100);
const winRate = (p, surf) => {
  const s = p.surfaces?.[surf]; const a = p.surfaces?.ALL;
  const use = (s && s.n >= 20) ? s : a;
  return use && use.winPct != null ? { v: use.winPct, n: use.n, onSurface: use === s } : null;
};

// Build the weighted factor list. Each: {label, detail, dir:'A'|'B', weight:'++'|'+'|'!'}
function factors(A, B, surface, favKey) {
  const favIsA = favKey === A.name;
  const fav = favIsA ? A : B, dog = favIsA ? B : A;
  const out = [];

  // 1. Surface win% — usually the biggest intuitive factor
  const fw = winRate(fav, surface), dw = winRate(dog, surface);
  if (fw && dw) {
    const gap = fw.v - dw.v;
    out.push({
      key: 'surface',
      label: `${surface} record`,
      detail: `${pct(fw.v)}% career win rate on ${surface.toLowerCase()} vs ${pct(dw.v)}%`,
      dir: 'fav', edge: gap,
      weight: Math.abs(gap) >= 0.10 ? '++' : Math.abs(gap) >= 0.04 ? '+' : '!',
      thin: Math.min(fw.n, dw.n) < 20,
    });
  }

  // 2. Ranking gap
  if (fav.rank && dog.rank) {
    const spots = Math.abs(fav.rank - dog.rank);
    const favBetter = fav.rank < dog.rank;
    out.push({
      key: 'rank',
      label: 'Ranking gap',
      detail: `#${fav.rank} vs #${dog.rank} — ${spots} spot${spots === 1 ? '' : 's'}`,
      dir: favBetter ? 'fav' : 'dog', edge: (favBetter ? 1 : -1) * Math.min(spots / 100, 1),
      weight: spots >= 60 ? '++' : spots >= 20 ? '+' : '!',
      thin: false,
    });
  }

  // 3. Elo (skill rating from the match graph) — the model's actual anchor
  if (fav.elo && dog.elo) {
    const d = fav.elo - dog.elo;
    out.push({
      key: 'elo',
      label: 'Skill rating (Elo)',
      detail: `${Math.round(fav.elo)} vs ${Math.round(dog.elo)}${d > 0 ? ` — ${Math.round(d)} point edge` : ''}`,
      dir: d >= 0 ? 'fav' : 'dog', edge: Math.max(-1, Math.min(1, d / 200)),
      weight: Math.abs(d) >= 150 ? '++' : Math.abs(d) >= 50 ? '+' : '!',
      thin: (fav.eloN || 0) < 20 || (dog.eloN || 0) < 20,
    });
  }

  // 4. Recent form (last-10) — only if we actually have it
  const fform = fav.recent?.matchesLast10, dform = dog.recent?.matchesLast10;
  if (typeof fform === 'number' && typeof dform === 'number' && (fform || dform)) {
    out.push({
      key: 'form',
      label: 'Recent activity',
      detail: `${fav.name.split(' ').pop()} ${fform} matches in last 10 days; ${dog.name.split(' ').pop()} ${dform}`,
      dir: 'fav', edge: 0,
      weight: '!', thin: true,
    });
  }

  // rank factors by |edge|; the top supporting-or-better factor becomes '++', rest cascade
  out.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  return out;
}

// The "what could flip it" case — always present, drawn from real signals.
function flipRisk(A, B, surface, factorList, thinAny) {
  const risks = [];
  const surfF = factorList.find((f) => f.key === 'surface');
  const rankF = factorList.find((f) => f.key === 'rank');
  if (rankF && rankF.weight === '++' && !(surfF && surfF.weight === '++')) {
    risks.push('The lean rests mostly on ranking — the category upsets happen against.');
  }
  if (thinAny) {
    risks.push('One player has a thin record on this surface, so the model is extrapolating — real matches can diverge.');
  }
  const clayGrind = surface === 'Clay';
  if (clayGrind) risks.push('Clay rewards grinders who drag favorites into long three-setters — live totals can run over.');
  if (!risks.length) risks.push('Close skill gap — a single break of serve swings the match, so treat the lean as soft.');
  return risks.slice(0, 3);
}

/**
 * Build the full narrative object the card renders.
 */
export function buildNarrative(read, A, B) {
  const favKey = read.winProb.favored;
  const favPct = pct(read.winProb[favKey]);
  const favLast = favKey.split(' ').pop();
  const fs = factors(A, B, read.surface, favKey);
  // cascade weights: strongest is ++, then + for the rest of the real ones, ! stays !
  let promoted = false;
  for (const f of fs) { if (f.weight !== '!' && !promoted) { f.weight = '++'; promoted = true; } else if (f.weight === '++') f.weight = '+'; }
  const thinAny = fs.some((f) => f.thin);

  // one-sentence headline: who, how much, and the single biggest driver in plain words
  const big = fs.find((f) => f.weight === '++') || fs[0];
  const driverPhrase = big ? ({
    surface: `the far better ${read.surface.toLowerCase()} player`,
    rank: 'ranked well above the opponent',
    elo: 'clearly stronger by the skill ratings',
    form: 'in much better recent form',
  })[big.key] || 'the stronger profile on paper' : 'the stronger profile on paper';

  return {
    matchup: read.matchup,
    context: [read.surface, read.tournament, read.tourLabel].filter(Boolean).join(' · '),
    favored: favKey, favLast, favPct,
    headline: `${favLast} favored ${favPct}% — mostly ${driverPhrase}.`,
    barFill: favPct,
    factors: fs.map((f) => ({ label: f.label, detail: f.detail, weight: f.weight })),
    flip: flipRisk(A, B, read.surface, fs, thinAny),
    // the honesty banner — upgrades itself when a bucket clears (graded passed in from the log)
    priorsOnly: !(read.graded && read.graded.tier),
    gradedLabel: read.graded && read.graded.tier
      ? `${read.graded.tier}: ${pct(read.graded.rate)}% on n=${read.graded.n} ✓ tracked edge`
      : 'Priors read, not a tracked edge yet — logging every match to see if it earns trust.',
    tier: read.tier,
  };
}

export default { buildNarrative };
