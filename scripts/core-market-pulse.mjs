// Core PinnOdds/Polymarket hourly watchdog. Only automatic repair: reconnect the WS.
// Never invokes a PinnOdds provider collection or Action/Apify.
import {writeFile,appendFile,mkdir} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const BASE="https://fbis-myz.pages.dev";
const SPORTS=[1,2,3,4,5,6], FEEDS=["prematch","live"];
function ageMs(value,now){const time=Date.parse(String(value||""));return Number.isFinite(time)&&time<=now?now-time:Infinity}
export function evaluatePulse(pin,poly,{now=Date.now()}={}){
 const incidents=[],notes=[];
 if(pin?.ok!==true||!Array.isArray(pin?.results))incidents.push("PINNODDS_STATUS_UNAVAILABLE");
 const scopes=new Map((pin?.results||[]).map(r=>[String(r.kind)+":"+String(r.sportId||"all")+":"+String(r.feed||"all"),r]));
 let healthy=0,missing=0,stale=0,failed=0;
 for(const id of SPORTS)for(const feed of FEEDS){
  const r=scopes.get("board:"+id+":"+feed);
  if(!r||r.status==="NOT_CAPTURED"){missing++;continue}
  if(r.status==="STATUS_READ_ERROR"||r.reconciled===false){failed++;continue}
  if(ageMs(r.collectedAt,now)>8*3600000){stale++;continue}
  healthy++;
 }
 if(missing)incidents.push("PINNODDS_BOARD_MISSING_"+missing);
 if(stale)incidents.push("PINNODDS_BOARD_STALE_"+stale);
 if(failed)incidents.push("PINNODDS_BOARD_UNRECONCILED_"+failed);
 for(const feed of FEEDS){const r=scopes.get("drops:all:"+feed);if(!r||r.status==="NOT_CAPTURED"||r.status==="STATUS_READ_ERROR")notes.push("PINNODDS_DROP_"+feed+"_UNKNOWN")}
 if(poly?.ok!==true||!poly?.signedMarketWebsocket)incidents.push("POLYMARKET_STATUS_UNAVAILABLE");
 const ws=poly?.signedMarketWebsocket||{};
 const connectionHealthy=ws.connectionStatus==="CONNECTED"&&ws.operational===true
  &&ageMs(ws.lastMessageAt,now)<=5*60000&&Number(ws.subscriptions)>0;
 if(!connectionHealthy)incidents.push("POLYMARKET_WS_DISCONNECTED_OR_IDLE");
 if(ageMs(ws.lastBboCapture,now)>6*3600000)incidents.push("POLYMARKET_WS_BBO_PERSISTENCE_STALE");
 const markets=poly?.sports||[];
 const prices=markets.reduce((n,s)=>n+(Number(s.displayedPrices)||0),0);
 const matches=markets.reduce((n,s)=>n+(Number(s.matchedGames)||0),0);
 if(!markets.some(s=>ageMs(s.lastCapture,now)<=6*3600000)||!prices)incidents.push("POLYMARKET_REST_BOARD_UNAVAILABLE");
 if(!matches)notes.push("POLYMARKET_NO_MATCHED_EVENTS");
 const tennis=poly?.tennisCoverage||null;
 if(tennis?.status==="OFFICIAL_SCHEDULE_MISSING"){
  if(Number(tennis.rest?.upcomingObservations||0)>0)incidents.push("TENNIS_CANONICAL_FIXTURES_MISSING");
  else notes.push("TENNIS_OFFICIAL_SCHEDULE_EMPTY");
 }
 if(Number(tennis?.rest?.upcomingObservations||0)>0&&
    Number(tennis?.websocket?.observations||0)===0)notes.push("TENNIS_UPCOMING_REST_WITHOUT_WS");
 if(tennis?.status==="UPCOMING_MARKETS_UNMATCHED")incidents.push("TENNIS_UPCOMING_MARKETS_UNMATCHED");
 return {ok:incidents.length===0,incidents,notes,
  pinnodds:{expectedBoards:12,healthyBoards:healthy,missingBoards:missing,staleBoards:stale,failedBoards:failed,
   latestBoardAt:(pin?.results||[]).filter(r=>r.kind==="board").map(r=>r.collectedAt).filter(Boolean).sort().at(-1)||null},
  polymarket:{websocketConnected:ws.connectionStatus==="CONNECTED",websocketOperational:ws.operational===true,
   subscriptions:Number(ws.subscriptions||0),lastMessageAt:ws.lastMessageAt||null,lastBboCapture:ws.lastBboCapture||null,
   matchedEventsLast24h:Number(ws.matchedEventsLast24h||0),bboRecordsLast24h:Number(ws.bboRecordsLast24h||0),
   lastError:ws.lastError||null,restMatchedGames:matches,restDisplayedPrices:prices,
   tennis:tennis?{status:tennis.status,officialUpcomingMatches:tennis.officialUpcomingMatches,
    restEvents:tennis.rest?.providerEvents||0,restUpcomingObservations:tennis.rest?.upcomingObservations||0,
    wsObservations:tennis.websocket?.observations||0,wsLastCapture:tennis.websocket?.lastCapture||null}:null},
  repairableWebsocket:!connectionHealthy};
}
export async function runMarketPulse({fetchImpl=fetch,now=Date.now(),base=BASE,secret="",sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 async function get(path){
  const response=await fetchImpl(base+path,{signal:AbortSignal.timeout(20000),headers:{accept:"application/json"}});
  if(!response.ok)throw Error("STATUS_HTTP_"+response.status+"_"+path);
  return response.json();
 }
 const [p,q]=await Promise.allSettled([get("/api/pinnodds-status"),get("/api/polymarket-status")]);
 const pin=p.status==="fulfilled"?p.value:{ok:false,error:"PINNODDS_ENDPOINT_FAILED"};
 let poly=q.status==="fulfilled"?q.value:{ok:false,error:"POLYMARKET_ENDPOINT_FAILED"};
 let verdict=evaluatePulse(pin,poly,{now}),repair="NOT_NEEDED";
 if(verdict.repairableWebsocket){
  if(!secret)repair="NOT_ATTEMPTED_MISSING_SECRET";
  else {
   repair="ATTEMPTED";
   try{
    const response=await fetchImpl(base+"/api/polymarket-stream-start",{
     method:"POST",headers:{"x-harvest-secret":secret,"content-type":"application/json"},
     signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error("STREAM_RESTART_HTTP_"+response.status);
    await sleep(20000);
    poly=await get("/api/polymarket-status");
    verdict=evaluatePulse(pin,poly,{now:Date.now()});
    repair=verdict.repairableWebsocket?"STILL_UNHEALTHY":"STREAM_RECONNECTED";
   }catch{repair="RESTART_FAILED"}
  }
 }
 return {...verdict,recovery:repair,checkedAt:new Date().toISOString(),
  readOnlyPinnodds:true,actionNetworkTouched:false,paidCollectorLaunched:false};
}
export async function executePulse(options={}){
 let pulse;
 try{pulse=await runMarketPulse(options)}
 catch(error){pulse={ok:false,incidents:["MONITOR_EXECUTION_FAILED"],error:String(error?.message||error).slice(0,250),checkedAt:new Date().toISOString()}}
 await mkdir("artifacts",{recursive:true});
 await writeFile("artifacts/core-market-pulse.json",JSON.stringify(pulse,null,2)+"\n");
 const lines=["## FBIS Core Market Pulse",
  "**Status:** "+(pulse.ok?"HEALTHY":"DEGRADED"),"**Time:** "+pulse.checkedAt,
  "**Incidents:** "+((pulse.incidents||[]).join(", ")||"none"),
  "**Polymarket recovery:** "+(pulse.recovery||"not attempted"),
  "**PinnOdds boards:** "+String(pulse.pinnodds?.healthyBoards??"?")+"/"+String(pulse.pinnodds?.expectedBoards??12),
  "**WebSocket subscriptions:** "+String(pulse.polymarket?.subscriptions??"?"),
  "**Last WS BBO:** "+(pulse.polymarket?.lastBboCapture||"unknown"),
  "**Tennis identity:** "+(pulse.polymarket?.tennis?.status||"unknown"),
  "**Safety:** No PinnOdds provider requests; no Action/Apify requests; no model/wager authority changes."];
 const summary=lines.join("\n")+"\n";
 console.log(summary);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
 return pulse;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await executePulse({secret:process.env.HARVEST_SECRET||""});
 if(!result.ok)process.exitCode=1;
}
