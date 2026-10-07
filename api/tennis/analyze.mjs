// api/tennis/analyze.mjs — serves a match read off the precomputed tennis_serve_index.json.
// Mirrors api/cs2/analyze: GET /api/tennis/analyze?a=<id|name>&b=<id|name>&surface=Hard&bestOf=3
//   &acesA=15.5&totalGames=22.5&dfA=2.5&rankA=5&rankB=8&h2h=10-4
// Returns the same read object buildMatchRead produces (all props bet:false until graded).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMatchRead } from '../../tennis/tennisMatchRead.js';
import { augmentMatchup } from '../../tennis/tennisLiveAugment.mjs';
import { makeMatchstatSource } from '../../tennis/tennisMatchstat.mjs';
import { makeApiTennisSource } from '../../tennis/tennisApiTennis.mjs';
import { resolveWithColdStart } from '../../tennis/tennisColdStart.mjs';
import { eloFromJSON, eloWinProb } from '../../tennis/tennisElo.js';
import { buildNarrative } from '../../tennis/tennisNarrative.js';

// Live source: prefer api-tennis.com if its key is set, else Matchstat. Either is optional —
// with neither, reads still work off the index (just with build-time form instead of live).
const LIVE = process.env.APITENNIS_KEY
  ? makeApiTennisSource({ apiKey: process.env.APITENNIS_KEY })
  : (process.env.MATCHSTAT_KEY ? makeMatchstatSource({ apiKey: process.env.MATCHSTAT_KEY }) : null);
const LIVE_NAME = process.env.APITENNIS_KEY ? 'api-tennis' : (process.env.MATCHSTAT_KEY ? 'matchstat' : null);

