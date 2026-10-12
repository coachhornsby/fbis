/**
 * Morning / late-afternoon FBIS slate completeness guard.
 * All supported FBIS sports are checked. ESPN independently verifies the
 * complete game schedule for MLB/NFL/NBA/NHL/WNBA; other league feeds report
 * SOURCE_UNVERIFIED rather than equating an empty FBIS board with no games.
 *
 * No paid provider requests, model promotion, bet selection, or wagering writes.
 */
const BASE = process.env.FBIS_BASE || "https://fbis-myz.pages.dev";
export const ENABLED_SPORTS = ["mlb","npb","kbo","nfl","cfb","cbb","nba","wnba","nhl","soccer"];
const ESPN = {
  mlb:"baseball/mlb",nfl:"football/nfl",nba:"basketball/nba",
  nhl:"hockey/nhl",wnba:"basketball/wnba",
};
const DAY_MS=86400000;
export function chicagoDate(iso){
  const time=Date.parse(iso);
  if(!Number.isFinite(time)) return null;
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date(time));
  const part=t=>parts.find(p=>p.type===t)?.value||"";
  return [part("year"),part("month"),part("day")].join("-");
}
export function utcStamp(date,offsetDays=0){
  const stamp=Date.parse(date+"T12:00:00Z");
  if(!Number.isFinite(stamp))throw Error("Invalid date "+date);
  return new Date(stamp+offsetDays*DAY_MS).toISOString().slice(0,10).replaceAll("-","");
}
export function missingScheduledIds(scheduled,board){
  const available=new Set((board||[]).map(g=>String(g.id||"")).filter(Boolean));
  return [...new Set((scheduled||[]).map(g=>String(g.id||"")).filter(Boolean))].filter(id=>!available.has(id));
}
export function checkCoverage(sport,board,scheduled=null){
  const games=Array.isArray(board)?board:[];
  const unmodeled=games.filter(g=>g.projection?.independent!==true);
  const duplicateIds=games.map(g=>String(g.id||"")).filter(Boolean).filter((id,i,a)=>a.indexOf(id)!==i);
  const missing=scheduled===null?[]:missingScheduledIds(scheduled,games);
  return {sport,boardGames:games.length,independentModels:games.length-unmodeled.length,
    unavailableModels:unmodeled.length,duplicateIds:[...new Set(duplicateIds)],
    sourceStatus:scheduled===null?"SOURCE_UNVERIFIED":"ESPN_VERIFIED",
    expectedGames:scheduled?.length??null,missingEventIds:missing,
    state:duplicateIds.length||missing.length?"INCOMPLETE":scheduled===null?"BOARD_ONLY":"COMPLETE"};
}
async function jsonGet(url,ms=65000){
  const r=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(ms)});
  if(!r.ok)throw Error("HTTP "+r.status+" "+new URL(url).pathname);
  const data=await r.json();
  if(typeof data!=="object"||!data)throw Error("invalid-json-object "+new URL(url).pathname);
  return data;
}
async function getBoard(sport,date){
  const url=new URL("/api/projections",BASE);
  url.searchParams.set("sport",sport);
  url.searchParams.set("date",date);
  url.searchParams.set("_slate_check",String(Date.now()));
  const data=await jsonGet(url.toString());
  if(data.ok!==true||!Array.isArray(data.games))throw Error(sport+" board bad contract: "+String(data.error||"missing games"));
  return data.games;
}
async function getEspnSchedule(sport,date){
  const route=ESPN[sport];
  if(!route)return null;
  const events=new Map();
  // The same Chicago calendar day can cross ESPN's UTC/Eastern date boundary.
  // Fetch previous, current and next-day scoreboards, filter starts in CT.
  for(const delta of [-1,0,1]){
    const url="https://site.api.espn.com/apis/site/v2/sports/"+route+
      "/scoreboard?dates="+utcStamp(date,delta)+"&limit=500";
    const data=await jsonGet(url,30000);
    if(!Array.isArray(data.events))throw Error("ESPN "+sport+" returned no events array");
    for(const e of data.events){
      if(!e?.id||chicagoDate(e.date)!==date)continue;
      events.set(String(e.id),{id:String(e.id),start:e.date,
        state:e.status?.type?.name||null});
    }
  }
  return [...events.values()].sort((a,b)=>String(a.start).localeCompare(String(b.start)));
}
async function boundedMap(items,fn,limit=3){
  let index=0;
  const results=Array(items.length);
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(index<items.length){const i=index++;results[i]=await fn(items[i]);}
  }));
  return results;
}
export async function auditDailySlate({date,sports=ENABLED_SPORTS,recovery=true}={}){
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date||"")) throw Error("date YYYY-MM-DD required");
  const detail=await boundedMap(sports,async sport=>{
    let expected=null;
    let sourceError=null;
    let board=[];
    let boardError=null;
    let attemptedFreeRecovery=false;
    try{expected=await getEspnSchedule(sport,date)}
    catch(e){sourceError=String(e?.message||e)}
    try{board=await getBoard(sport,date)}
    catch(e){boardError=String(e?.message||e)}
    let coverage=checkCoverage(sport,board,expected);
    if(recovery && !boardError && expected && coverage.missingEventIds.length){
      // The public slate path is cache-only for paid feeds; it may refresh free
      // source context. It must not create wager authority or initiate paid runs.
      attemptedFreeRecovery=true;
      try{
        const warm=new URL("/api/slate",BASE);
        warm.searchParams.set("sport",sport);
        warm.searchParams.set("date",date);
        await jsonGet(warm.toString());
        board=await getBoard(sport,date);
        coverage=checkCoverage(sport,board,expected);
      }catch(e){boardError="free-refresh-failed: "+String(e?.message||e)}
    }
    return {...coverage,sourceError,boardError,attemptedFreeRecovery,
      hasIndependentSource:Boolean(ESPN[sport])};
  },3);
  const errors=detail.flatMap(d=>[
    ...(d.boardError?[d.sport+":board:"+d.boardError]:[]),
    ...(d.sourceError&&d.hasIndependentSource?[d.sport+":source:"+d.sourceError]:[]),
    ...(d.missingEventIds.length?[d.sport+":missing:"+d.missingEventIds.join(",")]:[]),
    ...(d.duplicateIds.length?[d.sport+":duplicates:"+d.duplicateIds.join(",")]:[]),
  ]);
  return {ok:errors.length===0,date,checkedAt:new Date().toISOString(),
    gamesOnBoard:detail.reduce((s,d)=>s+d.boardGames,0),
    independentModels:detail.reduce((s,d)=>s+d.independentModels,0),
    sourceVerifiedSports:detail.filter(d=>d.sourceStatus==="ESPN_VERIFIED").length,
    unsupportedIndependentSourceSports:detail.filter(d=>d.sourceStatus==="SOURCE_UNVERIFIED"&&!d.hasIndependentSource).map(d=>d.sport),
    detail,errors};
}
function localToday(){
  return chicagoDate(new Date().toISOString());
}
if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1]).href){
  const date=process.env.SLATE_DATE||localToday();
  const report=await auditDailySlate({date});
  console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import("node:fs");
    const rows=report.detail.map(d=>`| ${d.sport.toUpperCase()} | ${d.boardGames} | ${d.expectedGames??"Not independently verified"} | ${d.independentModels} | ${d.state} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      "## FBIS daily slate coverage — "+date,
      "| Sport | Board games | Independent-source games | Modeled | Status |",
      "|---|---:|---:|---:|---|",...rows,
      "",report.errors.length?"Missing/unverified: "+report.errors.join("; "):"Independent-source checks passed where supported.",
      "No model promotion, paid data acquisition or wager authorization was performed.",""
    ].join("\\n"));
  }
  if(!report.ok)process.exitCode=1;
}
