// tennisMatchstat.mjs — live-stats source adapter for Matchstat's Tennis API (RapidAPI).
// Feeds tennisLiveAugment: resolves a player name -> Matchstat id, pulls recent matches with
// per-match serve stats + surface, and maps them to the RecentMatch shape the augmenter expects.
//   RecentMatch = { date, surface, aces, svGms, servePtsWonPct, minutes }
//
// Wire in analyze.mjs via augmentMatchup(makeMatchstatSource({apiKey}), A, B).
// Needs a RapidAPI key for "Tennis API - ATP WTA ITF" in env (MATCHSTAT_KEY). Quota-cached.
//
// Verified against the official docs (tennisapidoc.matchstat.com). The ONE field set not shown in
// the docs is the per-match `stat` object shape — mapStat() reads the documented aggregated field
// names defensively and falls back gracefully (form just won't refresh) if they differ. If aces come
// back null, call probe(name) once and adjust mapStat to the real keys.

const HOST = 'tennis-api-atp-wta-itf.p.rapidapi.com';
const BASE = `https://${HOST}/tennis/v2`;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function makeMatchstatSource({ apiKey, ttlMs = 6 * 3600e3 } = {}) {
  const headers = { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': HOST };
  const get = async (path) => {
    const r = await fetch(`${BASE}/${path}`, { headers });
    if (!r.ok) throw new Error(`Matchstat ${path.split('?')[0]} -> HTTP ${r.status}`);
    return r.json();
  };
  const asList = (x) => (Array.isArray(x) ? x : x?.data || []);

  let idMap = null;                 // normalized name -> { id, tour }
  const recentCache = new Map();    // id -> { at, rows }

  async function buildIdMap() {
    idMap = new Map();
    for (const tour of ['atp', 'wta']) {
      try {
        const list = asList(await get(`${tour}/player?pageSize=500&pageNo=1`));
        for (const p of list) if (p?.name && p?.id != null) idMap.set(norm(p.name), { id: p.id, tour });
      } catch { /* leave partial */ }
    }
  }
  async function resolveId(name) {
    if (!idMap) await buildIdMap();
    const n = norm(name);
    if (idMap.has(n)) return idMap.get(n);
    // last-name + first-initial fallback (handles "A. Sasnovich" vs "Aliaksandra Sasnovich")
    const t = n.split(/\s+/), last = t[t.length - 1], fi = (t[0] || ' ')[0];
    for (const [k, v] of idMap) { const kt = k.split(/\s+/); if (kt[kt.length - 1] === last && (kt[0] || ' ')[0] === fi) return v; }
    return null;
  }

  const surfaceOf = (m) => {
    const c = m.tournament?.court?.court ?? m.tournament?.court ?? '';
    if (/clay/i.test(c)) return 'Clay';
    if (/grass/i.test(c)) return 'Grass';
    return 'Hard';
  };
  // service games per player ~ total games / 2 (each player serves ~half). Robust; from the score.
  function svGmsFromScore(result) {
    let tot = 0;
    for (const s of String(result || '').replace(/\([^)]*\)/g, '').split(/\s+/)) {
      const m = s.match(/^(\d+)-(\d+)$/); if (m) tot += (+m[1]) + (+m[2]);
    }
    return tot ? tot / 2 : null;
  }
  // per-match serve stats. Uses the documented aggregated field names (acesGm, firstServeOfGm = total
  // service points, winningOnFirst/SecondServeGm). Falls back to null if the per-match shape differs.
  function mapStat(stat) {
    if (!stat) return { aces: null, spw: null };
    const s = stat.serviceStats || stat.service || stat;
    const aces = num(s.acesGm ?? s.aces ?? s.ace);
    const svpt = num(s.firstServeOfGm ?? s.servePoints ?? s.svpt);
    const won = (num(s.winningOnFirstServeGm) || 0) + (num(s.winningOnSecondServeGm) || 0);
    const spw = svpt ? won / svpt : null;
    return { aces, spw };
  }

  async function fetchRecentMatches(name) {
    const hit = await resolveId(name);
    if (!hit) return [];
    const cached = recentCache.get(hit.id);
    if (cached && Date.now() - cached.at < ttlMs) return cached.rows;
    let res;
    try { res = asList(await get(`${hit.tour}/player/past-matches/${hit.id}?include=tournament.court,stat&pageSize=12`)); }
    catch { return []; }
    const rows = res.map((m) => {
      const { aces, spw } = mapStat(m.stat);
      return { date: (m.date || '').slice(0, 10), surface: surfaceOf(m),
        aces, svGms: svGmsFromScore(m.result), servePtsWonPct: spw, minutes: null };
    }).filter((x) => x.svGms);
    recentCache.set(hit.id, { at: Date.now(), rows });
    return rows;
  }

  // Run once if aces come back null — dumps a raw match+stat so the field names can be confirmed.
  async function probe(name) {
    const hit = await resolveId(name);
    if (!hit) return { error: `could not resolve "${name}"` };
    const res = asList(await get(`${hit.tour}/player/past-matches/${hit.id}?include=tournament.court,stat&pageSize=1`));
    return { resolved: hit, sample: res[0] || null };
  }

  return { fetchRecentMatches, resolveId, probe };
}

export default { makeMatchstatSource };
