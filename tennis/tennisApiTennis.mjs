// tennisApiTennis.mjs — live-stats source adapter for api-tennis.com (allsportsapi backend).
// Same interface as tennisMatchstat.mjs: { fetchRecentMatches, resolveId, probe } — so analyze.mjs
// can use either by picking the source from whichever env key is set.
//   RecentMatch = { date, surface, aces, svGms, servePtsWonPct, minutes }
//
// Auth is a query param (APIkey). Verified against api-tennis.com docs:
//   get_standings?event_type=ATP|WTA  -> ranked players with player_key + player (name)
//   get_fixtures?player_key=&date_start=&date_stop=  -> matches; finished ones carry `statistics`
// The `statistics` row shape varies (home/away vs per-player); statValue() handles both and probe()
// dumps a raw fixture if aces come back null so mapping can be confirmed.
//
// NOTE: a business trial gives full stats now; when it lapses, lower tiers may drop the statistics
// array — at which point switch back to MATCHSTAT_KEY (the code supports both).

const BASE = 'https://api.api-tennis.com/tennis/';
const num = (v) => { const n = Number(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const iso = (d) => new Date(d).toISOString().slice(0, 10);

const SURF = [[/monte|madrid|rome|barcelona|hamburg|estoril|munich|bastad|gstaad|umag|kitzbuhel|roland|french|clay/i, 'Clay'],
  [/wimbledon|halle|queen|hertogenbosch|newport|eastbourne|mallorca|grass/i, 'Grass']];
const inferSurface = (name) => { for (const [re, s] of SURF) if (re.test(name || '')) return s; return 'Hard'; };

// Parse "38/54 (70%)" -> {won:38, of:54}; "5" -> {won:5, of:null}
function frac(v) {
  const s = String(v ?? '');
  const m = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) return { won: +m[1], of: +m[2] };
  const n = num(s); return { won: n, of: null };
}

export function makeApiTennisSource({ apiKey, ttlMs = 6 * 3600e3, windowDays = 75 } = {}) {
  const get = async (params) => {
    const qs = new URLSearchParams({ ...params, APIkey: apiKey }).toString();
    const r = await fetch(`${BASE}?${qs}`);
    if (!r.ok) throw new Error(`api-tennis ${params.method} -> HTTP ${r.status}`);
    const j = await r.json();
    if (j.success !== 1) throw new Error(`api-tennis ${params.method}: ${JSON.stringify(j.result || j)}`);
    return j.result;
  };

  let idMap = null;                 // normalized name -> { key, tour }
  const recentCache = new Map();

  async function buildIdMap() {
    idMap = new Map();
    for (const tour of ['ATP', 'WTA']) {
      try {
        const rows = await get({ method: 'get_standings', event_type: tour });
        for (const p of (Array.isArray(rows) ? rows : [])) {
          const name = p.player || p.player_name; const key = p.player_key;
          if (name && key != null) idMap.set(norm(name), { key, tour: tour.toLowerCase() });
        }
      } catch { /* partial ok */ }
    }
  }
  async function resolveId(name) {
    if (!idMap) await buildIdMap();
    const n = norm(name);
    if (idMap.has(n)) return idMap.get(n);
    const t = n.split(/\s+/), last = t[t.length - 1], fi = (t[0] || ' ')[0];
    for (const [k, v] of idMap) { const kt = k.split(/\s+/); if (kt[kt.length - 1] === last && (kt[0] || ' ')[0] === fi) return v; }
    return null;
  }

  // find a stat value for this player's side from a fixture's `statistics` array (handles both shapes)
  function statValue(stats, re, side, playerKey) {
    for (const s of stats || []) {
      const name = s.stat_name || s.type || s.name || '';
      if (!re.test(name)) continue;
      if (s.player_key != null) { if (String(s.player_key) === String(playerKey)) return s.stat_value ?? s.value; continue; }
      const v = side === 'first' ? (s.home_stat ?? s.first_stat ?? s.player1) : (s.away_stat ?? s.second_stat ?? s.player2);
      if (v != null) return v;
    }
    return null;
  }
  function svGmsFromScores(fx) {
    let tot = 0;
    for (const s of fx.scores || []) tot += (num(s.score_first) || 0) + (num(s.score_second) || 0);
    return tot ? tot / 2 : null;
  }

  async function fetchRecentMatches(name) {
    const hit = await resolveId(name);
    if (!hit) return [];
    const cached = recentCache.get(hit.key);
    if (cached && Date.now() - cached.at < ttlMs) return cached.rows;
    let fx;
    try {
      fx = await get({ method: 'get_fixtures', player_key: hit.key,
        date_start: iso(Date.now() - windowDays * 864e5), date_stop: iso(Date.now()) });
    } catch { return []; }
    const rows = (Array.isArray(fx) ? fx : []).filter((m) => /finish/i.test(m.event_status || '')).map((m) => {
      const side = String(m.first_player_key) === String(hit.key) ? 'first' : 'second';
      const aces = num(statValue(m.statistics, /ace/i, side, hit.key));
      const f1 = frac(statValue(m.statistics, /1st.*serve.*won|first.*serve.*won/i, side, hit.key));
      const f2 = frac(statValue(m.statistics, /2nd.*serve.*won|second.*serve.*won/i, side, hit.key));
      const spw = (f1.of || f2.of) ? ((f1.won || 0) + (f2.won || 0)) / ((f1.of || 0) + (f2.of || 0)) : null;
      const svGmsStat = num(statValue(m.statistics, /service games (played|won)/i, side, hit.key));
      return { date: (m.event_date || '').slice(0, 10), surface: inferSurface(m.tournament_name),
        aces, svGms: svGmsStat || svGmsFromScores(m), servePtsWonPct: spw, minutes: null };
    }).filter((x) => x.svGms);
    recentCache.set(hit.key, { at: Date.now(), rows });
    return rows;
  }

  async function probe(name) {
    const hit = await resolveId(name);
    if (!hit) return { error: `could not resolve "${name}"` };
    const fx = await get({ method: 'get_fixtures', player_key: hit.key,
      date_start: iso(Date.now() - windowDays * 864e5), date_stop: iso(Date.now()) });
    const done = (Array.isArray(fx) ? fx : []).find((m) => /finish/i.test(m.event_status || ''));
    return { resolved: hit, sampleStatistics: done?.statistics || null, sampleScores: done?.scores || null };
  }

  return { fetchRecentMatches, resolveId, probe };
}

export default { makeApiTennisSource };
