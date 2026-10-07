const START = 1500;
const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];
const kFactor = (n) => 250 / Math.pow((n || 0) + 5, 0.4);
export const expectedScore = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
const get=(m,id)=>m.get(id)||{r:START,n:0};
function update(m,a,b,scoreA){const A=get(m,a),B=get(m,b),e=expectedScore(A.r,B.r);const ka=kFactor(A.n),kb=kFactor(B.n);m.set(a,{r:A.r+ka*(scoreA-e),n:A.n+1});m.set(b,{r:B.r+kb*((1-scoreA)-(1-e)),n:B.n+1});}
export function buildElo(rows){
 const elo={overall:new Map(),bySurface:Object.fromEntries(SURFACES.map(s=>[s,new Map()]))};
 const seen=new Set(), sorted=rows.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 for(const r of sorted){if(!r.won||!r.playerId||!r.oppId||r.walkover)continue; const k=r.canonicalIdentity||[r.date,r.tourney,r.round,[r.playerId,r.oppId].sort().join('~')].join('|');if(seen.has(k))continue;seen.add(k);
   update(elo.overall,r.playerId,r.oppId,1); const s=SURFACES.includes(r.surface)?r.surface:null;if(s)update(elo.bySurface[s],r.playerId,r.oppId,1);
 } return elo;
}
export function eloToJSON(elo){return {overall:Object.fromEntries(elo.overall),bySurface:Object.fromEntries(SURFACES.map(s=>[s,Object.fromEntries(elo.bySurface[s]||[])]))};}
export function surfaceElo(elo, id, surface, kShrink = 20) {
  const o = elo.overall.get(id); const base = o ? o.r : START;
  const sm = elo.bySurface[surface]; const s = sm ? sm.get(id) : null;
  if (!s || !s.n) return base;
  return base + (s.n / (s.n + kShrink)) * (s.r - base);
}
export function eloWinProb(elo, idA, idB, surface) { return expectedScore(surfaceElo(elo,idA,surface),surfaceElo(elo,idB,surface)); }
export function eloFromJSON(j) {
  const elo = { overall: new Map(), bySurface: {} };
  for (const [id, v] of Object.entries(j?.overall || {})) elo.overall.set(id, v);
  for (const s of SURFACES) { elo.bySurface[s] = new Map(); for (const [id, v] of Object.entries(j?.bySurface?.[s] || {})) elo.bySurface[s].set(id, v); }
  return elo;
}
export default { buildElo, eloToJSON, surfaceElo, eloWinProb, expectedScore, eloFromJSON };