// Load + cache the index once per warm lambda. Adjust the path to wherever you commit/store it.
let INDEX = null;
function loadIndex() {
  if (INDEX) return INDEX;
  const candidates = [
    process.env.TENNIS_INDEX_PATH,
    join(process.cwd(), 'tennis', 'tennis_serve_index.json'),
    join(process.cwd(), 'tennis_serve_index.json'),
    join(process.cwd(), 'public', 'tennis_serve_index.json'),
    join(process.cwd(), 'data', 'tennis_serve_index.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { INDEX = JSON.parse(readFileSync(p, 'utf8')); return INDEX; } catch { /* try next */ }
  }
  throw new Error('tennis_serve_index.json not found — run tennisFeatureBuilder.js and commit/store it');
}

// Resolve a player by exact id, then case-insensitive name match.
// Resolve a player. Feeds hand us abbreviated names ("D. Jade", "A. Sasnovich") while the index
// holds full names ("Damir Jade"), so exact matching alone fails and the board's readable flag
// disagrees with what analyze can actually find. Match on last name + first initial — the SAME rule
// schedule.mjs uses — so the two stay in sync.
// NEVER fall back to a loose substring match: `includes("d.")` happily matches half the tour and
// silently returns a read for the WRONG player, which is worse than no read at all.
function normName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[.\-']/g, ' ').replace(/\s+/g, ' ').trim();
}
function nameKey(s) {
  const t = normName(s).split(' ').filter(Boolean);
  if (!t.length) return null;
  return `${t[t.length - 1]}|${(t[0] || ' ')[0]}`;   // lastname|firstInitial
}
function resolve(index, key) {
  if (key == null) return null;
  const k = String(key).trim();
  if (!k) return null;
  if (index.players[k]) return { id: k, ...index.players[k] };          // exact id
  const target = normName(k);
  const entries = Object.entries(index.players);
  for (const [id, p] of entries) if (normName(p.name) === target) return { id, ...p };  // exact name
  // last name + first initial; if it's ambiguous prefer the player with the most matches
  const want = nameKey(k);
  if (!want) return null;
  const hits = entries.filter(([, p]) => nameKey(p.name) === want);
  if (!hits.length) return null;
  hits.sort((a, b) => ((b[1].surfaces?.ALL?.n || 0) - (a[1].surfaces?.ALL?.n || 0)));
  const [id, p] = hits[0];
  return { id, ...p, _matchedBy: hits.length > 1 ? 'lastname+initial (ambiguous)' : 'lastname+initial' };
}

const num = (v) => (v == null || v === '' ? null : Number(v));

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const index = loadIndex();
    let playerA = resolve(index, q.a);
    let playerB = resolve(index, q.b);

    // Index miss → build the player from the live source's recent matches (ITF, Challenger, new
    // pros). Only possible with a live key; without one we still have to 404.
    let coldA = false, coldB = false;
    if ((!playerA || !playerB) && LIVE && q.live !== '0') {
      const [ra, rb] = await Promise.all([
        resolveWithColdStart(LIVE, playerA, q.a).catch(() => ({ player: playerA, coldStart: false })),
        resolveWithColdStart(LIVE, playerB, q.b).catch(() => ({ player: playerB, coldStart: false })),
      ]);
      playerA = ra.player; coldA = ra.coldStart;
      playerB = rb.player; coldB = rb.coldStart;
    }
    if (!playerA || !playerB) {
      res.status(404).json({ error: 'player not found', a: !!playerA, b: !!playerB,
        hint: LIVE ? 'not in the index and the live source has no recent matches for them'
                   : 'not in the index; set APITENNIS_KEY or MATCHSTAT_KEY to read off-index players' });
      return;
    }
    // Refresh recent form/fatigue from the live source (index stays the deep baseline). Never fatal.
    // Cold-start players are already built from live data — no need to re-fetch them.
    let live = false;
    if (LIVE && q.live !== '0' && !(coldA && coldB)) {
      try {
        const aug = await augmentMatchup(LIVE, playerA, playerB);
        if (!coldA) playerA = aug.playerA;
        if (!coldB) playerB = aug.playerB;
        live = true;
      } catch { /* fall back to index-only */ }
    }
    // Elo anchor: surface Elo from the index supplies the win probability the point rates can't
    // (level-biased + gauge-degenerate). Cold-start players have no Elo → falls back to rates.
    let ewp = null;
    try {
      if (index.elo && !coldA && !coldB) {
        const E = eloFromJSON(index.elo);
        // resolve() returns { id, ...player } — a COPY — so identity lookup against index.players
        // never matched and the anchor silently never fired. Use the id resolve() already gives us.
        const idA = playerA.id, idB = playerB.id;
        if (idA && idB) ewp = eloWinProb(E, idA, idB, q.surface || 'Hard');
      }
    } catch { /* rates-only fallback */ }

    // CONTEXT LAYER: nudge the Elo win prob for what the career baseline can't see — recent FORM
    // (and fatigue when workload data is present). Bounded ±6% so it informs, never overrides Elo.
    // Form comes from the index `recent` block (last10Wins/last10Played); fatigue needs match dates
    // we don't have on the free tier yet, so it stays 0 until the Basic history feed is wired.
    let contextFactors = [];
    try {
      if (ewp != null) {
        const { formScore, contextWinAdj } = await import('../../tennis/tennisContext.mjs');
        const recA = playerA.recent || {}, recB = playerB.recent || {};
        // build a pseudo recent-results list from last10 wins/played (newest-first not available,
        // so approximate: a win-rate signal centered at 0). formScore on an even list ≈ win-rate*2-1.
        const formA = recA.last10Played ? (recA.last10Wins / recA.last10Played) * 2 - 1 : 0;
        const formB = recB.last10Played ? (recB.last10Wins / recB.last10Played) * 2 - 1 : 0;
        const ctx = contextWinAdj({ formA, formB, fatigueA: 0, fatigueB: 0 });
        if (ctx.adj !== 0) ewp = Math.max(0.05, Math.min(0.95, ewp + ctx.adj));
        // relabel A/B factors to real names for the card
        contextFactors = (ctx.factors || []).map((f) => ({
          key: f.key,
          text: f.text.replace(/\bA\b/, playerA.name.split(' ').pop()).replace(/\bB\b/, playerB.name.split(' ').pop()),
          weight: f.weight,
        }));
      }
    } catch { /* context is best-effort — never blocks the read */ }
    const read = buildMatchRead({
      playerA, playerB, eloWinProb: ewp,
      surface: q.surface || 'Hard',
      bestOf: num(q.bestOf) || 3,
      rankA: num(q.rankA) ?? playerA.rank ?? null,
      rankB: num(q.rankB) ?? playerB.rank ?? null,
      h2h: q.h2h || null,
      h2hEdge: num(q.h2hEdge) || 0,
      recentRetirementA: q.retA === '1' || q.retA === 'true',
      recentRetirementB: q.retB === '1' || q.retB === 'true',
      lines: {
        acesA: num(q.acesA), acesB: num(q.acesB),
        dfA: num(q.dfA), totalGames: num(q.totalGames),
        fantasyA: num(q.fantasyA), fantasyB: num(q.fantasyB),
        gamesWonA: num(q.gamesWonA), gamesWonB: num(q.gamesWonB),
        breakPointsWonA: num(q.breakPointsWonA), breakPointsWonB: num(q.breakPointsWonB),
        totalTieBreaks: num(q.totalTieBreaks),
      },
      sims: 4000,
    });
    // Plain-language tug-of-war narrative (the card's WHY). Traces every number to the index.
    // Spec card model — map ONLY real index fields; a missing field drops its factor (never fabricate).
    // gradeStatus drives the honesty banner — read from the priors log bucket counts. Until a
    // bucket ships (n>=50 + beats break-even + Wilson floor), stays PRIORS ONLY.
    let gradeStatus = { n: 0, shipped: false };
    try {
      const { bucketStatus } = await import('../../tennis/tennisPriorsLog.mjs');
      gradeStatus = await bucketStatus({ tour: q.tour || read.tourLabel, surface: q.surface || 'Hard' });
    } catch { /* no log yet → priors only */ }

    let cardModel = null;
    try {
      const surfW = (pl) => { const s = pl.surfaces?.[q.surface || 'Hard']; const a = pl.surfaces?.ALL;
        const u = (s && s.n >= 20) ? s : a; return u && u.winPct != null ? { v: u.winPct, n: u.n } : null; };
      const wA = surfW(playerA), wB = surfW(playerB);
      const fA = playerA.recent?.last10Wins, fB = playerB.recent?.last10Wins;   // real W-L if builder emits it
      cardModel = {
        playerA: playerA.name, playerB: playerB.name,
        surface: q.surface || 'Hard', event: q.event || read.tournament || '', tour: q.tour || read.tourLabel || '',
        rankA: playerA.rank || null, rankB: playerB.rank || null,
        eloA: playerA.elo || null, eloB: playerB.elo || null, eloNA: playerA.eloN || 0, eloNB: playerB.eloN || 0,
        // the engine's own win prob for A — makes the card's headline % the SAME number the
        // projections and line-grading use (single source of truth). Falls back to factor logistic
        // only when this is null (cold-start players with no read).
        engineWinA: (read.winProb && read.winProb[playerA.name] != null) ? read.winProb[playerA.name] : null,
        matchFlow: read.matchFlow || null, closeGame: !!read.closeGame, deciderProb: read.deciderProb != null ? read.deciderProb : null,
        tiebreakProb: read.tiebreakProb != null ? read.tiebreakProb : null, expTiebreaks: read.expTiebreaks != null ? read.expTiebreaks : null,
        matchShape: read.matchShape || null,
        contextFactors,   // form/fatigue nudges surfaced as extra 'why' factors
        bestPlay: read.bestPlay || null,
        surfWinA: wA ? wA.v : null, surfWinB: wB ? wB.v : null, surfNA: wA ? wA.n : 0, surfNB: wB ? wB.n : 0,
        formA: (typeof fA === 'number') ? fA : null, formB: (typeof fB === 'number') ? fB : null,
        h2hA: (playerA.h2h && playerB.id != null) ? (playerA.h2h[playerB.id] || 0) : null,
        h2hB: (playerB.h2h && playerA.id != null) ? (playerB.h2h[playerA.id] || 0) : null,
      };
      // explicit ?h2h=x-y overrides the stored table if supplied
      if (q.h2h && /^\d+-\d+$/.test(q.h2h)) { const [x,y] = q.h2h.split('-').map(Number); cardModel.h2hA = x; cardModel.h2hB = y; }
    } catch { /* card falls back to raw read */ }

    let narrative = null;
    try { narrative = buildNarrative(read, playerA, playerB); } catch { /* card falls back to raw read */ }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, live, narrative, cardModel, gradeStatus, eloAnchored: ewp != null, liveSource: (live || coldA || coldB) ? LIVE_NAME : null,
      coldStart: (coldA || coldB) ? { [q.a]: coldA, [q.b]: coldB } : null,
      builtFrom: index.meta?.built || null, read });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
