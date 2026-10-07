const START = 1500;
const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];
const kFactor = (n) => 250 / Math.pow((n || 0) + 5, 0.4);
export const expectedScore = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
export function surfaceElo(elo, id, surface, kShrink = 20) {
  const o = elo.overall.get(id); const base = o ? o.r : START;
  const sm = elo.bySurface[surface]; const s = sm ? sm.get(id) : null;
  if (!s || !s.n) return base;
  return base + (s.n / (s.n + kShrink)) * (s.r - base);
}
export function eloWinProb(elo, idA, idB, surface) {
  return expectedScore(surfaceElo(elo, idA, surface), surfaceElo(elo, idB, surface));
}
export function eloFromJSON(j) {
  const elo = { overall: new Map(), bySurface: {} };
  for (const [id, v] of Object.entries(j?.overall || {})) elo.overall.set(id, v);
  for (const s of SURFACES) { elo.bySurface[s] = new Map();
    for (const [id, v] of Object.entries(j?.bySurface?.[s] || {})) elo.bySurface[s].set(id, v); }
  return elo;
}
export default { surfaceElo, eloWinProb, expectedScore, eloFromJSON };
