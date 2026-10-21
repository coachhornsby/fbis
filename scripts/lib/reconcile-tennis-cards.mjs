// Read-only reconciliation. A name/time match diagnoses coverage; it never proves an official fixture.
const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const name=x=>typeof x==='string'?x:x?.name||x?.fullName||x?.displayName||null;
const tour=x=>{const s=String(x||'').toLowerCase();return /\bwta\b/.test(s)?'wta':/\batp\b/.test(s)?'atp':null;};
const ms=x=>{const t=Date.parse(x||'');return Number.isFinite(t)?t:null;};
export function reconcileTennisCards(games=[],fixtures=[]){
 const rows=[];
 for(const g of games){
  const a=name(g.away)||g.away_name||g.player1||null,b=name(g.home)||g.home_name||g.player2||null;
  const t=tour(g.tour)||tour(g.league)||tour(g.competition)||tour(g.id);
  const start=ms(g.start||g.startTime||g.eventStartTime);
  let reason=null,matches=[];
  if(!t||!norm(a)||!norm(b)||norm(a)===norm(b)||start==null)reason='BOARD_IDENTITY_OR_TIME_INCOMPLETE';
  else matches=fixtures.filter(f=>{
   const ft=tour(f.tour),time=ms(f.start);
   if(ft!==t||time==null||Math.abs(time-start)>3*60*60*1000)return false;
   const x=norm(f.player1),y=norm(f.player2);
   return (x===norm(a)&&y===norm(b))||(x===norm(b)&&y===norm(a));
  });
  if(!reason)reason=matches.length===1?(matches[0].available?'OFFICIAL_PROJECTION_AVAILABLE':'OFFICIAL_PROJECTION_BLOCKED'):matches.length?'AMBIGUOUS_OFFICIAL_MATCH':'NO_MATCHING_OFFICIAL_FIXTURE';
  rows.push({boardId:String(g.id||''),tour:t,players:[a,b],start:g.start||g.startTime||g.eventStartTime||null,status:reason,officialEventId:matches.length===1?matches[0].eventId:null,blockedReason:matches.length===1?matches[0].blockedReason:null});
 }
 const byStatus={};for(const r of rows)byStatus[r.status]=(byStatus[r.status]||0)+1;
 return {boardCards:rows.length,byStatus,rows,researchOnly:true,canAuthorizeWager:false};
}
