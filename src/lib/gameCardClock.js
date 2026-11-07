// ESPN's last reported game state, never a client-side countdown.
export function liveGameLabel(game){
 if(game?.status!=='live')return null;
 const detail=String(game.statusDetail||'').trim();
 if(detail&&!/^(live|in[ -]?progress|game in progress|status_in_progress)$/i.test(detail))return detail;
 const p=Number(game.statusPeriod),clock=String(game.statusClock||'').trim();
 const period=Number.isInteger(p)&&p>0?p:null;
 const validClock=/^\d{1,3}:\d{2}(?:\.\d+)?$/.test(clock)?clock:null;
 let label=null;
 if(period){
  if(['nba','nfl','cfb'].includes(game.sport))label=period<=4?'Q'+period:(period===5?'OT':(period-4)+'OT');
  else if(game.sport==='cbb')label=period<=2?'Half '+period:(period===3?'OT':(period-2)+'OT');
  else if(game.sport==='nhl')label=period<=3?'Period '+period:(period===4?'OT':(period-3)+'OT');
  else if(game.sport==='mlb')label='Inning '+period;
  else if(['atp','wta','tennis'].includes(game.sport))label='Set '+period;
 }
 const timed=!['mlb','atp','wta','tennis'].includes(game.sport);
 return [label,timed?validClock:null].filter(Boolean).join(' · ')||'Live · game time unavailable';
}
