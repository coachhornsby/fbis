// api/tennis/prizepicks.mjs — pull live PrizePicks tennis projections so lines auto-populate.
//
// Endpoint: https://partner-api.prizepicks.com/projections  (JSON:API format — `data` holds the
// projections, `included` holds the players/leagues they reference; you must join them by id).
// NOT publicly documented by PrizePicks: the shape can change without notice, and you should check
// their ToS before relying on it commercially. Everything below fails soft — if the shape shifts,
// the board still works and you type lines by hand as before.
//
//   GET /api/tennis/prizepicks              -> all tennis projections, grouped by player
//   GET /api/tennis/prizepicks?a=NAME&b=NAME -> lines for one matchup, mapped to our line params
//
// Returns { ok, count, players:{ "<name>": { "Total Games": 22.5, ... } }, lines?: {...} }

const URL = 'https://partner-api.prizepicks.com/projections?per_page=1000';
const CACHE_MS = 5 * 60 * 1000;   // lines move; keep it short but don't hammer them
let CACHE = { at: 0, data: null };

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[.]/g, '').trim();

// PrizePicks stat_type -> our analyze line params.
// A: the player the prop is ON. B: their opponent. Total Games is match-level (either side).
const STAT_MAP = {
  'total games': 'totalGames',
  'fantasy score': 'fantasyA',
  'total games won': 'gamesWonA',
  'aces': 'acesA',
  'double faults': 'dfA',
};

async function fetchProjections() {
  if (CACHE.data && Date.now() - CACHE.at < CACHE_MS) return CACHE.data;
  const r = await fetch(URL, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`PrizePicks HTTP ${r.status}`);
  const j = await r.json();

  // JSON:API — resolve `included` into lookup maps first
  const players = new Map(), leagues = new Map();
  for (const inc of j.included || []) {
    if (inc.type === 'new_player') players.set(String(inc.id), inc.attributes?.name || '');
    if (inc.type === 'league') leagues.set(String(inc.id), inc.attributes?.name || '');
  }

  const out = {};
  for (const d of j.data || []) {
    const a = d.attributes || {}, rel = d.relationships || {};
    const leagueId = String(rel.league?.data?.id ?? '');
    const league = leagues.get(leagueId) || a.league || '';
    if (!/tennis/i.test(league)) continue;                       // tennis only
    const pid = String(rel.new_player?.data?.id ?? '');
    const name = players.get(pid) || a.name || a.description || '';
    if (!name) continue;
    const stat = a.stat_type || a.stat_display_name || '';
    const line = Number(a.line_score);
    if (!Number.isFinite(line)) continue;
    // PrizePicks serves alternates alongside the standard line (demon = harder/higher payout,
    // goblin = easier/lower). Keep STANDARD for auto-fill; stash alternates separately so you can
    // shop numbers later without them overwriting the real line.
    const oddsType = String(a.odds_type || 'standard').toLowerCase();
    const key = norm(name);
    (out[key] ||= { name, opponent: a.description || null, startTime: a.start_time || null,
      stats: {}, alternates: {} });
    if (oddsType === 'standard') out[key].stats[stat] = line;
    else ((out[key].alternates[stat] ||= []).push({ line, oddsType }));
  }
  CACHE = { at: Date.now(), data: out };
  return out;
}

// last-name + first-initial match, so "A. Sasnovich" finds "Aliaksandra Sasnovich"
function lookup(byName, q) {
  const n = norm(q);
  if (byName[n]) return byName[n];
  const t = n.split(/\s+/), last = t[t.length - 1], fi = (t[0] || ' ')[0];
  for (const [k, v] of Object.entries(byName)) {
    const kt = k.split(/\s+/);
    if (kt[kt.length - 1] === last && (kt[0] || ' ')[0] === fi) return v;
  }
  return null;
}

/** Map a matchup's PrizePicks props onto our analyze line params. Exported for the logger. */
export function linesForMatchup(byName, aName, bName) {
  const A = lookup(byName, aName), B = lookup(byName, bName);
  const lines = {}, found = {};
  const take = (rec, side) => {
    if (!rec) return;
    for (const [stat, line] of Object.entries(rec.stats)) {
      const base = STAT_MAP[norm(stat)];
      if (!base) continue;
      if (base === 'totalGames') { lines.totalGames = line; found['Total Games'] = line; continue; }
      const key = side === 'A' ? base : base.replace(/A$/, 'B');
      lines[key] = line; found[`${rec.name} ${stat}`] = line;
    }
  };
  take(A, 'A'); take(B, 'B');
  return { lines, found, matchedA: !!A, matchedB: !!B };
}

export default async function handler(req, res) {
  try {
    const byName = await fetchProjections();
    const q = req.query || {};
    res.setHeader('Cache-Control', 'no-store');
    if (q.a && q.b) {
      const m = linesForMatchup(byName, q.a, q.b);
      res.status(200).json({ ok: true, ...m, source: 'prizepicks' });
      return;
    }
    res.status(200).json({ ok: true, count: Object.keys(byName).length, players: byName, source: 'prizepicks' });
  } catch (e) {
    // fail soft — board keeps working, user types lines by hand
    res.status(200).json({ ok: false, error: String(e.message || e), players: {}, count: 0 });
  }
}
