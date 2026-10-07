// tennisFeatureBuilder.js — melted rows → per-player, per-surface serve/return profiles.
//
// Rates are computed on their natural denominators (per service game / per service point),
// then SHRUNK toward a prior so thin surface samples don't produce wild projections:
//   surface rate  →shrink→  player's all-surface rate  →shrink→  rank-cohort baseline.
// Shrinkage is on the denominator (empirical-Bayes style), k = pseudo-observations of prior.
//
// Emits tennis_serve_index.json:
//   { meta, cohorts, players: { [id]: { name, lastDate, surfaces: { ALL, Hard, Clay, Grass, Carpet } } } }
// Each surface profile carries the shrunk rates AND the raw sample (n matches, svGms) so the
// classifier can gate on sample size and never trust a 6-match clay profile like a 200-match one.
//
// ESM. Import buildIndex(rows[, opts]) or run as a CLI over ./data/tennis/*.csv.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { buildElo, eloToJSON } from './tennisElo.js';
import { join } from 'node:path';
import { buildRowsFromCsv } from './tennisFeed.js';

const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];
const K_TO_ALL = 40;     // service games of pull from surface → player-all
const K_TO_COHORT = 80;  // service games of pull from player-all → cohort baseline
const K_RET = 30;        // return-games pull

// Rank buckets for the cohort baseline (shrinkage target of last resort).
function rankBucket(r) {
  if (r == null) return 'unranked';
  if (r <= 10) return 'top10';
  if (r <= 30) return 'top30';
  if (r <= 75) return 'top75';
  if (r <= 150) return 'top150';
  return 'beyond150';
}

// Accumulator of raw serve/return counters.
function newAcc() {
  return {
    n: 0, wins: 0, retApp: 0, // matches, wins, retirements appeared in
    // serve
    ace: 0, df: 0, svpt: 0, firstIn: 0, firstWon: 0, secondWon: 0, svGms: 0, bpSaved: 0, bpFaced: 0,
    // return-side (derived from opponent serve line)
    retSvpt: 0, retPtsWon: 0, acesFaced: 0, retGms: 0, breaksMade: 0,
    // opponent-adjustment: weighted sums of per-match deltas (weighted by points, so big matches count more)
    adjSpwW: 0, adjSpwPts: 0, adjRetW: 0, adjRetPts: 0,
    lastDate: '',
  };
}

function add(acc, row, adj) {
  acc.n++;
  if (row.won) acc.wins++;
  if (row.retired) acc.retApp++;
  if (row.date > acc.lastDate) acc.lastDate = row.date;
  if (!row.hasStats) return; // form counted, serve rates skipped
  const s = row;
  if (s.svGms != null) {
    acc.ace += s.ace || 0; acc.df += s.df || 0; acc.svpt += s.svpt || 0;
    acc.firstIn += s.firstIn || 0; acc.firstWon += s.firstWon || 0; acc.secondWon += s.secondWon || 0;
    acc.svGms += s.svGms || 0; acc.bpSaved += s.bpSaved || 0; acc.bpFaced += s.bpFaced || 0;
    if (adj && s.svpt) { acc.adjSpwW += adj.dSpw * s.svpt; acc.adjSpwPts += s.svpt; }
  }
  if (s.oppSvGms != null && s.oppSvpt != null) {
    const oppServePtsWon = (s.oppFirstWon || 0) + (s.oppSecondWon || 0);
    acc.retSvpt += s.oppSvpt || 0;
    acc.retPtsWon += (s.oppSvpt || 0) - oppServePtsWon; // return points THIS player won
    acc.acesFaced += s.oppAce || 0;
    acc.retGms += s.oppSvGms || 0;
    acc.breaksMade += Math.max(0, (s.oppBpFaced || 0) - (s.oppBpSaved || 0)); // break POINTS converted
    if (adj && s.oppSvpt) { acc.adjRetW += adj.dRet * s.oppSvpt; acc.adjRetPts += s.oppSvpt; }
  }
}

