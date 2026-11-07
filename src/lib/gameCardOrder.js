// Presentation only: no orders, model authority, account reads, or network calls.
export const WAGER_MARKS_KEY='fbis-existing-wager-games-v1';
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'});
export function wagerGameKey(game){
 const start=Date.parse(game?.start),sport=String(game?.sport||'').toLowerCase(),id=String(game?.id||'');
 if(!sport||!id||!Number.isFinite(start))return null;
 return sport+'|'+day.format(new Date(start))+'|'+id;
}
export function hasLinkedWager(game){
 const bets=Array.isArray(game?.myBets)?game.myBets:game?.myBet?[game.myBet]:[];
 return bets.some(b=>b&&String(b.gameId)===String(game.id)&&(!b.sport||String(b.sport).toLowerCase()===String(game.sport).toLowerCase())&&b.isSimulation!==true&&b.simulated!==true&&b.mode!=='paper'&&b.population!=='strategy');
}
export function hasRecordedWager(game,marked=new Set()){
 const key=wagerGameKey(game);return hasLinkedWager(game)||Boolean(key&&marked.has(key));
}
export function gameStatusOrder(game){
 const status=String(game?.status||'').toLowerCase();
 if(['live','in','in_progress','inprogress'].includes(status))return 0;
 if(['scheduled','upcoming','pre'].includes(status))return 1;
 if(['final','completed','complete','post'].includes(status))return 3;
 // Unverified, delayed or cancelled feeds are never guessed to be live/final.
 return 2;
}
export function sortGameCards(games,{marked=new Set()}={}){
 return [...games].sort((a,b)=>{
  const wager=Number(hasRecordedWager(b,marked))-Number(hasRecordedWager(a,marked));
  if(wager)return wager;
  const status=gameStatusOrder(a)-gameStatusOrder(b);if(status)return status;
  const at=Date.parse(a.start),bt=Date.parse(b.start);
  if(Number.isFinite(at)!==Number.isFinite(bt))return Number.isFinite(at)?-1:1;
  if(Number.isFinite(at)&&at!==bt)return at-bt;
  return String(a.sport).localeCompare(String(b.sport))||String(a.id).localeCompare(String(b.id));
 });
}
export function readWagerMarks(storage){
 try{const rows=JSON.parse(storage.getItem(WAGER_MARKS_KEY)||'[]');if(!Array.isArray(rows)||rows.length>500)return new Set();
 return new Set(rows.filter(s=>typeof s==='string'&&s.length<180&&/^[a-z]+\|\d{4}-\d{2}-\d{2}\|[^|]+$/.test(s)));}catch{return new Set();}
}
