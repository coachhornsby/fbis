/**
 * Morning / late-afternoon FBIS slate completeness guard.
 * All supported FBIS sports are checked. ESPN independently verifies the
 * complete game schedule for MLB/NFL/CFB/NBA/CBB/NHL; other league feeds report
 * SOURCE_UNVERIFIED rather than equating an empty FBIS board with no games.
 *
 * No paid provider requests, model promotion, bet selection, or wagering writes.
 */
const BASE = process.env.FBIS_BASE || "https://fbis-myz.pages.dev";
export const ENABLED_SPORTS = ["mlb","nfl","cfb","cbb","nba","nhl","tennis"];
const ESPN = {
  mlb:"baseball/mlb",nfl:"football/nfl",nba:"basketball/nba",
  nhl:"hockey/nhl",cfb:"football/college-football",cbb:"basketball/mens-college-basketball",
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
const MLB_TEAM_ALIASES={TB:"TBR",TBR:"TBR",CHW:"CWS",CWS:"CWS",WSH:"WSN",WAS:"WSN",WSN:"WSN",SF:"SFG",SFG:"SFG",SD:"SDP",SDP:"SDP",KC:"KCR",KCR:"KCR",AZ:"ARI",ARI:"ARI"};
export function normalizedScheduleTeam(value,sport){
  const raw=String(value||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"");
  return sport==="mlb"?(MLB_TEAM_ALIASES[raw]||raw):raw;
}
export function scheduleEventMatches(scheduled,boardEvent,sport){
  if(scheduled?.id && boardEvent?.id && String(scheduled.id)===String(boardEvent.id))return true;
  // MLB Stats IDs and ESPN IDs are different provider namespaces.
  if(sport!=="mlb")return false;
  const away=normalizedScheduleTeam(scheduled?.away,sport);
  const home=normalizedScheduleTeam(scheduled?.home,sport);
  const boardAway=normalizedScheduleTeam(boardEvent?.away?.abbr||boardEvent?.away?.abbreviation,sport);
  const boardHome=normalizedScheduleTeam(boardEvent?.home?.abbr||boardEvent?.home?.abbreviation,sport);
  const start=Date.parse(scheduled?.start||"");
  const boardStart=Date.parse(boardEvent?.start||"");
  return Boolean(away&&home&&away===boardAway&&home===boardHome&&
    Number.isFinite(start)&&Number.isFinite(boardStart)&&
    Math.abs(start-boardStart)<=90*60000);
}
export function missingScheduledIds(scheduled,board,sport=""){
  const games=board||[];
  return [...new Map((scheduled||[]).filter(g=>g?.id).map(g=>[String(g.id),g])).values()]
    .filter(e=>!games.some(g=>scheduleEventMatches(e,g,sport))).map(e=>String(e.id));
}
export function checkCoverage(sport,board,scheduled=null){
  const games=Array.isArray(board)?board:[];
  const unmodeled=games.filter(g=>g.projection?.independent!==true);
  const duplicateIds=games.map(g=>String(g.id||"")).filter(Boolean).filter((id,i,a)=>a.indexOf(id)!==i);
  const missing=scheduled===null?[]:missingScheduledIds(scheduled,games,sport);
  const missingProjectionEvents=unmodeled.map(g=>({eventId:String(g.id||""),
    reason:g.projection?.reason||g.projection?.blockedReason||g.modelUnavailableReason||"INDEPENDENT_PROJECTION_UNAVAILABLE"}));
  const scheduleMismatches=(scheduled||[]).flatMap(e=>{
    const g=games.find(g=>scheduleEventMatches(e,g,sport));
    if(!g)return [];
    const reasons=[];
    for(const side of ["home","away"]){
      const expected=normalizedScheduleTeam(e[side],sport);
      const actual=normalizedScheduleTeam(g[side]?.abbr||g[side]?.abbreviation,sport);
      if(expected&&actual&&expected!==actual)reasons.push(side.toUpperCase()+"_TEAM_MISMATCH");
    }
    const expectedStart=Date.parse(e.start),actualStart=Date.parse(g.start);
    if(Number.isFinite(expectedStart)&&Number.isFinite(actualStart)&&Math.abs(expectedStart-actualStart)>60000)reasons.push("START_TIME_MISMATCH");
    return reasons.length?[{eventId:String(e.id),reasons}]:[];
  });
  return {sport,boardGames:games.length,independentModels:games.length-unmodeled.length,
    unavailableModels:unmodeled.length,missingProjectionEvents,scheduleMismatches,duplicateIds:[...new Set(duplicateIds)],
    sourceStatus:scheduled===null?"SOURCE_UNVERIFIED":"ESPN_VERIFIED",
    expectedGames:scheduled?.length??null,missingEventIds:missing,
    state:duplicateIds.length||missing.length||scheduleMismatches.length?"INCOMPLETE":scheduled===null?"BOARD_ONLY":unmodeled.length?"DEGRADED":"COMPLETE"};
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
  let last;
  for(let attempt=1;attempt<=3;attempt++){
    url.searchParams.set("_slate_check",String(Date.now())+"-"+attempt);
    try{
      const data=await jsonGet(url.toString());
      if(data.ok!==true||!Array.isArray(data.games))throw Error(sport+" board bad contract: "+String(data.error||"missing games"));
      return data.games;
    }catch(e){
      last=e;
      if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000*attempt));
    }
  }
  throw last;
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
        home:e.competitions?.[0]?.competitors?.find(t=>t.homeAway==="home")?.team?.abbreviation||null,
        away:e.competitions?.[0]?.competitors?.find(t=>t.homeAway==="away")?.team?.abbreviation||null,
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
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")) throw Error("date YYYY-MM-DD required");
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
    if(recovery && ((expected && coverage.missingEventIds.length)||boardError)){
      // The public slate path is cache-only for paid feeds; it may refresh free
      // source context. It must not create wager authority or initiate paid runs.
      attemptedFreeRecovery=true;
      try{
        const warm=new URL("/api/slate",BASE);
        warm.searchParams.set("sport",sport);
        warm.searchParams.set("date",date);
        await jsonGet(warm.toString());
        board=await getBoard(sport,date);
        boardError=null;
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
    ...(d.unavailableModels?[d.sport+":missing-projections:"+d.missingProjectionEvents.map(e=>e.eventId+"="+e.reason).join(",")]:[]),
    ...(d.scheduleMismatches.length?[d.sport+":schedule-mismatch:"+JSON.stringify(d.scheduleMismatches)]:[]),
    ...(d.sourceStatus==="SOURCE_UNVERIFIED"?[d.sport+":AUTHORITATIVE_SCHEDULE_UNVERIFIED"]:[]),
    ...(d.duplicateIds.length?[d.sport+":duplicates:"+d.duplicateIds.join(",")]:[]),
  ]);
  return {ok:errors.length===0,date,checkedAt:new Date().toISOString(),
    gamesOnBoard:detail.reduce((s,d)=>s+d.boardGames,0),
    independentModels:detail.reduce((s,d)=>s+d.independentModels,0),
    sourceVerifiedSports:detail.filter(d=>d.sourceStatus==="ESPN_VERIFIED").length,
    unsupportedIndependentSourceSports:detail.filter(d=>d.sourceStatus==="SOURCE_UNVERIFIED"&&!d.hasIndependentSource).map(d=>d.sport),
    detail,errors};
}
/** Seven dates, bounded concurrency, and no recovery writes during the horizon audit. */
export async function auditSevenDaySlate({date,sports=ENABLED_SPORTS,audit=auditDailySlate}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('date YYYY-MM-DD required');
 const days=Array.from({length:7},(_,i)=>new Date(Date.parse(date+"T12:00:00Z")+i*DAY_MS).toISOString().slice(0,10));
 const reports=await boundedMap(days,day=>audit({date:day,sports,recovery:false}),2);
 const unverified=reports.flatMap(r=>r.detail.filter(d=>d.sourceStatus!=='ESPN_VERIFIED')
  .map(d=>({date:r.date,sport:d.sport,reason:d.sourceError||'AUTHORITATIVE_SCHEDULE_UNVERIFIED'})));
 return {ok:reports.every(r=>r.ok)&&unverified.length===0,horizonDays:7,date,
  checkedAt:new Date().toISOString(),reports,unverified,
  errors:reports.flatMap(r=>r.errors.map(e=>r.date+':'+e)),canAuthorizeWager:false};
}
function localToday(){
  return chicagoDate(new Date().toISOString());
}
if(process.argv[1] && import.meta.url===new URL("file://"+process.argv[1]).href){
  const date=process.env.SLATE_DATE||localToday();
  const sevenDays=process.env.SLATE_HORIZON_DAYS==="7";
  const report=sevenDays?await auditSevenDaySlate({date}):await auditDailySlate({date});
  console.log(JSON.stringify(report,null,2));
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import("node:fs");
    const rows=(report.detail||report.reports.flatMap(r=>r.detail.map(d=>({...d,sport:r.date+" "+d.sport})))).map(d=>`| ${d.sport.toUpperCase()} | ${d.boardGames} | ${d.expectedGames??"Not independently verified"} | ${d.independentModels} | ${d.state} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,[
      "## FBIS daily slate coverage — "+date,
      "| Sport | Board games | Independent-source games | Modeled | Status |",
      "|---|---:|---:|---:|---|",...rows,
      "",report.errors.length?"Missing/unverified: "+report.errors.join("; "):"Independent-source checks passed where supported.",
      "No model promotion, paid data acquisition or wager authorization was performed.",""
    ].join("\n"));
  }
  if(!report.ok)process.exitCode=1;
}
