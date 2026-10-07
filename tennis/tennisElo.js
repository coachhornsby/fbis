const START = 1500;
const SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];
const kFactor = (n) => 250 / Math.pow((n || 0) + 5, 0.4);
export const expectedScore = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

function update(map,winner,loser){
  if(!winner||!loser||winner===loser)return;
  const w=map.get(winner)||{r:START,n:0};
  const l=map.get(loser)||{r:START,n:0};
  const ew=expectedScore(w.r,l.r),el=1-ew;
  map.set(winner,{r:w.r+kFactor(w.n)*(1-ew),n:w.n+1});
  map.set(loser,{r:l.r+kFactor(l.n)*(0-el),n:l.n+1});
}

export function buildElo(rows=[]){
  const elo={overall:new Map(),bySurface:Object.fromEntries(SURFACES.map(s=>[s,new Map()]))};
  const seen=new Set();
  const ordered=(rows||[]).slice().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  for(const r of ordered){
    if(!r?.won||!r.playerId||!r.oppId||r.walkover)continue;
    const pair=[String(r.playerId),String(r.oppId)].sort().join('|');
    const key=[r.date||'',r.tourney||'',r.round||'',pair].join('|');
    if(seen.has(key))continue;seen.add(key);
    update(elo.overall,String(r.playerId),String(r.oppId));
    const s=SURFACES.includes(r.surface)?r.surface:'Hard';
    update(elo.bySurface[s],String(r.playerId),String(r.oppId));
  }
  return elo;
}

export function eloToJSON(elo){
  const obj=(m)=>Object.fromEntries([...m.entries()].map(([id,v])=>[id,{r:Math.round(v.r*1000)/1000,n:v.n}]));
  return {overall:obj(elo?.overall||new Map()),bySurface:Object.fromEntries(SURFACES.map(s=>[s,obj(elo?.bySurface?.[s]||new Map())]))};
}

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
export default { buildElo, eloToJSON, surfaceElo, eloWinProb, expectedScore, eloFromJSON };
