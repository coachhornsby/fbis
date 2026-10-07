// tennisBacktest.js — edge DISCOVERY on historical matches. This is what turns PRIOR labels into
// graded tiers: it splits history into train/test, and for each candidate SIGNAL measures how often
// the actual outcome landed on the predicted side of the player's own baseline — with real n and a
// Wilson lower bound. Signals whose Wilson LB clears 52.4% are real edges you can promote.
//
// HONEST SCOPE: baseline = the player's train-period average (books price near recent averages, so
// this is a strong proxy). It is NOT the real PrizePicks line — confirm promoted signals against a
// live line log before betting. No lookahead: baselines come only from matches BEFORE the split.
//
// Run: node tennisBacktest.js ./data/tennis 2024-01-01

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildRowsFromCsv } from './tennisFeed.js';

const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];
export function wilsonLo(w, n, z = 1.96) {
  if (!n) return 0;
  const p = w / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
// Real prop lines are always X.5 (no pushes). Snap the naive baseline the same way so the backtest
// mirrors how a line actually sits — otherwise integer stats vs a whole-number line bias the result.
const snapLine = (x) => { if (x == null) return null; let L = Math.round(x * 2) / 2; if (Number.isInteger(L)) L += (x >= L ? 0.5 : -0.5); return L; };

// Build per-player train baselines (per surface + overall), plus opponent return baselines.
function trainBaselines(trainRows) {
  const P = new Map();
  for (const r of trainRows) {
    if (!r.hasStats || r.svGms == null) continue;
    if (!P.has(r.playerId)) P.set(r.playerId, { name: r.playerName, all: [], bySurf: {}, ret: [], rank: r.playerRank });
    const p = P.get(r.playerId);
    if (r.playerRank != null) p.rank = r.playerRank;
    const acePg = r.ace / r.svGms, dfPg = r.df / r.svGms;
    const rec = { acePg, dfPg, aces: r.ace, dfs: r.df, svGms: r.svGms };
    p.all.push(rec);
    (p.bySurf[r.surface] ||= []).push(rec);
    if (r.oppSvGms) p.ret.push((r.oppSvpt - (r.oppFirstWon + r.oppSecondWon)) / r.oppSvpt); // return-pts-won rate
  }
  const out = new Map();
  for (const [id, p] of P) {
    const surfAce = {}, surfDf = {}, surfSvGms = {};
    for (const s of SURFACES) {
      const rows = p.bySurf[s] || [];
      surfAce[s] = mean(rows.map((x) => x.acePg));
      surfDf[s] = mean(rows.map((x) => x.dfPg));
      surfSvGms[s] = mean(rows.map((x) => x.svGms));
    }
    out.set(id, { name: p.name, rank: p.rank, n: p.all.length,
      acePg: mean(p.all.map((x) => x.acePg)), dfPg: mean(p.all.map((x) => x.dfPg)),
      svGms: mean(p.all.map((x) => x.svGms)), retPct: mean(p.ret),
      surfAce, surfDf, surfSvGms });
  }
  return out;
}

// The candidate signals to test. Each returns whether it fires for a test match, and scores a hit.
// Add your own hypotheses here — this list IS the edge-search space.
function signals() {
  const under = (actual, baseline) => actual < baseline;
  const over = (actual, baseline) => actual > baseline;
  return [
    { name: 'Aces UNDER — ANY (base rate)', base: 'acesUnder',
      fires: (f) => f.baseAces != null, hit: (f) => under(f.actAces, f.baseAces) },
    { name: 'Aces UNDER — clay',
      fires: (f) => f.surface === 'Clay' && f.baseAces != null,
      hit: (f) => under(f.actAces, f.baseAces) },
    { name: 'Aces UNDER — clay + strong-return opponent',
      fires: (f) => f.surface === 'Clay' && f.oppRetPct != null && f.oppRetPct > 0.40 && f.baseAces != null,
      hit: (f) => under(f.actAces, f.baseAces) },
    { name: 'Aces OVER — grass/fast, low-return opponent',
      fires: (f) => (f.surface === 'Grass') && f.oppRetPct != null && f.oppRetPct < 0.36 && f.baseAces != null,
      hit: (f) => over(f.actAces, f.baseAces) },
    { name: 'Total games UNDER — rank gap ≥ 60',
      fires: (f) => f.rankGap != null && f.rankGap >= 60 && f.medTotal != null,
      hit: (f) => f.totalGames < f.medTotal, once: true },
    { name: 'Total games UNDER — rank gap ≥ 120',
      fires: (f) => f.rankGap != null && f.rankGap >= 120 && f.medTotal != null,
      hit: (f) => f.totalGames < f.medTotal, once: true },
    { name: 'Double faults UNDER — baseline',
      fires: (f) => f.baseDf != null,
      hit: (f) => under(f.actDf, f.baseDf) },
  ];
}

export function backtest(trainRows, testRows) {
  const base = trainBaselines(trainRows);
  const medTotal = (() => { const t = trainRows.map((r) => r.totalGames).filter((v) => v > 0).sort((a, b) => a - b);
    return t.length ? t[Math.floor(t.length / 2)] : null; })();

  const sigs = signals();
  const tally = sigs.map((s) => ({ name: s.name, n: 0, hits: 0 }));
  const seenMatch = new Set(); // for 'once' (match-level, not per-side) signals

  for (const r of testRows) {
    if (!r.hasStats || r.svGms == null) continue;
    const bp = base.get(r.playerId), bo = base.get(r.oppId);
    if (!bp) continue;
    const surf = r.surface;
    const f = {
      surface: surf,
      actAces: r.ace, actDf: r.df, totalGames: r.totalGames,
      baseAces: snapLine((bp.acePg != null && bp.svGms) ? bp.acePg * r.svGms : null),   // naive line, snapped to .5
      baseDf: snapLine((bp.dfPg != null) ? bp.dfPg * r.svGms : null),
      oppRetPct: bo ? bo.retPct : null,
      rankGap: (bp.rank != null && bo && bo.rank != null) ? Math.abs(bp.rank - bo.rank) : null,
      medTotal,
    };
    sigs.forEach((s, i) => {
      if (!s.fires(f)) return;
      if (s.once) { const key = `${s.name}|${r.date}|${r.tourney}|${[r.playerId, r.oppId].sort().join('-')}`;
        if (seenMatch.has(key)) return; seenMatch.add(key); }
      tally[i].n++; if (s.hit(f)) tally[i].hits++;
    });
  }

  const raw = tally.map((t) => ({ ...t, rate: t.n ? t.hits / t.n : null, wilsonLo: wilsonLo(t.hits, t.n) }));
  // line-placement base rates (unconditional under-rate per market) — the null to beat
  const acesBase = raw.find((r) => r.name === 'Aces UNDER — ANY (base rate)')?.rate ?? 0.5;
  const dfBase = raw.find((r) => r.name === 'Double faults UNDER — baseline')?.rate ?? 0.5;
  const baseFor = (name) => (/Aces/.test(name) && /UNDER/.test(name)) ? acesBase
    : /Double faults/.test(name) ? dfBase : 0.5;
  return raw.map((r) => {
    const base = baseFor(r.name);
    const lift = r.rate == null ? null : r.rate - base;
    // A real edge must clear breakeven AND beat mere line placement (lift over the market base).
    return { ...r, base, lift, edge: r.n >= 30 && r.wilsonLo > 0.524 && lift != null && lift > 0.03 };
  }).sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1));
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || './data/tennis';
  const split = process.argv[3] || '2024-01-01';
  const files = readdirSync(dir).filter((f) => /_matches_.*\.csv$/i.test(f));
  let rows = [];
  for (const f of files) rows = rows.concat(buildRowsFromCsv(readFileSync(join(dir, f), 'utf8')));
  const train = rows.filter((r) => r.date && r.date < split);
  const test = rows.filter((r) => r.date && r.date >= split);
  console.error(`train ${train.length} rows (<${split}) · test ${test.length} rows`);
  const results = backtest(train, test);
  console.log(`\nSIGNAL${' '.repeat(44)} n     hit%   lift    WilsonLB  edge?`);
  for (const r of results) {
    const lift = r.lift == null ? '  —' : ((r.lift >= 0 ? '+' : '') + (r.lift * 100).toFixed(1)).padStart(6);
    console.log(`${r.name.padEnd(48)} ${String(r.n).padStart(5)}  ${r.rate == null ? '  —' : (r.rate * 100).toFixed(1).padStart(5)}  ${lift}   ${(r.wilsonLo * 100).toFixed(1).padStart(6)}   ${r.edge ? 'YES ✅' : ''}`);
  }
  console.log('\nlift = hit% minus the market\'s line-placement base rate. Edge = Wilson LB > 52.4% AND lift > +3pp.');
  console.log('Still a proxy: confirm promoted signals against a live PrizePicks line log before betting.');
}

export default { backtest, wilsonLo };
