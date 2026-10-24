/**
 * Private noncommercial Tennis research only. No automatic download, database
 * mutation, price joins, executable contracts, or model-authorization output.
 * Input rows must originate from a separately vetted, user-provided research file.
 */
export const SACKMANN_RESEARCH_SOURCE='SACKMANN_CC_BY_NC_SA_4_0_RESEARCH';
const safeDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))&&Number.isFinite(Date.parse(v+'T00:00:00Z'));
const player=v=>/^\d{1,12}$/.test(String(v||''))?String(v):null;
const integer=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isInteger(Number(v))&&Number(v)>=0?Number(v):null;
const pct=(n,d)=>d>0?n/d:null;
export function summarizePrivateSackmannResearch(rows,{tour,asOf}={}){
 if(!['atp','wta'].includes(tour)||!safeDate(asOf))throw Error('TOUR_AND_RESEARCH_CUTOFF_REQUIRED');
 if(!Array.isArray(rows))throw Error('RESEARCH_ROWS_REQUIRED');
 const summary=new Map(),seen=new Set(),blocked={};let accepted=0;
 const drop=reason=>blocked[reason]=(blocked[reason]||0)+1;
 const ordered=[...rows].sort((a,b)=>String(a.tourney_date).localeCompare(String(b.tourney_date))||
  String(a.match_num).localeCompare(String(b.match_num)));
 for(const r of ordered){
  const dt=String(r.tourney_date||'');
  if(!/^\d{8}$/.test(dt)){drop('DATE_INVALID');continue}
  const day=dt.slice(0,4)+'-'+dt.slice(4,6)+'-'+dt.slice(6,8);
  if(!safeDate(day)||day>=asOf){drop('NOT_PRE_CUTOFF');continue}
  const w=player(r.winner_id),l=player(r.loser_id);
  if(!w||!l||w===l){drop('IDENTITY_INVALID');continue}
  const event=[tour,r.tourney_id,r.match_num,dt,w,l].join('|');
  if(!r.tourney_id||r.match_num==null||seen.has(event)){drop('DUPLICATE_OR_EVENT_ID_MISSING');continue}
  const surface=String(r.surface||'').toLowerCase();
  if(!['hard','clay','grass','carpet'].includes(surface)){drop('SURFACE_UNKNOWN');continue}
  seen.add(event);
  for(const [id,won,svpt,firstIn,firstWon,secondWon] of [
   [w,true,r.w_svpt,r.w_1stIn,r.w_1stWon,r.w_2ndWon],
   [l,false,r.l_svpt,r.l_1stIn,r.l_1stWon,r.l_2ndWon]]){
    const key=id+'|'+surface,entry=summary.get(key)||{playerId:id,surface,matches:0,wins:0,
      servicePoints:0,firstIn:0,firstWon:0,secondWon:0,serveStatMatches:0};
    entry.matches++;entry.wins+=Number(won);
    const vals=[svpt,firstIn,firstWon,secondWon].map(integer);
    if(vals.every(v=>v!==null)&&vals[1]<=vals[0]&&vals[2]<=vals[1]&&
      vals[3]<=vals[0]-vals[1]){
      entry.servicePoints+=vals[0];entry.firstIn+=vals[1];entry.firstWon+=vals[2];
      entry.secondWon+=vals[3];entry.serveStatMatches++;
    }
    summary.set(key,entry);
  }
  accepted++;
 }
 return {tour,asOf,accepted,blocked,
  playerSurfaces:[...summary.values()].map(v=>({...v,winRate:pct(v.wins,v.matches),
   firstServeInRate:pct(v.firstIn,v.servicePoints),
   firstServePointsWon:pct(v.firstWon,v.firstIn),
   secondServePointsWon:pct(v.secondWon,v.servicePoints-v.firstIn)})),
  source:SACKMANN_RESEARCH_SOURCE,license:'CC BY-NC-SA 4.0',
  attribution:'Jeff Sackmann tennis_atp / tennis_wta',
  privateResearchOnly:true,forContractTrading:false,
  canQualify:false,canAuthorizeWager:false,commercialUseAuthorized:false};
}
