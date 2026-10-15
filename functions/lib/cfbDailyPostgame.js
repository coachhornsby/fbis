/** Daily CFBD ingestion planner. No network calls, market data, or model authority.
 * CFBD /games is seasonal; ensure the day partition is an actual Chicago game
 * date and completed status, not a relabel of all season finals.
 */
export function chicagoDate(value) {
 const t=Date.parse(String(value||""));
 if(!Number.isFinite(t))return null;
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(t));
 const part=type=>parts.find(p=>p.type===type)?.value;
 return `${part("year")}-${part("month")}-${part("day")}`;
}
const finite=v=>v==null||v===""||!Number.isFinite(Number(v))?null:Number(v);
export function cfbDailyFinals(rows,date) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error("INVALID_CT_PARTITION");
 return (Array.isArray(rows)?rows:[]).filter(g=>{
  const started=chicagoDate(g.startDate||g.start_time||g.startTime||g.kickoff);
  if(started!==date)return false;
  const final=g.completed===true||g.status==="completed"||g.status==="final"||
     g.status==="STATUS_FINAL"||g.status==="STATUS_FINAL_OVERTIME";
  const scores=finite(g.homePoints??g.home_points??g.homeScore)!=null&&
     finite(g.awayPoints??g.away_points??g.awayScore)!=null;
  if(!final||!scores)return false;
  const home=String(g.homeClassification||g.home_classification||"").toLowerCase();
  const away=String(g.awayClassification||g.away_classification||"").toLowerCase();
  if(home&&home!=="fbs"||away&&away!=="fbs")return false;
  return /^\d+$/.test(String(g.id||g.gameId||""));
 });
}
export function cfbDailyWeeks(finals,year) {
 const result=new Map();
 for(const g of finals){
  const week=Number(g.week);
  const seasonType=String(g.seasonType||g.season_type||"regular");
  if(!Number.isInteger(week)||week<0||week>25||
     !["regular","postseason"].includes(seasonType))continue;
  result.set(`${seasonType}:${week}`,{year,week,seasonType,classification:"fbs"});
 }
 return [...result.values()].slice(0,2);
}
export function cfbDailyBoxRows(rows,finals) {
 const ids=new Set(finals.map(g=>String(g.id||g.gameId)));
 const seen=new Set(),out=[];
 for(const row of Array.isArray(rows)?rows:[]){
  const id=String(row?.id||row?.gameId||"");
  if(!ids.has(id)||seen.has(id)||!Array.isArray(row?.teams)||row.teams.length!==2)continue;
  seen.add(id);out.push(row);
 }
 return out;
}
