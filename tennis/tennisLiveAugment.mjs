// tennisLiveAugment.mjs — keep reads current when the committed index is stale.
//
// The index carries deep serve/return baselines (slow-moving) plus a `recent` block (form/fatigue)
// frozen at build time. This module recomputes ONLY the recency-sensitive fields from a live pull of
// a player's latest completed matches — so form and fatigue reflect right now, even if you haven't
// rebuilt the index. Deep baselines stay from the index. Index = depth; live = recency.
//
// A "live source" is any adapter implementing:  fetchRecentMatches(playerNameOrId) -> RecentMatch[]
//   RecentMatch = { date:'YYYY-MM-DD', surface, aces, svGms, servePtsWonPct?, minutes }
// Plug your chosen source (api-tennis.com free tier, a scrape, etc.) behind that one function.

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400e3);

// Recompute the `recent` block (form deltas vs the index career baseline, fatigue, lastSurface)
// from live matches, as of `asOfDate` (default today) — so fatigue counts days since the ACTUAL
// upcoming match, not the last date in a stale index.
export function computeRecentFromLive(recentMatches, careerBaseline = {}, asOfDate = new Date().toISOString().slice(0, 10)) {
  const rec = (recentMatches || []).filter((m) => m.svGms).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!rec.length) return null;
  const last8 = rec.slice(-8);
  const careerAce = careerBaseline.acePerSvGm, careerServe = careerBaseline.servePtsWonPct;
  const win10 = rec.filter((m) => dayDiff(asOfDate, m.date) <= 10);
  return {
    formAce: careerAce != null ? (mean(last8.map((m) => m.aces / m.svGms)) - careerAce) : 0,
    formServe: careerServe != null
      ? ((mean(last8.map((m) => m.servePtsWonPct).filter((v) => v != null)) ?? careerServe) - careerServe) : 0,
    matchesLast10: win10.length,
    minutesLast10: win10.reduce((s, m) => s + (m.minutes || 0), 0),
    lastSurface: rec[rec.length - 1].surface,
    lastDate: rec[rec.length - 1].date,
    _source: 'live',
  };
}

// Return a copy of the index player with its `recent` block refreshed from live matches.
// Falls back to the index's own recent block if the live pull is empty.
export function augmentPlayer(indexPlayer, recentMatches, asOfDate) {
  if (!indexPlayer) return indexPlayer;
  const baseline = (indexPlayer.surfaces && indexPlayer.surfaces.ALL) || {};
  const fresh = computeRecentFromLive(recentMatches, baseline, asOfDate);
  return fresh ? { ...indexPlayer, recent: fresh } : indexPlayer;
}

// Convenience: augment both players via a live source adapter, then they're ready for buildMatchRead.
// `source.fetchRecentMatches` may be async.
export async function augmentMatchup(source, playerA, playerB, asOfDate) {
  const [ra, rb] = await Promise.all([
    source.fetchRecentMatches(playerA.name || playerA.id).catch(() => []),
    source.fetchRecentMatches(playerB.name || playerB.id).catch(() => []),
  ]);
  return { playerA: augmentPlayer(playerA, ra, asOfDate), playerB: augmentPlayer(playerB, rb, asOfDate) };
}

// ---- Adapter stub: wire your live source here. Example shape for api-tennis.com-style responses. ----
// Fill in the fetch + mapping; keep the returned RecentMatch shape. This is the ONLY source-specific code.
export function makeLiveSource({ apiKey, base } = {}) {
  return {
    async fetchRecentMatches(playerNameOrId) {
      if (!apiKey) return [];
      // TODO wire the real endpoint. Must return: [{date, surface, aces, svGms, servePtsWonPct?, minutes}]
      // Example: const r = await fetch(`${base}/player/recent?name=${...}&apiKey=${apiKey}`); ...map...
      return [];
    },
  };
}

export default { computeRecentFromLive, augmentPlayer, augmentMatchup, makeLiveSource };
