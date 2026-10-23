// Tennis lower-tier historical source audit. RESEARCH ONLY.
// Name matching identifies candidates for manual source-ID verification; never auto-link.
export const normalizeName=(v)=>String(v??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++}else if(ch==='"')quoted=false;else field+=ch}
  else if(ch==='"')quoted=true;else if(ch===','){row.push(field);field=''}else if(ch==='\n'){row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field=''}else if(ch!=='\r')field+=ch;
 }
 if(field!==''||row.length){row.push(field);rows.push(row)}
 const header=rows.shift()||[];
 if(!header.includes('winner_id')||!header.includes('loser_id')||!header.includes('tourney_date'))
  throw Error('SOURCE_CSV_REQUIRED_COLUMNS_MISSING');
 return rows.map(r=>Object.fromEntries(header.map((k,i)=>[k,r[i]??''])));
}
const statKeys=['svpt','1stIn','1stWon','2ndWon','ace','df','SvGms','bpSaved','bpFaced'];
export const numeric=(v)=>{
 if(v===null||v===undefined||(typeof v==='string'&&v.trim()===''))return null;
 const x=Number(v);return Number.isFinite(x)?x:null;
};
export function hasValidTwoSidedServeStats(r){
 for(const s of ['w','l']){
  const v=Object.fromEntries(statKeys.map(k=>[k,numeric(r[s+'_'+k])]));
  if(Object.values(v).some(x=>x===null||x<0)||v.svpt<=0||v.SvGms<=0||
   v['1stIn']>v.svpt||v['1stWon']>v['1stIn']||
   v['2ndWon']>v.svpt-v['1stIn']||v.ace>v.svpt||
   v.df>v.svpt||v.bpSaved>v.bpFaced)return false;
 }
 return true;
}
export function sourceSurface(value){
 const s=String(value??'').toLowerCase();
 if(s==='hard'||s==='clay'||s==='grass')return s;
 return null; // Never silently turn carpet or unknown surface into hard.
}
export const sources=[
 ...[2024,2025,2026].flatMap(year=>[
  {tour:'atp',year,tier:'ATP_QUAL_CHALL',path:`atp/atp_matches_qual_chall_${year}.csv`},
  {tour:'atp',year,tier:'ATP_FUTURES',path:`atp/atp_matches_futures_${year}.csv`},
  {tour:'wta',year,tier:'WTA_QUAL_ITF',path:`wta/wta_matches_qual_itf_${year}.csv`}
 ])
];
export function makeCandidateIndex(players){
 const index=new Map();
 for(const p of players){
  if(!p.missingHard&&!p.missingClay&&!p.missingGrass)continue;
  const key=String(p.tour)+'|'+normalizeName(p.playerName);
  if(!normalizeName(p.playerName))throw Error('EMPTY_COHORT_PLAYER_NAME');
  // Name collisions are ambiguous: no candidate is ever treated as a verified ID.
  if(index.has(key))throw Error('AMBIGUOUS_COHORT_NAME_COLLISION_'+key);
  index.set(key,{tour:p.tour,playerName:p.playerName,playerKey:p.playerKey,
   missingHard:Boolean(p.missingHard),missingClay:Boolean(p.missingClay),
   missingGrass:Boolean(p.missingGrass),sourceIds:new Set(),
   observed:new Set(),qualified:new Set(),sources:new Set(),bySurface:{hard:0,clay:0,grass:0},
   qualifiedBySurface:{hard:0,clay:0,grass:0}});
 }
 return index;
}
export function scanSource(index,meta,rows,cutoff){
 let seen=0,qualifying=0;
 for(const r of rows){
  const date=String(r.tourney_date||'');
  if(!/^\d{8}$/.test(date)||date>=cutoff)continue;
  const surface=sourceSurface(r.surface);
  if(!surface)continue;
  const matchId=[meta.tier,date,r.tourney_id||r.tourney_name||'',r.match_num||'',
    r.winner_id,r.loser_id,r.score||''].join('|');
  const valid=hasValidTwoSidedServeStats(r);
  for(const [side,name] of [['winner',r.winner_name],['loser',r.loser_name]]){
   const p=index.get(meta.tour+'|'+normalizeName(name));
   if(!p)continue;
   const key=matchId+'|'+p.playerKey;
   if(p.observed.has(key))continue;
   p.observed.add(key);p.bySurface[surface]++;p.sources.add(meta.tier);
   if(r[side+'_id'])p.sourceIds.add(String(r[side+'_id']));
   seen++;
   if(valid){p.qualified.add(key);p.qualifiedBySurface[surface]++;qualifying++}
  }
 }
 return {playerAppearances:seen,validTwoSidedServeAppearances:qualifying};
}
export function summarize(index,receipts){
 const players=[...index.values()].map(p=>({
  tour:p.tour,playerName:p.playerName,playerKey:p.playerKey,
  existingMissingSurfaces:['hard','clay','grass'].filter(s=>p['missing'+s[0].toUpperCase()+s.slice(1)]),
  candidateSourceIds:[...p.sourceIds].sort(),identityStatus:'NAME_MATCH_UNVERIFIED',
  observedMatches:p.observed.size,validServeMatches:p.qualified.size,
  bySurface:p.bySurface,validBySurface:p.qualifiedBySurface,sources:[...p.sources].sort(),
  // The actual minimum-3 per-surface requirement is separate from the all-surface smoothing of current engine.
  candidateThreeValidMatches:['hard','clay','grass'].some(s=>p.qualifiedBySurface[s]>=3),
 }));
 const result={
  source:'Jeff Sackmann/Tennis Abstract archive mirror',
  sourceLicense:'CC BY-NC-SA 4.0',scope:'PRIVATE_NONCOMMERCIAL_RESEARCH_ONLY',
  asOf:new Date().toISOString(),sourceReceipts:receipts,
  targets:players.length,
  summary:Object.fromEntries(['atp','wta'].map(t=>{const p=players.filter(x=>x.tour===t);return [t,{
   missingProfiles:p.length,anySourceHistory:p.filter(x=>x.observedMatches>0).length,
   anyValidServeHistory:p.filter(x=>x.validServeMatches>0).length,
   threeValidSameSurface:p.filter(x=>x.candidateThreeValidMatches).length
  }]})),
  players,identityUpdatesPerformed:0,productionWrites:0,
  canQualify:false,canAuthorizeWager:false,
  warning:'Exact-name matches are research candidates only. Low-tier competition differs from main-tour data; no player profiles or wagering permissions are updated.'
 };
 return result;
}
