#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  HISTORICAL_EXPANSION_MODEL_ID,
  LOCKED_GOALIE_SCALE,
  historicalShadowPrediction,
  predictiveMetrics,
  pairedSummary,
  pairedDeltas,
  calibrationFit,
  reliability,
  requiredSampleForMeanEffect,
  grouped
} from "../functions/lib/nhlGoalieHistoricalExpansion.js";

const WEB="https://api-web.nhle.com/v1";
function arg(name,fallback=null){const p=process.argv.find(x=>x.startsWith(`--${name}=`));return p?p.split("=").slice(1).join("="):fallback;}
const sourcePath=arg("source","/tmp/nhl-goalie-historical-base.json");
const outPath=arg("out","data/models/nhl-goalie-prob-historical-expansion-v1.json");
const cacheDir=arg("cache-dir",".cache/nhl-goalie-historical-expansion");
const concurrency=Math.max(2,Math.min(20,Number(arg("concurrency","10"))||10));
const targetSeasons=String(arg("target-seasons","20192020,20202021,20212022,20222023")).split(",").filter(Boolean);

function round(v,n=6){return Number(Number(v).toFixed(n));}
function mean(xs){const v=xs.filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function dayDiff(a,b){return Math.abs(Date.parse(a)-Date.parse(b))/86400000;}
function isoShift(iso,hours){const t=Date.parse(iso);return Number.isFinite(t)?new Date(t+hours*3600000).toISOString():null;}
function gameStartFromBox(box){const v=box?.startTimeUTC||box?.gameDateTimeUTC||null;return v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;}
async function fetchJson(url,attempts=4){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const r=await fetch(url,{headers:{accept:"application/json","user-agent":"FBIS-NHL-GOALIE-HISTORICAL-EXPANSION/1.0"},signal:AbortSignal.timeout(15000)});
      if(r.ok)return r.json();
      last=new Error(`HTTP_${r.status} ${url}`);
      if(r.status===404)throw last;
      if(r.status===429||r.status>=500)await sleep(i*500);else throw last;
    }catch(err){last=err;if(i<attempts)await sleep(i*500);}
  }
  throw last;
}
async function cachedBox(gameId){
  const dir=`${cacheDir}/box`,path=`${dir}/${gameId}.json`;
  try{return JSON.parse(await readFile(path,"utf8"));}catch{}
  const json=await fetchJson(`${WEB}/gamecenter/${gameId}/boxscore`);
  await mkdir(dir,{recursive:true});await writeFile(path,JSON.stringify(json),"utf8");return json;
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let idx=0;
  async function worker(){while(true){const i=idx++;if(i>=items.length)return;try{out[i]=await fn(items[i],i);}catch(e){out[i]={ok:false,error:String(e?.message||e),id:String(items[i]?.id||"")};}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out;
}
function teamSide(box,abbr){
  const h=String(box?.homeTeam?.abbrev??box?.homeTeam?.abbrev?.default??"").toUpperCase();
  return h===String(abbr).toUpperCase()?"homeTeam":"awayTeam";
}
function durationSeconds(v){
  const m=String(v||"").match(/^(\d+):(\d+)$/);return m?Number(m[1])*60+Number(m[2]):0;
}
function actualStarter(box,abbr){
  const side=teamSide(box,abbr),goalies=box?.playerByGameStats?.[side]?.goalies||[];
  const rows=goalies.map(g=>({id:String(g.playerId??g.id??""),name:String(g.name?.default??g.name??g.playerName??""),toi:durationSeconds(g.toi??g.timeOnIce)})).filter(x=>x.id);
  rows.sort((a,b)=>b.toi-a.toi);return rows[0]||null;
}
function expectedStarter(history,snapshotAt){
  const cutoff=Date.parse(snapshotAt);
  const recent=history.filter(x=>x?.starterId&&x?.sourceAvailableAt&&Date.parse(x.sourceAvailableAt)<=cutoff).slice(-5);
  if(!recent.length)return{known:false,id:null,name:null,probability:null,backToBack:false,evidenceAt:null};
  const counts=new Map();
  for(const x of recent)counts.set(x.starterId,(counts.get(x.starterId)||0)+1);
  const [id,n]=[...counts].sort((a,b)=>b[1]-a[1])[0];
  const last=[...recent].reverse().find(x=>x.starterId===id);
  const latest=recent.at(-1);
  return{known:true,id,name:last?.starterName||id,probability:n/recent.length,backToBack:Boolean(latest?.starterId===id),evidenceAt:latest?.sourceAvailableAt||null};
}
function regime(row){
  if(!row.expectedHomeKnown||!row.expectedAwayKnown)return"EXPECTED_STATE_INCOMPLETE";
  if(row.unexpectedStarter)return"LATE_OR_UNEXPECTED_STARTER_CHANGE";
  return"EXPECTED_STARTER_ONLY";
}
function probBand(p){return p<0.45?"HOME_<_45":p<0.50?"HOME_45_49":p<0.55?"HOME_50_54":p<0.60?"HOME_55_59":p<0.65?"HOME_60_64":"HOME_65_PLUS";}
function seasonPhase(row){
  const m=Number(String(row.date).slice(5,7));return m<=11?"EARLY_SEASON":m>=3?"LATE_SEASON":"MID_SEASON";
}
function conclusion(agg,bySeason){
  const db=agg.paired.brier.mean,dl=agg.paired.logLoss.mean;
  const seasonRows=Object.values(bySeason);
  const bothBetter=seasonRows.filter(x=>(x.paired?.brier?.mean??1)<=0&&(x.paired?.logLoss?.mean??1)<=0).length;
  const ci=agg.paired.brier.ci95||[null,null];
  if(db<0&&dl<0&&bothBetter>=Math.ceil(seasonRows.length*0.75)&&ci[1]!=null&&ci[1]<0)return"STRONGLY CONFIRMS historical goalie signal";
  if(db<0&&dl<0&&bothBetter>=Math.ceil(seasonRows.length/2))return"MODESTLY CONFIRMS historical goalie signal";
  if(db<=0||dl<=0)return"MIXED historical confirmation";
  return"FAILS historical confirmation";
}

const source=JSON.parse(await readFile(sourcePath,"utf8"));
if(LOCKED_GOALIE_SCALE!==0.25)throw new Error("LOCKED_SCALE_MISMATCH");
if(source?.integrity?.noMarketInputs!==true||source?.pointInTime!==true)throw new Error("SOURCE_NOT_PIT_SAFE");
const rows=(source.gamePredictions||[]).filter(r=>targetSeasons.includes(String(r.season))).sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
if(!rows.length)throw new Error("NO_TARGET_ROWS");
const sourceSeasons=[...new Set(rows.map(r=>String(r.season)))];
for(const s of targetSeasons)if(!sourceSeasons.includes(s))throw new Error(`MISSING_TARGET_SEASON_${s}`);

console.log("Historical expansion rows",rows.length,"seasons",sourceSeasons.join(","));
const fetched=await mapLimit(rows,concurrency,async r=>({ok:true,id:String(r.id),box:await cachedBox(r.id)}));
const boxMap=new Map(fetched.filter(x=>x.ok).map(x=>[x.id,x.box]));
const fetchErrors=fetched.filter(x=>!x.ok).map(x=>({id:x.id,error:x.error}));

const histories=new Map();
const hist=t=>{const k=String(t).toUpperCase();if(!histories.has(k))histories.set(k,[]);return histories.get(k);};
const replay=[];
for(const r of rows){
  const box=boxMap.get(String(r.id));
  const gameStart=box?gameStartFromBox(box):null;
  const simulatedSnapshotAt=gameStart?isoShift(gameStart,-6):null;
  if(!gameStart||!simulatedSnapshotAt)continue;
  const hExp=expectedStarter(hist(r.home),simulatedSnapshotAt),aExp=expectedStarter(hist(r.away),simulatedSnapshotAt);
  const pred=historicalShadowPrediction(r);
  if(!pred.ok)continue;
  const hActual=box?actualStarter(box,r.home):null,aActual=box?actualStarter(box,r.away):null;
  const unexpected=Boolean(
    (hExp.id&&hActual?.id&&hExp.id!==hActual.id)||
    (aExp.id&&aActual?.id&&aExp.id!==aActual.id)
  );
  const date=String(r.date||"");
  const hLast=hist(r.home).filter(x=>Date.parse(x.sourceAvailableAt)<=Date.parse(simulatedSnapshotAt)).at(-1);
  const aLast=hist(r.away).filter(x=>Date.parse(x.sourceAvailableAt)<=Date.parse(simulatedSnapshotAt)).at(-1);
  const temporalIntegrityPassed=Boolean(
    Date.parse(simulatedSnapshotAt)<Date.parse(gameStart)&&
    (!hExp.evidenceAt||Date.parse(hExp.evidenceAt)<=Date.parse(simulatedSnapshotAt))&&
    (!aExp.evidenceAt||Date.parse(aExp.evidenceAt)<=Date.parse(simulatedSnapshotAt))
  );
  const out={
    id:String(r.id),season:String(r.season),date,gameStart,simulatedSnapshotAt,home:r.home,away:r.away,
    actualHomeGoals:Number(r.actualHomeGoals),actualAwayGoals:Number(r.actualAwayGoals),
    projHome:pred.projHome,projAway:pred.projAway,
    incumbentP:pred.incumbentP,shadowP:pred.shadowP,probabilityDelta:pred.probabilityDelta,
    goalieSignal:pred.goalieSignal,gateAnalog:pred.gateAnalog,scoreProjectionChanged:false,
    expectedHomeKnown:hExp.known,expectedAwayKnown:aExp.known,
    homeExpectedStarterId:hExp.id,awayExpectedStarterId:aExp.id,
    homeExpectedStarterName:hExp.name,awayExpectedStarterName:aExp.name,
    homeExpectedStartProbability:hExp.probability,awayExpectedStartProbability:aExp.probability,
    homeGoalieEvidenceAt:hExp.evidenceAt,awayGoalieEvidenceAt:aExp.evidenceAt,
    homeActualStarterId:hActual?.id||null,awayActualStarterId:aActual?.id||null,
    unexpectedStarter:unexpected,
    homeGoalieBackToBack:Boolean(hExp.id&&hLast?.starterId===hExp.id&&dayDiff(date,hLast.date)<=2),
    awayGoalieBackToBack:Boolean(aExp.id&&aLast?.starterId===aExp.id&&dayDiff(date,aLast.date)<=2),
    confirmationState:"UNKNOWN_NO_TIMESTAMP_VERIFIED_HISTORICAL_CONFIRMATION",
    goalieUsageState:null,
    sourceTimestampContract:"PRIOR_COMPLETED_GAMES_AVAILABLE_BEFORE_SIMULATED_SNAPSHOT",
    temporalIntegrityPassed,
    marketState:"UNAVAILABLE_NO_TIMESTAMP_VERIFIED_2019_2023_ARCHIVE",
    homeB2B:Boolean(r.homeB2B),awayB2B:Boolean(r.awayB2B)
  };
  out.goalieUsageState=regime(out);
  replay.push(out);
  const sourceAvailableAt=isoShift(gameStart,5);
  if(hActual)hist(r.home).push({date,gameStart,sourceAvailableAt,starterId:hActual.id,starterName:hActual.name});
  if(aActual)hist(r.away).push({date,gameStart,sourceAvailableAt,starterId:aActual.id,starterName:aActual.name});
}

const usable=replay.filter(r=>r.temporalIntegrityPassed&&Number.isFinite(r.shadowP)&&Number.isFinite(r.incumbentP));
const incumbent=predictiveMetrics(usable,"incumbentP"),shadow=predictiveMetrics(usable,"shadowP"),paired=pairedSummary(usable);
const bySeason=grouped(usable,r=>r.season,40),byMonth=grouped(usable,r=>r.date.slice(0,7),20);
const regimes={
  goalieUsage:grouped(usable,r=>r.goalieUsageState,20),
  gateAnalog:grouped(usable,r=>r.gateAnalog?"SIGNAL_GE_003":"SIGNAL_LT_003",20),
  goalieBackToBack:grouped(usable,r=>r.homeGoalieBackToBack||r.awayGoalieBackToBack?"ANY_GOALIE_B2B":"NO_EXPECTED_GOALIE_B2B",20),
  favorite:grouped(usable,r=>r.incumbentP>=0.5?"HOME_FAVORITE":"HOME_UNDERDOG",20),
  probabilityBand:grouped(usable,r=>probBand(r.incumbentP),20),
  seasonPhase:grouped(usable,seasonPhase,20)
};
const d=pairedDeltas(usable);
const report={
  modelId:HISTORICAL_EXPANSION_MODEL_ID,
  version:"historical-confirmation-v1.0-locked-shrink-25",
  generatedAt:new Date().toISOString(),
  purpose:"Locked historical confirmation of already-selected NHL goalie probability shrink. Not training and not prospective evidence.",
  lockedSpecification:{
    challengerModelId:"NHL-GOALIE-PROB-SHADOW-v1",
    incumbentModelId:"NHL-PRO-v2",
    goalieProbabilityScale:LOCKED_GOALIE_SCALE,
    scoreProjectionChanged:false,
    optimizationAllowed:false,
    prospectiveGateChanged:false
  },
  source:{
    modelId:source.modelId,version:source.version,seasons:source.seasons,
    targetSeasons,trainingSeedSeason:"20182019",
    pointInTime:source.pointInTime,marketInformed:source.marketInformed
  },
  population:{
    requested:rows.length,usable:usable.length,excluded:rows.length-usable.length,
    fetchErrors:fetchErrors.length,
    bySeason:Object.fromEntries(targetSeasons.map(s=>[s,{requested:rows.filter(r=>String(r.season)===s).length,usable:usable.filter(r=>r.season===s).length}]))
  },
  coverage:{
    goalieExpectedState:round(usable.filter(r=>r.expectedHomeKnown&&r.expectedAwayKnown).length/usable.length),
    timestampVerifiedCurrentGoalieConfirmation:0,
    deploymentCoverage:"NOT_RECONSTRUCTED_CONTEXT_ONLY_NOT_REQUIRED_FOR_LOCKED_GOALIE_CONFIRMATION",
    marketCoverage:0,
    marketReason:"Production NHL odds_snapshots begin 2026-09-29; no timestamp-verifiable 2019-23 market archive is available in FBIS.",
    simulatedSnapshotPolicy:"GAME_START_MINUS_6_HOURS",
    priorGameEvidenceAvailabilityPolicy:"GAME_START_PLUS_5_HOURS",
    temporalIntegrityFailures:replay.filter(r=>!r.temporalIntegrityPassed).length,
    failClosedCurrentGameConfirmation:true
  },
  aggregate:{
    incumbent,shadow,
    delta:{
      brier:round(shadow.brier-incumbent.brier,8),
      logLoss:round(shadow.logLoss-incumbent.logLoss,8),
      accuracy:round(shadow.accuracy-incumbent.accuracy,8),
      ece:round(shadow.ece-incumbent.ece,8),
      homeGoalsMae:0,awayGoalsMae:0,totalMae:0,marginMae:0
    },
    paired,
    calibration:{
      incumbent:{fit:calibrationFit(usable,"incumbentP"),reliability:reliability(usable,"incumbentP")},
      shadow:{fit:calibrationFit(usable,"shadowP"),reliability:reliability(usable,"shadowP")}
    }
  },
  bySeason,byMonth,regimes,
  unsupportedRegimes:{
    bothConfirmed:{n:0,reason:"No timestamp-verifiable historical same-game goalie confirmation archive."},
    starterQualityDelta:{n:0,reason:"Expected-starter-specific historical quality was not timestamp-verifiable from the locked replay inputs."},
    marketRelative:{n:0,reason:"No timestamp-verifiable 2019-23 market archive in production FBIS."}
  },
  power:{
    observedBrierDeltaMean:paired.brier.mean,
    observedLogLossDeltaMean:paired.logLoss.mean,
    requiredNForBrierApprox80PctPower:requiredSampleForMeanEffect(d.brier),
    requiredNForLogLossApprox80PctPower:requiredSampleForMeanEffect(d.logLoss),
    frozenProspectiveMinimum:100,
    note:"Planning diagnostic only. Does not alter NHL-GOALIE-PROB-PROSPECTIVE-GATE-v1."
  },
  evidenceHierarchy:{
    originalGoalieSelection:{
      source:"NHL-PERSISTENT-STATE-CHALLENGER-v1",sampleGames:2624,
      brierDelta:-0.00016,logLossDelta:-0.00032,accuracyDelta:0.0019
    },
    historicalExpansion:{
      sampleGames:usable.length,seasons:targetSeasons,
      brierDelta:round(shadow.brier-incumbent.brier,8),
      logLossDelta:round(shadow.logLoss-incumbent.logLoss,8),
      accuracyDelta:round(shadow.accuracy-incumbent.accuracy,8)
    },
    prospective:{
      keptSeparate:true,countsNotCombined:true
    }
  },
  conclusion:conclusion({incumbent,shadow,paired},bySeason),
  governance:{
    productionChampion:"NHL-PRO-v2",
    productionChampionChanged:false,
    challenger:"NHL-GOALIE-PROB-SHADOW-v1",
    prospectiveGate:"NHL-GOALIE-PROB-PROSPECTIVE-GATE-v1",
    prospectiveGateChanged:false,
    canQualify:false,canAuthorizeWager:false,stakingAuthorized:false,
    automaticPromotion:false,operatorApprovalRequired:true,
    contextOnlyFamilies:["deployment","linemate","replacement","combined"]
  },
  integrity:{
    pointInTime:true,noMarketInputs:true,priorCompletedGamesOnly:true,
    explicitSnapshotTimestamps:true,
    rowwiseTemporalIntegrity:usable.every(r=>r.temporalIntegrityPassed&&Date.parse(r.simulatedSnapshotAt)<Date.parse(r.gameStart)&&(!r.homeGoalieEvidenceAt||Date.parse(r.homeGoalieEvidenceAt)<=Date.parse(r.simulatedSnapshotAt))&&(!r.awayGoalieEvidenceAt||Date.parse(r.awayGoalieEvidenceAt)<=Date.parse(r.simulatedSnapshotAt))),
    actualStarterUsedOnlyAfterPregameState:true,
    scoreProjectionInvariant:usable.every(r=>r.scoreProjectionChanged===false),
    fetchErrors
  },
  sampleRows:usable.slice(0,25)
};
await mkdir(outPath.split("/").slice(0,-1).join("/")||".",{recursive:true});
await writeFile(outPath,JSON.stringify(report,null,2)+"\n","utf8");
console.log(JSON.stringify({
  population:report.population,coverage:report.coverage,aggregate:report.aggregate,
  power:report.power,conclusion:report.conclusion,governance:report.governance
},null,2));
if(fetchErrors.length>Math.max(10,Math.ceil(rows.length*0.01)))process.exitCode=2;
