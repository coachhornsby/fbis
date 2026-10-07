// tennisColdStart.mjs — when a player isn't in the Sackmann serve index (doubles specialists, ITF/
// Challenger players, newcomers), build the best profile we can from the Live Tennis API instead of
// giving up. FREE tier gives ranking + recent fixtures/results — enough for a real (if humble) read.
//
// Returns { player, coldStart } where player has: name, rank, and a synthetic surface profile derived
// from tour level + ranking. NO fabricated serve stats — we use tour-average serve rates scaled by
// rank, and FLAG the read as thin so the UI shows the honest disclaimer.

import { player as ltPlayer } from '../api/tennis/liveApi.mjs';

// Tour-average serve/return baselines by level (measured, ATP/WTA aggregate). A cold-start player
// gets these adjusted by ranking — better rank → slightly better hold. Bounded and clearly generic.
const TOUR_BASE = {
  ATP: { spw: 0.635, rpw: 0.365, ace: 0.06, df: 0.04 },   // serve pts won, return pts won, ace%, df%
  WTA: { spw: 0.585, rpw: 0.415, ace: 0.03, df: 0.055 },
  CH:  { spw: 0.630, rpw: 0.370, ace: 0.06, df: 0.045 },
  ITF: { spw: 0.610, rpw: 0.390, ace: 0.04, df: 0.05 },
};

// build a synthetic index-shaped profile from live bio + tour baseline
function syntheticProfile(name, rank, tour, surface) {
  const base = TOUR_BASE[tour] || TOUR_BASE.ATP;
  // rank nudge: top-50 slightly above baseline, 200+ slightly below. ±3% on serve, capped.
  const rankAdj = rank ? Math.max(-0.03, Math.min(0.03, (150 - rank) / 150 * 0.03)) : 0;
  const spw = base.spw + rankAdj;
  const prof = { name, rank: rank || null,
    surfaces: { ALL: { spw, rpw: base.rpw, acePct: base.ace, dfPct: base.df, winPct: 0.5, n: 0 } },
    recent: {}, _synthetic: true };
  // mirror to the requested surface so the projector finds it
  if (surface) prof.surfaces[surface] = { ...prof.surfaces.ALL };
  return prof;
}

// Try to enrich a cold-start player via the Live Tennis API. `known` is whatever resolve() found
// (may be a bare {name}). Returns { player, coldStart, liveSource }.
export async function resolveWithColdStart(liveEnabled, known, rawName, ctx = {}) {
  // already a full index player → not cold
  if (known && known.surfaces && (known.surfaces.ALL?.n || 0) > 0) {
    return { player: known, coldStart: false };
  }
  const name = (known && known.name) || rawName || '';
  const surface = ctx.surface || 'Hard';
  const tour = ctx.tour || 'ATP';

  // FREE-tier live lookup: search the player to get rank + tour, then synthesize a profile.
  if (liveEnabled) {
    try {
      // liveApi doesn't expose search yet in this build; if a live id was passed, fetch bio.
      if (ctx.liveId) {
        const bio = await ltPlayer(ctx.liveId);
        if (bio && bio.name) {
          const prof = syntheticProfile(bio.name, bio.ranking, (bio.tour || tour).toUpperCase().slice(0, 3), surface);
          prof.id = String(ctx.liveId);
          return { player: prof, coldStart: true, liveSource: 'livetennisapi' };
        }
      }
    } catch { /* fall through to bare synthetic */ }
  }

  // No live data → still give a synthetic tour-baseline profile so the match is READABLE (thin),
  // rather than erroring out. The read will carry the cold-start disclaimer.
  const prof = syntheticProfile(name, known?.rank || ctx.rank || null, tour, surface);
  return { player: prof, coldStart: true, liveSource: null };
}

export default { resolveWithColdStart };
