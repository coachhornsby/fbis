// api/tennis/schedule.mjs — the board. Multi-source with auto-failover:
//   1) Live Tennis API (primary — free tier, clean board)   ← NEW
//   2) api-tennis.com (APITENNIS_KEY)
//   3) OddsPapi (ODDSPAPI_KEY, quota-limited fallback)
// Returns matches[] in the shape the frontend controller expects. 30-min in-memory cache.

import { board } from './liveApi.mjs';

const CACHE = globalThis.__schedCache || (globalThis.__schedCache = { t: 0, v: null });
const CACHE_MS = 30 * 60 * 1000;

// cross-reference live PrizePicks names to flag which matches have PP props
async function hasPPSet(origin) {
  try {
    const r = await fetch(`${origin}/api/tennis/prizepicks?debug=1`, { cache: 'no-store' });
    if (!r.ok) return new Set();
    const j = await r.json();
    const names = new Set();
    // the endpoint returns { players: { key: {name, opponent, ...} } } — read that shape
    const players = j.players || {};
    for (const [, p] of Object.entries(players)) {
      for (const nm of [p.name, p.opponent]) {
        if (nm) names.add(String(nm).toLowerCase().split(' ').pop());   // last name
      }
    }
    return names;
  } catch { return new Set(); }
}

async function fromApiTennis() {
  const key = process.env.APITENNIS_KEY;
  if (!key) return [];
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const r = await fetch(`https://api.api-tennis.com/tennis/?method=get_fixtures&APIkey=${key}&date_start=${today}&date_stop=${end}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.result || []).map((m) => ({
    matchId: String(m.event_key), playerA: m.event_first_player, playerB: m.event_second_player,
    startTime: `${m.event_date}T${m.event_time || '00:00'}:00Z`,
    surface: /clay/i.test(m.tournament_name) ? 'Clay' : /grass/i.test(m.tournament_name) ? 'Grass' : 'Hard',
    tour: /wta/i.test(m.tournament_name) ? 'WTA' : /itf/i.test(m.tournament_name) ? 'ITF' : 'ATP',
    tournament: m.tournament_name, bestOf: 3, status: (m.event_status || '').toLowerCase(), source: 'apitennis',
  })).filter((m) => m.playerA && m.playerB);
}


// Build board matches directly from PrizePicks, so EVERY PP tennis matchup is analyzable even if the
// live-API schedule missed it. Dedupes A-vs-B and B-vs-A into one match. Singles only (engine can't
// read doubles). This guarantees "if PrizePicks lists it, Lyrid shows it."
async function fromPrizePicks(origin) {
  try {
    const r = await fetch(`${origin}/api/tennis/prizepicks?debug=1`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    const players = j.players || {};
    const seen = new Set(); const out = [];
    for (const [, p] of Object.entries(players)) {
      const a = p.name || '', b = p.opponent || '';
      if (!a || !b) continue;
      if (a.includes(' / ') || b.includes(' / ')) continue;         // drop doubles
      const key = [a.toLowerCase(), b.toLowerCase()].sort().join('|');
      if (seen.has(key)) continue; seen.add(key);
      out.push({
        matchId: 'pp-' + key.replace(/[^a-z]/g, '').slice(0, 24),
        playerA: a, playerB: b,
        startTime: p.startTime || null,
        surface: p.surface || 'Hard',                                // PP doesn't give surface; default Hard
        tour: /\b(wta|women)\b/i.test(p.league || '') ? 'WTA' : 'ATP',
        tournament: p.tournament || '', bestOf: 3,
        hasPP: true, ppStats: Object.keys(p.stats || {}),            // which markets PP offers here
        source: 'prizepicks',
      });
    }
    return out;
  } catch { return []; }
}

export default async function handler(req, res) {
  try {
    if (CACHE.v && Date.now() - CACHE.t < CACHE_MS) {
      res.status(200).json({ ok: true, cached: true, count: CACHE.v.length, matches: CACHE.v });
      return;
    }
    const origin = `https://${req.headers.host}`;
    let matches = [];
    let source = 'none';

    // 1) Live Tennis API — primary. board() = live in-play + upcoming fixtures.
    try {
      const b = await board();
      if (b.length) { matches = b; source = 'livetennisapi'; }
    } catch (e) { /* fall through to api-tennis */ }

    // 2) api-tennis.com fallback
    if (!matches.length) {
      try { const at = await fromApiTennis(); if (at.length) { matches = at; source = 'apitennis'; } } catch {}
    }

    // Merge in EVERY PrizePicks matchup so the board = everything PP supports (the user's ask).
    try {
      const ppMatches = await fromPrizePicks(origin);
      if (ppMatches.length) {
        // prefer PP entries (they carry ppStats); add live-API matches PP didn't have
        const ppKeys = new Set(ppMatches.map((m) => [m.playerA.toLowerCase(), m.playerB.toLowerCase()].sort().join('|')));
        const extra = matches.filter((m) => !ppKeys.has([(m.playerA||'').toLowerCase(), (m.playerB||'').toLowerCase()].sort().join('|')));
        matches = [...ppMatches, ...extra];
        if (source === 'none' || !matches.length) source = 'prizepicks';
        else source = source + '+prizepicks';
      }
    } catch {}

    // dedupe by matchId, rank tour-level above ITF but keep ITF (cold-start reads them)
    const seen = new Set();
    matches = matches.filter((m) => { const k = m.matchId || `${m.playerA}|${m.playerB}`; if (seen.has(k)) return false; seen.add(k); return true; });
    // DROP DOUBLES: the engine models singles serve/return/hold dynamics — doubles has four servers
    // and different scoring, so a singles read would be dishonest. PrizePicks tennis is ~all singles
    // anyway. A doubles team comes through as "A / B" in a player slot.
    const isDoubles = (m) => (m.playerA || '').includes(' / ') || (m.playerB || '').includes(' / ');
    matches = matches.filter((m) => !isDoubles(m));

    const tierRank = { ATP: 0, WTA: 0, CH: 1, ITF: 2 };
    matches.sort((a, b) => (tierRank[a.tour] ?? 3) - (tierRank[b.tour] ?? 3));

    // flag PP availability
    const pp = await hasPPSet(origin);
    for (const m of matches) {
      m.hasPP = pp.has((m.playerB || '').toLowerCase().split(' ').pop()) || pp.has((m.playerA || '').toLowerCase().split(' ').pop());
    }

    CACHE.t = Date.now(); CACHE.v = matches;
    res.status(200).json({ ok: true, source, count: matches.length, matches });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e), matches: CACHE.v || [] });
  }
}
