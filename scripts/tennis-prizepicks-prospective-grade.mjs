#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { TennisDeepState, simulateTennisDeepV11 } from "../functions/lib/tennisTwoSidedV11.js";

const CF_TOKEN=process.env.CLOUDFLARE_API_TOKEN||"";
const CF_ACCOUNT=process.env.CLOUDFLARE_ACCOUNT_ID||"";
const DB_ID="b50c724c-903b-4241-8ce1-48d931e7a44c";
const OUT=process.env.TENNIS_PP_GRADE_OUT||"research/tennis/prizepicks-prospective-2026-10-01-02.json";
const MIRROR="https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";
const SIMS=Math.max(500,Number(process.env.TENNIS_PP_GRADE_SIMS||2000));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(v,d=5)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
const norm=s=>String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const surfaceKey=s=>{s=String(s||"hard").toLowerCase();return s.includes("clay")?"clay":s.includes("grass")?"grass":"hard"};

function parseCsv(text){
  const rows=[];let row=[],field="",q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')q=false;else field+=ch;}
    else{if(ch==='"')q=true;else if(ch===","){row.push(field);field="";}else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";}else if(ch!=="\r")field+=ch;}
  }
  if(field||row.length){row.push(field);rows.push(row);}
  const h=rows.shift()||[];return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));
}
async function fetchText(url){const r=await fetch(url,{headers:{"user-agent":"FBIS tennis prospective grading"}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r.text()}
function idOf(r,s){return String(r[`${s}_id`]||r[`${s}_name`]||"").trim()}
function dateKey(r){return String(r.tourney_date||"")}
function eventKey(r,t){return `${t}|${r.tourney_id||r.tourney_name}|${dateKey(r)}`}
function scoreOutcome(score){
  const s=String(score||"").trim().replace(/\s+/g," ");
  if(!s||/W\/O|RET|DEF|ABD|Walkover/i.test(s)||/[\[\]]/.test(s))return null;
  const sets=s.split(" ").map(x=>x.match(/^(\d+)-(\d+)(?:\([^)]*\))?$/)).filter(Boolean).map(m=>[Number(m[1]),Number(m[2])]).filter(x=>x[0]<=7&&x[1]<=7);
  if(sets.length<2)return null;
  const wg=sets.reduce((n,x)=>n+x[0],0),lg=sets.reduce((n,x)=>n+x[1],0);
  return {winnerGames:wg,loserGames:lg,totalGames:wg+lg,totalSets:sets.length};
}
function playerActual(r,name,outcome){
  const n=norm(name),w=norm(r.winner_name),l=norm(r.loser_name);
  if(n===w)return outcome.winnerGames;
  if(n===l)return outcome.loserGames;
  return null;
}
function exactPair(r,a,b){
  const set=new Set([norm(r.winner_name),norm(r.loser_name)]);
  return set.has(norm(a))&&set.has(norm(b));
}
async function d1(sql){
  if(!CF_TOKEN||!CF_ACCOUNT)throw new Error("Cloudflare credentials missing");
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/d1/database/${DB_ID}/query`,{
    method:"POST",headers:{authorization:`Bearer ${CF_TOKEN}`,"content-type":"application/json"},
    body:JSON.stringify({sql})
  });
  const j=await r.json();if(!r.ok||j.success===false)throw new Error(`D1 query failed ${r.status} ${JSON.stringify(j.errors||[])}`);
  return j.result?.[0]?.results||[];
}
function parseAllowed(raw){
  try{
    const x=JSON.parse(raw||"{}"),v=x.allowed_wager_types;
    if(v==null)return null;
    if(Array.isArray(v))return v.map(x=>String(x).toLowerCase());
    return String(v).toLowerCase().split(/[,|/ ]+/).filter(Boolean);
  }catch{return null}
}
function chooseSide(pOver,pUnder,allowed){
  let options=[["over",pOver],["under",pUnder]].filter(x=>Number.isFinite(x[1]));
  if(Array.isArray(allowed)&&allowed.length)options=options.filter(([s])=>allowed.includes(s)||allowed.includes(s==="over"?"more":"less")||allowed.includes(s==="under"?"less":"more"));
  if(!options.length)return null;
  return options.sort((a,b)=>b[1]-a[1])[0];
}
function grade(actual,line,side){
  if(!Number.isFinite(actual)||!Number.isFinite(line)||!side)return null;
  if(actual===line)return "PUSH";
  const over=actual>line;return (side==="over"?over:!over)?"WIN":"LOSS";
}
function shiftDist(dist,rawMean,calMean){const d=Number(calMean)-Number(rawMean);return (dist||[]).map(x=>Number(x)+d)}
function pOver(dist,line){return dist.length?dist.filter(x=>x>line).length/dist.length:null}
function suffixFor(m){return m==="total_games"?"TotalGames":m==="total_games_won"?"P1Games":null}
function chooseCal(report,suffix,tour,surface){
  const g=report?.props?.calibration?.[suffix]||{};
  return g[`tourSurface:${tour}:${surface}`]||g[`tour:${tour}`]||g[`surface:${surface}`]||g.global||null;
}
function applyCal(x,c){return c?c.a+c.b*x:x}
function bin(rows,lo,hi){
  const xs=rows.filter(r=>r.confidence>=lo&&r.confidence<hi&&r.result!=="PUSH");
  return {lo,hi:Number.isFinite(hi)?hi:null,n:xs.length,wins:xs.filter(r=>r.result==="WIN").length,losses:xs.filter(r=>r.result==="LOSS").length,hitRate:xs.length?round(xs.filter(r=>r.result==="WIN").length/xs.length):null,meanConfidence:xs.length?round(mean(xs.map(r=>r.confidence))):null};
}
function summarize(rows){
  const graded=rows.filter(r=>["WIN","LOSS","PUSH"].includes(r.result));
  const dec=graded.filter(r=>r.result!=="PUSH");
  return {
    n:graded.length,decisions:dec.length,wins:dec.filter(r=>r.result==="WIN").length,losses:dec.filter(r=>r.result==="LOSS").length,pushes:graded.filter(r=>r.result==="PUSH").length,
    hitRate:dec.length?round(dec.filter(r=>r.result==="WIN").length/dec.length):null,
    meanConfidence:dec.length?round(mean(dec.map(r=>r.confidence))):null,
    brier:dec.length?round(mean(dec.map(r=>(r.confidence-(r.result==="WIN"?1:0))**2))):null,
    calibrationGap:dec.length?round((dec.filter(r=>r.result==="WIN").length/dec.length)-mean(dec.map(r=>r.confidence))):null,
    confidenceBuckets:[[.50,.55],[.55,.60],[.60,.65],[.65,.70],[.70,.75],[.75,.80],[.80,.90],[.90,Infinity]].map(([a,b])=>bin(dec,a,b)),
  };
}

const rawLines=await d1(`
  SELECT game_id, player_id, player_name, opponent, start_time, canonical_market, line, odds_tier, collected_at, raw_json
  FROM prizepicks_prop_lines
  WHERE lower(sport)='tennis'
    AND canonical_market IN ('total_games','total_games_won')
    AND start_time < '2026-10-05T02:08:00Z'
    AND opponent IS NOT NULL
  ORDER BY collected_at DESC
`);
const dedup=new Map();
for(const r of rawLines){
  const k=[r.game_id,norm(r.player_name),r.canonical_market,r.line,r.odds_tier].join("|");
  if(!dedup.has(k))dedup.set(k,r);
}
const lines=[...dedup.values()];

let calibration={};
try{calibration=JSON.parse(await fs.readFile("research/tennis/deep-v1-1-2026-10-05.json","utf8"))}catch{}

const all=[];
for(const tour of ["atp","wta"])for(let year=2018;year<=2026;year++){
  try{
    const txt=await fetchText(`${MIRROR}/${tour}/${tour}_matches_${year}.csv`);
    for(const r of parseCsv(txt))all.push({...r,_tour:tour,_year:year});
  }catch(e){if(year<2026)throw e;}
}
all.sort((a,b)=>dateKey(a).localeCompare(dateKey(b))||eventKey(a,a._tour).localeCompare(eventKey(b,b._tour))||String(a.match_num||"").localeCompare(String(b.match_num||"")));

const targets=new Map();
for(const r of lines){
  if(!r.opponent)continue;
  const k=[...new Set([norm(r.player_name),norm(r.opponent)])].sort().join("|");
  if(!targets.has(k))targets.set(k,[]);
  targets.get(k).push(r);
}

const states={atp:new TennisDeepState("atp"),wta:new TennisDeepState("wta")},projections=new Map(),matchedMatches=[];
let i=0;
while(i<all.length){
  const ek=eventKey(all[i],all[i]._tour);let j=i;while(j<all.length&&eventKey(all[j],all[j]._tour)===ek)j++;
  const event=all.slice(i,j),tour=event[0]._tour,state=states[tour];
  for(const r of event){
    const pair=[norm(r.winner_name),norm(r.loser_name)].sort().join("|");
    const requested=targets.get(pair);if(!requested?.length)continue;
    const outcome=scoreOutcome(r.score);if(!outcome)continue;
    const surface=surfaceKey(r.surface);
    const a={id:idOf(r,"winner"),name:r.winner_name},b={id:idOf(r,"loser"),name:r.loser_name};
    // Stable alphabetic orientation so player index is deterministic.
    const ps=[a,b].sort((x,y)=>norm(x.name).localeCompare(norm(y.name)));
    const p1=state.profile(ps[0].id,ps[0].name,surface),p2=state.profile(ps[1].id,ps[1].name,surface);
    if(Math.min(p1.historyMatches,p2.historyMatches)<3)continue;
    const id=`ppgrade|${tour}|${r.tourney_id}|${r.match_num}`;
    const proj=simulateTennisDeepV11({id,tour,surface,bestOf:Number(r.best_of)||3,player1:p1,player2:p2},{simulations:SIMS},{seed:id,researchBacktest:true});
    projections.set(pair,{r,outcome,tour,surface,ps,proj});
    matchedMatches.push({pair,tour,surface,tournament:r.tourney_name,round:r.round,score:r.score,winner:r.winner_name,loser:r.loser_name});
  }
  for(const r of event)states[event[0]._tour].update(r,surfaceKey(r.surface));
  i=j;
}

const graded=[];
for(const line of lines){
  const pair=[norm(line.player_name),norm(line.opponent)].sort().join("|"),m=projections.get(pair);
  if(!m)continue;
  const idx=norm(m.ps[0].name)===norm(line.player_name)?0:1;
  const suffix=suffixFor(line.canonical_market),cal=chooseCal(calibration,suffix,m.tour,m.surface);
  let rawMean,calMean,dist,actual;
  if(line.canonical_market==="total_games"){
    rawMean=m.proj.match.totalGames.mean;calMean=applyCal(rawMean,cal);dist=m.proj.distributions.totalGames;actual=m.outcome.totalGames;
  }else{
    rawMean=m.proj.playerMetrics[idx].total_games_won.mean;calMean=applyCal(rawMean,cal);dist=m.proj.distributions.players[idx].total_games_won;actual=playerActual(m.r,line.player_name,m.outcome);
  }
  const shifted=shiftDist(dist,rawMean,calMean),over=pOver(shifted,Number(line.line)),under=over==null?null:1-over;
  const allowed=parseAllowed(line.raw_json),pick=chooseSide(over,under,allowed);
  if(!pick)continue;
  const result=grade(actual,Number(line.line),pick[0]);
  graded.push({
    gameId:line.game_id,playerName:line.player_name,opponent:line.opponent,tour:m.tour,surface:m.surface,tournament:m.r.tourney_name,
    market:line.canonical_market,line:Number(line.line),tier:String(line.odds_tier||"standard").toLowerCase(),
    allowedSides:allowed,projection:round(calMean,3),rawProjection:round(rawMean,3),pOver:round(over),pUnder:round(under),
    side:pick[0],confidence:round(pick[1]),actual,result,startTime:line.start_time,collectedAt:line.collected_at
  });
}

const tiers=["standard","goblin","demon"],markets=["total_games","total_games_won"];
const report={
  generatedAt:new Date().toISOString(),
  model:"TENNIS-PLAYER-v1.1-DEEP",
  test:"Prospective grading of FBIS-captured PrizePicks tennis board from Oct 1-2, 2026",
  integrity:{
    linesCapturedBeforeResults:true,
    lineSource:"FBIS D1 prizepicks_prop_lines",
    futureLineBackfill:false,
    duplicateRowsCollapsed:true,
    projectionHistoryUsesOnlyPriorTournamentState:true,
    modelCalibrationFrozenFrom2020to2023:true,
  },
  sourceCoverage:{
    rawCapturedRows:rawLines.length,dedupedLines:lines.length,targetPairs:targets.size,matchedCompletedMatches:projections.size,gradedLines:graded.length,
    capturedMarkets:[...new Set(lines.map(r=>r.canonical_market))],
    note:"The captured Oct 1-2 board contains Total Games and Total Games Won only; it cannot prospectively validate aces/DF/BP from this snapshot."
  },
  overall:summarize(graded),
  byTier:Object.fromEntries(tiers.map(t=>[t,summarize(graded.filter(r=>r.tier===t))])),
  byMarket:Object.fromEntries(markets.map(m=>[m,summarize(graded.filter(r=>r.market===m))])),
  byTierMarket:Object.fromEntries(tiers.flatMap(t=>markets.map(m=>[[t,m].join(":"),summarize(graded.filter(r=>r.tier===t&&r.market===m))]))),
  byTour:Object.fromEntries(["atp","wta"].map(t=>[t,summarize(graded.filter(r=>r.tour===t))])),
  bySurface:Object.fromEntries(["hard","clay","grass"].map(s=>[s,summarize(graded.filter(r=>r.surface===s))])),
  economics:{
    roiAvailable:false,
    reason:"PrizePicks card payout/multiplier economics are not encoded per captured line; Goblin/Demon/Standard hit rates cannot be converted honestly into flat single-leg ROI.",
    standardDirectionalEvidence:summarize(graded.filter(r=>r.tier==="standard")),
  },
  unmatched:{
    linePairs:targets.size-projections.size,
    sample:[...targets.keys()].filter(k=>!projections.has(k)).slice(0,25)
  },
  governance:{maturity:"RESEARCH",canQualify:false,canAuthorizeWager:false},
};
const std=report.byTier.standard;
report.verdict={
  prospectiveSamplePass:std.decisions>=50,
  standardHitRatePass:std.decisions>=50&&std.hitRate>=.55,
  calibrationPass:std.decisions>=50&&Math.abs(std.calibrationGap)<=.08,
  monotonicConfidenceEvidence:false,
  wagerPromotion:false,
  decision:std.decisions>=50&&std.hitRate>=.55&&Math.abs(std.calibrationGap)<=.08?"PROSPECTIVE_DIRECTIONAL_PASS":"RESEARCH_ONLY",
};
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(report,null,2)+"\n");
await fs.mkdir("artifacts",{recursive:true});await fs.writeFile("artifacts/tennis-prizepicks-prospective-rows.jsonl",graded.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify(report,null,2));
