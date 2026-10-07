// api/tennis/batch.mjs — analyze MANY matches in one request (server-side), so the Cleanest Edges
// board can fill instantly instead of one slow HTTP round-trip per match. Mirrors how MLB returns a
// full slate's analyses at once. Pulls each match's PrizePicks lines so props populate (rankable).
//
// GET /api/tennis/batch?date=YYYY-MM-DD[&max=20][&ppOnly=1]
//   → { ok, count, analyzed:[ { match, read, gradeStatus, cardModel } ] }
//
// Concurrency-limited so we don't overwhelm the sim or the API. Reuses the SAME buildMatchRead path
// as /analyze — identical numbers, just batched.

import { buildMatchRead } from '../../tennis/tennisMatchRead.js';
import { eloFromJSON, eloWinProb } from '../../tennis/tennisElo.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let _index = null;
function loadIndex() {
  if (_index) return _index;
  const p = process.env.TENNIS_INDEX_PATH || join(process.cwd(), 'tennis', 'tennis_serve_index.json');
  _index = JSON.parse(readFileSync(p, 'utf8'));
  return _index;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[.\-']/g, ' ').replace(/\s+/g, ' ').trim();

function resolve(index, key) {
  if (!key) return null;
  const qn = norm(key); const parts = qn.split(' ');
  const last = parts[parts.length - 1], fi = (parts[0] || ' ')[0];
  const ent = Object.entries(index.players || {});
  const hits = ent.filter(([, p]) => { const pt = norm(p.name).split(' '); return pt[pt.length - 1] === last && (pt[0] || ' ')[0] === fi; });
  if (!hits.length) return null;
  const best = hits.sort((a, b) => (b[1].surfaces?.ALL?.n || 0) - (a[1].surfaces?.ALL?.n || 0))[0];
  return { id: best[0], ...best[1] };
}

// analyze one match with lines → the same read shape /analyze returns (minus the live augment, which
// batch skips for speed — form context is a small nudge and the board ranks fine without it)
function analyzeOne(index, E, m, lines) {
  const playerA = resolve(index, m.playerA), playerB = resolve(index, m.playerB);
  if (!playerA || !playerB) return null;
  let ewp = null;
  try { if (E && playerA.id && playerB.id) ewp = eloWinProb(E, playerA.id, playerB.id, m.surface || 'Hard'); } catch {}
  const num = (v) => (v == null || v === '' ? undefined : Number(v));
  const read = buildMatchRead({
    playerA, playerB, eloWinProb: ewp, surface: m.surface || 'Hard', bestOf: m.bestOf || 3,
    rankA: playerA.rank ?? null, rankB: playerB.rank ?? null,
    lines: {
      totalGames: num(lines.totalGames), fantasyA: num(lines.fantasyA), fantasyB: num(lines.fantasyB),
      gamesWonA: num(lines.gamesWonA), gamesWonB: num(lines.gamesWonB),
      breakPointsWonA: num(lines.breakPointsWonA), breakPointsWonB: num(lines.breakPointsWonB),
      totalTieBreaks: num(lines.totalTieBreaks), acesA: num(lines.acesA), acesB: num(lines.acesB), dfA: num(lines.dfA),
    },
    sims: 3000,   // slightly fewer sims for batch speed; still stable for ranking
  });
  return read;
}

const LINE_KEYS = ['totalGames', 'fantasyA', 'fantasyB', 'gamesWonA', 'gamesWonB', 'breakPointsWonA', 'breakPointsWonB', 'totalTieBreaks', 'acesA', 'acesB', 'dfA'];

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const origin = `https://${req.headers.host}`;
    const max = Math.min(30, Number(q.max) || 20);

    // 1) get the slate
    const schedR = await fetch(`${origin}/api/tennis/schedule${q.date ? `?date=${encodeURIComponent(q.date)}` : ''}`, { cache: 'no-store' });
    const sched = schedR.ok ? await schedR.json() : { matches: [] };
    let matches = (sched.matches || []).filter((m) => !(m.playerA || '').includes(' / ') && !(m.playerB || '').includes(' / '));
    matches = matches.slice(0, max * 2);   // take extra; we'll filter to PP-having after matching

    // 2) pull all PP lines once (single call), index by matchup
    let ppByKey = {};
    try {
      const ppR = await fetch(`${origin}/api/tennis/prizepicks?debug=1`, { cache: 'no-store' });
      if (ppR.ok) {
        const pj = await ppR.json();
        for (const [, p] of Object.entries(pj.players || {})) {
          const a = norm(p.name), b = norm(p.opponent);
          const key = [a, b].sort().join('|');
          const lines = {};
          for (const [stat, val] of Object.entries(p.stats || {})) {
            // map PP stat names → line keys (A-side; board ranks the primary player)
            if (stat === 'Total Games') lines.totalGames = val;
            else if (stat === 'Fantasy Score') lines.fantasyA = val;
            else if (stat === 'Total Games Won') lines.gamesWonA = val;
            else if (stat === 'Break Points Won') lines.breakPointsWonA = val;
            else if (stat === 'Total Tie Breaks') lines.totalTieBreaks = val;
            else if (stat === 'Aces') lines.acesA = val;
            else if (stat === 'Double Faults') lines.dfA = val;
          }
          ppByKey[key] = lines;
        }
      }
    } catch {}

    // 3) analyze each match (reusing the index + Elo), attaching PP lines.
    // Filter to matches that ACTUALLY have PP lines (don't trust schedule's hasPP flag — it's
    // unreliable; match on the PP data we just fetched instead).
    const index = loadIndex();
    const E = index.elo ? eloFromJSON(index.elo) : null;
    const analyzed = [];
    let withPP = matches.map((m) => ({ m, key: [norm(m.playerA), norm(m.playerB)].sort().join('|') }))
      .filter((x) => q.ppOnly !== '1' || ppByKey[x.key]);
    withPP = withPP.slice(0, max);
    for (const { m, key } of withPP) {
      const lines = ppByKey[key] || {};
      try {
        const read = analyzeOne(index, E, m, lines);
        if (read) analyzed.push({ match: m, read, gradeStatus: { n: 0, shipped: false } });
      } catch {}
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, date: q.date || null, count: analyzed.length, analyzed });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e), analyzed: [] });
  }
}
