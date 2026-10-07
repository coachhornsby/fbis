// Canonical FBIS Tennis match observation contract.
// Source adapters must map observed fields explicitly; null means not observed, never imputed.
const n=(v)=>{ if(v==null||v==='') return null; const x=Number(v); return Number.isFinite(x)?x:null; };
const iso=(v)=>{ const s=String(v||''); return /^\d{8}$/.test(s)?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:s||null; };
export function canonicalMatchObservation(x={}) {
  const side=(p={})=>({id:p.id==null?null:String(p.id),name:String(p.name||''),rank:n(p.rank),
    ace:n(p.ace),df:n(p.df),svpt:n(p.svpt),firstIn:n(p.firstIn),firstWon:n(p.firstWon),
    secondWon:n(p.secondWon),svGms:n(p.svGms),bpSaved:n(p.bpSaved),bpFaced:n(p.bpFaced)});
  const o={source:String(x.source||''),sourceMatchId:String(x.sourceMatchId||''),tournamentId:x.tournamentId==null?null:String(x.tournamentId),
    tournament:String(x.tournament||''),tournamentDate:iso(x.tournamentDate),matchDate:iso(x.matchDate||x.tournamentDate),
    surface:String(x.surface||'Unknown'),level:String(x.level||''),round:String(x.round||''),bestOf:n(x.bestOf),
    result:x.result||'winner_loser',score:String(x.score||''),winner:side(x.winner),loser:side(x.loser),
    observedAt:x.observedAt||iso(x.matchDate||x.tournamentDate),effectiveAt:x.effectiveAt||iso(x.matchDate||x.tournamentDate),
    ingestedAt:x.ingestedAt||null,sourceUpdatedAt:x.sourceUpdatedAt||null,
    provenance:x.provenance||{},transformations:Array.isArray(x.transformations)?x.transformations:[]};
  if(!o.source||!o.tournament||!o.winner.name||!o.loser.name) throw new Error('canonical tennis observation missing required identity');
  return o;
}
export function canonicalIdentity(o){
  const names=[o.winner.name,o.loser.name].map(s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).sort();
  const d=String(o.tournamentDate||o.matchDate||''); const season=d.slice(0,4);
  return [season,o.tournament.toLowerCase().trim(),o.round.toLowerCase().trim(),...names].join('|');
}
export function canonicalToMeltedRows(o){
  const score=String(o.score||''); let wg=0,lg=0,sets=0;
  if(!/W\/?O/i.test(score)) for(const t of score.replace(/\([^)]*\)/g,'').split(/\s+/)){const m=t.match(/^(\d+)-(\d+)$/);if(m){wg+=+m[1];lg+=+m[2];sets++;}}
  const stats=(p)=>['ace','df','svpt','firstIn','firstWon','secondWon','svGms','bpSaved','bpFaced'].every(f=>p[f]!=null);
  const base={date:o.matchDate||o.tournamentDate,tourney:o.tournament,surface:o.surface,level:o.level,bestOf:o.bestOf||3,round:o.round,
    totalGames:wg+lg,retired:/RET|DEF/i.test(score),walkover:/W\/?O/i.test(score),source:o.source,sourceMatchId:o.sourceMatchId,canonicalIdentity:canonicalIdentity(o),datePrecision:o.provenance?.matchDatePrecision||'unknown'};
  const row=(p,q,won,games)=>({...base,won,playerId:p.id||p.name,playerName:p.name,oppId:q.id||q.name,oppName:q.name,playerRank:p.rank,oppRank:q.rank,gamesWon:games,
    hasStats:stats(p)&&stats(q),ace:p.ace,df:p.df,svpt:p.svpt,firstIn:p.firstIn,firstWon:p.firstWon,secondWon:p.secondWon,svGms:p.svGms,bpSaved:p.bpSaved,bpFaced:p.bpFaced,
    oppAce:q.ace,oppSvpt:q.svpt,oppFirstWon:q.firstWon,oppSecondWon:q.secondWon,oppSvGms:q.svGms,oppBpFaced:q.bpFaced,oppBpSaved:q.bpSaved});
  return [row(o.winner,o.loser,1,wg),row(o.loser,o.winner,0,lg)];
}
export default {canonicalMatchObservation,canonicalIdentity,canonicalToMeltedRows};
