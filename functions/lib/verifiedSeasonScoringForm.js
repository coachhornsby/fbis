/**
 * Verified final-score team aggregates shared by NFL and CFB recovery.
 * Return the original pf/pa keys for CFB and pointsFor/pointsAgainst keys
 * used by NFL projectNflFormV0. Never synthesize a missing team's history.
 */
export function verifiedSeasonScoringForm(finals,id){
 if(!Array.isArray(finals)||!/^\d+$/.test(String(id)))return null;
 const relevant=finals.filter(f=>f.homeId===id||f.awayId===id);
 if(!relevant.length)return null;
 let pf=0,pa=0;
 for(const f of relevant){
  if(!Number.isFinite(f.homePoints)||!Number.isFinite(f.awayPoints)||f.homePoints<0||f.awayPoints<0||
    !Number.isFinite(Date.parse(f.start)))return null;
  pf+=f.homeId===id?f.homePoints:f.awayPoints;
  pa+=f.homeId===id?f.awayPoints:f.homePoints;
 }
 return {games:relevant.length,pf,pa,pointsFor:pf,pointsAgainst:pa,
  lastGameAt:relevant.map(f=>f.start).sort().at(-1)};
}
