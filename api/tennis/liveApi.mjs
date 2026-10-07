// api/tennis/liveApi.mjs — Live Tennis API adapter (FREE tier). Built to the documented v1 schema.
// Base: https://api.livetennisapi.com/api/public/v1  ·  auth: Authorization: Bearer <key>
// FREE endpoints used: /fixtures (upcoming board), /matches?status=live (in-play), /matches/{id}/score,
// /players/{id}. Limits 30/min, 100/day → cache hard.
//
// Env var in Vercel: `livetennisapi`.
//
// KEY SCHEMA FACTS (from docs v1.3.1):
//   - list endpoints return { data, meta }; single resources return the object directly
//   - match object: { id, tournament, tour, surface (hard|clay|grass), format (BO3|BO5),
//                     status, scheduled_time, players:{ p1:{name,...}, p2:{name,...} }, score }
//   - score is player-major: sets=[p1,p2], games=[[p1 per-set],[p2 per-set]], points=["40","AD"]
//   - tour vocabulary: atp|wta|challenger|itf|juniors

const BASE = 'https://api.livetennisapi.com/api/public/v1';
const KEY = () => process.env.livetennisapi || process.env.LIVETENNISAPI_KEY || '';

const CACHE = globalThis.__ltapiCache || (globalThis.__ltapiCache = new Map());
const cached = async (k, ttl, fn) => {
  const hit = CACHE.get(k);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn(); CACHE.set(k, { t: Date.now(), v }); return v;
};

async function api(path, ttl = 60000) {
  const key = KEY();
  if (!key) throw new Error('livetennisapi key missing (env `livetennisapi`)');
  return cached(`GET ${path}`, ttl, async () => {
    const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (r.status === 429) throw new Error('livetennisapi rate-limited (100/day free)');
    if (r.status === 401) throw new Error('livetennisapi unauthorized — check key');
    if (r.status === 403) throw new Error('livetennisapi upgrade_required (paid endpoint)');
    if (!r.ok) throw new Error(`livetennisapi ${r.status}`);
    return r.json();
  });
}

const surfaceOf = (s) => {
  const x = (s || '').toString().toLowerCase();
  if (x.startsWith('clay')) return 'Clay';
  if (x.startsWith('grass')) return 'Grass';
  if (x.startsWith('carpet')) return 'Carpet';
  if (x.startsWith('hard')) return 'Hard';
  return s ? s[0].toUpperCase() + s.slice(1) : 'Hard';
};
const tourOf = (t) => {
  const x = (t || '').toString().toLowerCase();
  if (x === 'wta') return 'WTA';
  if (x === 'atp') return 'ATP';
  if (x === 'itf') return 'ITF';
  if (x === 'challenger') return 'CH';
  if (x.startsWith('juniors')) return 'ITF';
  return (t || '').toString().toUpperCase();
};

// map one documented match object → the shape the frontend controller expects
export function mapMatch(m) {
  const players = m.players || {};
  const p1 = players.p1 || players.player_1 || {};
  const p2 = players.p2 || players.player_2 || {};
  return {
    matchId: String(m.id ?? m.match_id ?? ''),
    playerA: p1.name || '',
    playerB: p2.name || '',
    playerAId: p1.id ?? null,
    playerBId: p2.id ?? null,
    startTime: m.scheduled_time || m.start_time || null,
    surface: surfaceOf(m.surface),
    tour: tourOf(m.tour),
    tournament: m.tournament || '',
    bestOf: (m.format === 'BO5') ? 5 : 3,
    status: (m.status || '').toLowerCase(),
    source: 'livetennisapi',
  };
}

const listData = (j) => (Array.isArray(j) ? j : (j && j.data) || []);

// The BOARD: upcoming fixtures (the thing that was empty — /matches?status=live is only in-play NOW).
export async function upcomingFixtures({ tour } = {}) {
  const q = tour ? `?tour=${encodeURIComponent(tour)}` : '';
  const j = await api(`/fixtures${q}`, 5 * 60000);
  return listData(j).map(mapMatch).filter((m) => m.playerA && m.playerB);
}

// In-play matches right now
export async function liveMatches({ tour } = {}) {
  const q = `?status=live${tour ? `&tour=${encodeURIComponent(tour)}` : ''}`;
  const j = await api(`/matches${q}`, 30000);
  return listData(j).map(mapMatch).filter((m) => m.playerA && m.playerB);
}

// Board = live (in-play) + upcoming fixtures, deduped. This is what schedule.mjs calls.
export async function board() {
  const [live, up] = await Promise.all([
    liveMatches().catch(() => []),
    upcomingFixtures().catch(() => []),
  ]);
  const seen = new Set(); const out = [];
  for (const m of [...live, ...up]) {
    const k = m.matchId || `${m.playerA}|${m.playerB}`;
    if (seen.has(k)) continue; seen.add(k); out.push(m);
  }
  return out;
}

// GET /matches/{id}/score — player-major score snapshot
export async function matchScore(id) {
  const j = await api(`/matches/${encodeURIComponent(id)}/score`, 15000);
  return { sets: j.sets || null, games: j.games || null, points: j.points || null,
    server: j.server ?? null, isTiebreak: !!j.is_tiebreak, ts: j.timestamp || null };
}

// GET /players/{id} — bio + ranking + cached stats (context source)
export async function player(id) { return api(`/players/${encodeURIComponent(id)}`, 3600000); }

export default { board, liveMatches, upcomingFixtures, matchScore, player, mapMatch };