// Raw rates from an accumulator (null where denominator absent).
function rawRates(a) {
  const svpt = a.svpt || 0, svGms = a.svGms || 0, retGms = a.retGms || 0, retSvpt = a.retSvpt || 0;
  const firstIn = a.firstIn || 0;
  return {
    n: a.n, svGms, retGms, winPct: a.n ? a.wins / a.n : null,
    acePerSvGm: svGms ? a.ace / svGms : null,
    dfPerSvGm: svGms ? a.df / svGms : null,
    firstInPct: svpt ? firstIn / svpt : null,
    firstWonPct: firstIn ? a.firstWon / firstIn : null,
    secondWonPct: (svpt - firstIn) > 0 ? a.secondWon / (svpt - firstIn) : null,
    // opponent-adjusted: raw rate + mean per-point delta (clamped to sane tennis ranges)
    servePtsWonPct: svpt ? Math.min(0.90, Math.max(0.40,
      (a.firstWon + a.secondWon) / svpt + (a.adjSpwPts ? a.adjSpwW / a.adjSpwPts : 0))) : null,
    retPtsWonPct: retSvpt ? Math.min(0.60, Math.max(0.15,
      a.retPtsWon / retSvpt + (a.adjRetPts ? a.adjRetW / a.adjRetPts : 0))) : null,
    acesFacedPerRetGm: retGms ? a.acesFaced / retGms : null,
  };
}

// Empirical-Bayes shrink of `rate` (with `denom` observations) toward `prior`, strength k.
function shrink(rate, denom, prior, k) {
  if (rate == null) return prior;
  if (prior == null) return rate;
  const d = denom || 0;
  return (d * rate + k * prior) / (d + k);
}

// Blend a surface profile toward all-surface, then toward cohort baseline.
function shrinkProfile(surfRaw, allRaw, cohort) {
  const svD = surfRaw.svGms, retD = surfRaw.retGms;
  const step = (key, denom, k1, k2) => {
    const toAll = shrink(surfRaw[key], denom, allRaw ? allRaw[key] : null, k1);
    return shrink(toAll, denom, cohort ? cohort[key] : null, k2);
  };
  return {
    n: surfRaw.n, svGms: surfRaw.svGms, retGms: surfRaw.retGms, winPct: surfRaw.winPct,
    acePerSvGm: step('acePerSvGm', svD, K_TO_ALL, K_TO_COHORT),
    dfPerSvGm: step('dfPerSvGm', svD, K_TO_ALL, K_TO_COHORT),
    firstInPct: step('firstInPct', svD, K_TO_ALL, K_TO_COHORT),
    servePtsWonPct: step('servePtsWonPct', svD, K_TO_ALL, K_TO_COHORT),
    retPtsWonPct: step('retPtsWonPct', retD, K_RET, K_RET * 2),
    acesFacedPerRetGm: step('acesFacedPerRetGm', retD, K_RET, K_RET * 2),
    raw: surfRaw, // keep raw for transparency / sample gating
  };
}

export function buildIndex(rows, opts = {}) {
  // Two passes. Pass 1 gets each player's RAW rates. Pass 2 re-accumulates every match with the
  // opponent's raw strength factored out — because raw rates are level-biased: a Challenger player
  // returns against weak servers, so his return% looks elite (0.45 vs a 0.365 tour average) and his
  // serve% looks poor. Without this, lower-tier players read as competitive with tour players,
  // mismatches project even, and total games inflate by ~2/match.
  const TOUR_SPW = 0.635, TOUR_RET = 0.365;   // tour-average serve/return points won

  const rawOf = new Map();  // playerId -> { spw, ret } — iterated to convergence
  {
    // Per-match point totals, kept once so we can re-average cheaply each iteration.
    const ms = [];
    // Anchor set: players who appear in tour-level matches (rank <= 100 at the time). Their
    // absolute rate is known (TOUR_SPW), which pins the scale for everyone connected to them.
    const anchorIds = new Set();
    for (const r of rows) {
      if (!r.playerId || !r.hasStats || !r.svpt) continue;
      if (r.playerRank != null && r.playerRank <= 100) anchorIds.add(r.playerId);
      ms.push({ id: r.playerId, opp: r.oppId,
        sw: (r.firstWon + r.secondWon), sp: r.svpt,
        rw: r.oppSvpt ? r.oppSvpt - (r.oppFirstWon + r.oppSecondWon) : 0, rp: r.oppSvpt || 0 });
    }
    // seed with raw means
    const seed = new Map();
    for (const m of ms) {
      if (!seed.has(m.id)) seed.set(m.id, { sw: 0, sp: 0, rw: 0, rp: 0 });
      const a = seed.get(m.id); a.sw += m.sw; a.sp += m.sp; a.rw += m.rw; a.rp += m.rp;
    }
    for (const [id, a] of seed) rawOf.set(id, { spw: a.sp ? a.sw / a.sp : TOUR_SPW, ret: a.rp ? a.rw / a.rp : TOUR_RET });
    // Iterate: re-estimate each player with opponent strength stripped out, using the previous
    // iteration's estimates. Two guards, both needed:
    //  - DAMPING: blend each new estimate with the prior one. Without it the loop runs away — an
    //    inflated returner inflates his opponents' serve ratings, which shrinks his own correction,
    //    and Challenger players end up rated as all-time-great returners.
    //  - SHRINKAGE: pull toward the tour mean by sample size, so a player with 40 service points
    //    doesn't swing the graph. K is in points.
    const DAMP = 0.5, K = 600;
    for (let iter = 0; iter < 12; iter++) {
      const next = new Map();
      for (const m of ms) {
        const o = rawOf.get(m.opp);
        const dS = o ? -(TOUR_RET - o.ret) : 0;
        const dR = o ? -(TOUR_SPW - o.spw) : 0;
        if (!next.has(m.id)) next.set(m.id, { sW: 0, sP: 0, rW: 0, rP: 0 });
        const a = next.get(m.id);
        a.sW += (m.sw / (m.sp || 1) + dS) * m.sp; a.sP += m.sp;
        if (m.rp) { a.rW += (m.rw / m.rp + dR) * m.rp; a.rP += m.rp; }
      }
      for (const [id, a] of next) {
        const prev = rawOf.get(id) || { spw: TOUR_SPW, ret: TOUR_RET };
        const rawS = a.sP ? a.sW / a.sP : TOUR_SPW;
        const rawR = a.rP ? a.rW / a.rP : TOUR_RET;
        const wS = a.sP / (a.sP + K), wR = a.rP / (a.rP + K);
        const shrS = TOUR_SPW + wS * (rawS - TOUR_SPW);
        const shrR = TOUR_RET + wR * (rawR - TOUR_RET);
        rawOf.set(id, {
          spw: Math.min(0.90, Math.max(0.40, DAMP * shrS + (1 - DAMP) * prev.spw)),
          ret: Math.min(0.60, Math.max(0.15, DAMP * shrR + (1 - DAMP) * prev.ret)),
        });
      }
    }
  }
  // Opponent adjustment for one match row: strip out how far the opponent is from tour-average.
  const adjust = (r) => {
    const o = rawOf.get(r.oppId);
    if (!o) return { dSpw: 0, dRet: 0 };
    return { dSpw: -(TOUR_RET - o.ret), dRet: -(TOUR_SPW - o.spw) };
  };

  const players = new Map();
  const cohortAcc = new Map();
  const sorted = rows.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const r of sorted) {
    if (!r.playerId) continue;
    let P = players.get(r.playerId);
    if (!P) { P = { name: r.playerName, latestRank: r.playerRank, latestDate: r.date, byKey: new Map(), recent: [] }; players.set(r.playerId, P); }
    if (r.date >= P.latestDate) { P.latestDate = r.date; if (r.playerRank != null) P.latestRank = r.playerRank; }
    const surf = SURFACES.includes(r.surface) ? r.surface : 'Hard';
    const adj = adjust(r);
    for (const key of ['ALL', surf]) {
      if (!P.byKey.has(key)) P.byKey.set(key, newAcc());
      add(P.byKey.get(key), r, adj);
    }
    if (r.hasStats && r.svGms) {
      P.recent.push({ date: r.date, surface: surf, minutes: r.minutes || 0, won: r.won ? 1 : 0, oppId: r.oppId,
        acePg: r.ace / r.svGms, servePct: r.svpt ? (r.firstWon + r.secondWon) / r.svpt + adj.dSpw : null });
      if (P.recent.length > 20) P.recent.shift();
    }
    const bucket = rankBucket(r.playerRank);
    for (const key of [`${bucket}|ALL`, `${bucket}|${surf}`]) {
      if (!cohortAcc.has(key)) cohortAcc.set(key, newAcc());
      add(cohortAcc.get(key), r, adj);
    }
  }

  const cohorts = {};
  for (const [k, a] of cohortAcc) cohorts[k] = rawRates(a);

  const meanOf = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400e3);
  // recent-form + fatigue snapshot as of the player's last logged match (Sackmann-derived).
  function computeRecent(P, allRaw) {
    const rec = P.recent;
    if (!rec.length) return null;
    const last8 = rec.slice(-8);
    const asOf = P.latestDate;
    const win10 = rec.filter((m) => dayDiff(asOf, m.date) <= 10);
    return {
      formAce: (allRaw && allRaw.acePerSvGm != null) ? (meanOf(last8.map((m) => m.acePg)) - allRaw.acePerSvGm) : 0,
      formServe: (allRaw && allRaw.servePtsWonPct != null)
        ? ((meanOf(last8.map((m) => m.servePct).filter((v) => v != null)) || allRaw.servePtsWonPct) - allRaw.servePtsWonPct) : 0,
      matchesLast10: win10.length,
      minutesLast10: win10.reduce((s, m) => s + (m.minutes || 0), 0),
      last10Wins: rec.slice(-10).reduce((s, m) => s + (m.won ? 1 : 0), 0),
      last10Played: Math.min(10, rec.length),
      lastSurface: rec[rec.length - 1].surface,
      lastDate: rec[rec.length - 1].date,
    };
  }

  // Elo from match results — the identification anchor (see tennisElo.js). Built from the match
  // graph, so it bridges Challenger/tour tiers and escapes the serve/return gauge freedom.
  const elo = buildElo(rows);

  // Head-to-head table from match results (winner-perspective rows). h2h[id][oppId] = wins by id.
  const h2h = new Map();
  { const seen = new Set();
    for (const r of rows) {
      if (!r.playerId || !r.oppId || !r.date || !r.won) continue;
      const k = [r.playerId, r.oppId].sort().join('-') + '|' + r.date + '|' + (r.tourney || '');
      if (seen.has(k)) continue; seen.add(k);
      if (!h2h.has(r.playerId)) h2h.set(r.playerId, new Map());
      const mm = h2h.get(r.playerId); mm.set(r.oppId, (mm.get(r.oppId) || 0) + 1);
    } }

  const out = { meta: { built: new Date().toISOString(), players: players.size,
    kToAll: K_TO_ALL, kToCohort: K_TO_COHORT, note: opts.note || 'v1 — thresholds unvalidated' },
    cohorts, elo: eloToJSON(elo), players: {} };

  for (const [id, P] of players) {
    const allRaw = P.byKey.has('ALL') ? rawRates(P.byKey.get('ALL')) : null;
    const bucket = rankBucket(P.latestRank);
    const surfaces = {};
    if (allRaw) surfaces.ALL = shrinkProfile(allRaw, allRaw, cohorts[`${bucket}|ALL`]);
    for (const s of SURFACES) {
      if (!P.byKey.has(s)) continue;
      surfaces[s] = shrinkProfile(rawRates(P.byKey.get(s)), allRaw, cohorts[`${bucket}|${s}`]);
    }
    const eo = elo.overall.get(id);
    const myH2h = h2h.get(id);
    out.players[id] = { name: P.name, rank: P.latestRank, lastDate: P.latestDate, bucket,
      elo: eo ? Math.round(eo.r * 10) / 10 : null, eloN: eo ? eo.n : 0,
      h2h: myH2h ? Object.fromEntries(myH2h) : undefined,
      surfaces, recent: computeRecent(P, allRaw) };
  }
  return out;
}

// CLI: node tennisFeatureBuilder.js [dataDir] [outFile]
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || './data/tennis';
  const outFile = process.argv[3] || './tennis/tennis_serve_index.json';
  const files = readdirSync(dir).filter((f) => /_matches_.*\.csv$/i.test(f));
  if (!files.length) { console.error(`No *_matches_*.csv in ${dir}`); process.exit(1); }
  let rows = [];
  for (const f of files) {
    const txt = readFileSync(join(dir, f), 'utf8');
    const r = buildRowsFromCsv(txt);
    rows = rows.concat(r);
    console.error(`  ${f}: ${r.length / 2 | 0} matches → ${r.length} player-rows`);
  }
  const index = buildIndex(rows, { note: `built from ${files.length} files` });
  writeFileSync(outFile, JSON.stringify(index));
  console.error(`✓ ${index.meta.players} players → ${outFile}`);
}

export default { buildIndex };
