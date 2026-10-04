#!/usr/bin/env node
import fs from "node:fs";
import { parseCsv, aggregateTeamWeeks, aggregateQbWeeks, aggregateNextGen, aggregateSnapCounts } from "../functions/lib/nflVerseFeed.js";
import { projectNflProV1 } from "../functions/lib/nflProModel.js";
import { projectNflProV2 } from "../functions/lib/nflProV2Model.js";
import { projectNflFormV0 } from "../functions/lib/nflModel.js";

const RELEASE="https://github.com/nflverse/nflverse-data/releases/download";
const GAMES_URL="https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";
const seasons=(process.env.NFL_WF_SEASONS||"2024,2025").split(",").map(Number).filter(Number.isFinite);

async function csv(url){
  const r=await fetch(url,{headers:{"user-agent":"FBIS-NFL-WF/2.0","accept":"text/csv,application/gzip,*/*"}});
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const text=/\\.gz$/i.test(url)
    ? await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text()
    : await r.text();
  return parseCsv(text);
}
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
const canon=s=>({JAC:"JAX",LA:"LAR",OAK:"LV",WSH:"WAS",SD:"LAC",STL:"LAR"}[String(s||"").toUpperCase()]||String(s||"").toUpperCase());

function formRows(games, season, maxWeek){
  const map=new Map();
  for(const g of games){
    if(Number(g.season)!==season||String(g.game_type)!=="REG"||Number(g.week)>=maxWeek) continue;
    const hs=num(g.home_score), as=num(g.away_score); if(hs==null||as==null) continue;
    for(const [team,pf,pa] of [[canon(g.home_team),hs,as],[canon(g.away_team),as,hs]]){
      const r=map.get(team)||{games:0,pointsFor:0,pointsAgainst:0};
      r.games++; r.pointsFor+=pf; r.pointsAgainst+=pa; map.set(team,r);
    }
  }
  return map;
}
function trackingFeatures(priorNgs,currentNgs,priorSnaps,currentSnaps,week){
  const filterWeek=rows=>rows.filter(r=>Number(r.week)>0&&Number(r.week)<week);
  const pN=aggregateNextGen(priorNgs), cN=aggregateNextGen(Object.fromEntries(Object.entries(currentNgs).map(([k,v])=>[k,filterWeek(v)])));
  const pS=aggregateSnapCounts(priorSnaps), cS=aggregateSnapCounts(filterWeek(currentSnaps));
  const teams=new Set([...Object.keys(pN.teamFeatures),...Object.keys(cN.teamFeatures),...Object.keys(pS),...Object.keys(cS)]);
  const out={};
  const blend=(p,c,n,w=4)=>{const a=num(p),b=num(c);if(a==null)return b;if(b==null)return a;const x=(num(n)||0)/((num(n)||0)+w);return a*(1-x)+b*x;};
  for(const t of teams){
    const p=pN.teamFeatures[t]||{},q=cN.teamFeatures[t]||{},n=q.ngsGames||0;
    const snapRows=cS[t]||pS[t]||[];
    out[t]={
      qbNgsCpoe:blend(p.qbNgsCpoe,q.qbNgsCpoe,n),
      qbTimeToThrow:blend(p.qbTimeToThrow,q.qbTimeToThrow,n),
      qbAggressiveness:blend(p.qbAggressiveness,q.qbAggressiveness,n),
      rushYoePerAtt:blend(p.rushYoePerAtt,q.rushYoePerAtt,n),
      rushEfficiency:blend(p.rushEfficiency,q.rushEfficiency,n),
      receivingSeparation:blend(p.receivingSeparation,q.receivingSeparation,n),
      receivingYacOe:blend(p.receivingYacOe,q.receivingYacOe,n),
      snapShare:snapRows.length?Math.max(...snapRows.map(x=>num(x.snapShare)||0)):null,
      offenseSnaps:snapRows.length?Math.max(...snapRows.map(x=>num(x.offenseSnaps)||0)):null,
    };
  }
  return out;
}
function blendedFeatures(priorTeamRows,priorPlayerRows,currentTeamRows,currentPlayerRows,week,tracking={}){
  const priorT=aggregateTeamWeeks(priorTeamRows);
  const curT=aggregateTeamWeeks(currentTeamRows.filter(r=>Number(r.week)<week));
  const priorQ=aggregateQbWeeks(priorPlayerRows);
  const curQ=aggregateQbWeeks(currentPlayerRows.filter(r=>Number(r.week)<week));
  const teams=new Set([...Object.keys(priorT.offense),...Object.keys(curT.offense),...Object.keys(priorQ),...Object.keys(curQ)]);
  const blend=(p,c,n,w=8)=>{
    const a=num(p),b=num(c); if(a==null)return b;if(b==null)return a;const x=(num(n)||0)/((num(n)||0)+w);return a*(1-x)+b*x;
  };
  const out={};
  for(const t of teams){
    const po={...(priorT.offense[t]||{}),...(priorT.defense[t]||{})};
    const co={...(curT.offense[t]||{}),...(curT.defense[t]||{})};
    const pq=priorQ[t]||{}, cq=curQ[t]||{}, n=co.games||cq.games||0;
    out[t]={
      offenseEpa:blend(po.offenseEpa,co.offenseEpa,n),
      defenseEpa:blend(po.defenseEpa,co.defenseEpa,n),
      passEpa:blend(po.passEpa,co.passEpa,n),
      passEpaAllowed:blend(po.passEpaAllowed,co.passEpaAllowed,n),
      rushEpa:blend(po.rushEpa,co.rushEpa,n),
      rushEpaAllowed:blend(po.rushEpaAllowed,co.rushEpaAllowed,n),
      pressureRate:blend(po.pressureRate,co.pressureRate,n),
      qbEpa:blend(pq.qbEpa,cq.qbEpa,cq.games||0),
      qbCpoe:blend(pq.qbCpoe,cq.qbCpoe,cq.games||0),
      qbSackRate:blend(pq.qbSackRate,cq.qbSackRate,cq.games||0),
      qbPrior:num(pq.qbEpa),
      ...(tracking[t]||{}),
    };
  }
  return out;
}
function score(rows,key){
  const valid=rows.filter(r=>Number.isFinite(r[key]));
  return valid.length?valid.reduce((a,b)=>a+b[key],0)/valid.length:null;
}
function summarize(rows,prefix){
  const x=rows.filter(r=>r[prefix+"Ok"]);
  return {
    n:x.length,
    marginMae:score(x,prefix+"MarginAbs"),
    totalMae:score(x,prefix+"TotalAbs"),
    winnerAccuracy:x.length?x.filter(r=>r[prefix+"WinnerCorrect"]).length/x.length:null,
    winnerCorrect:x.filter(r=>r[prefix+"WinnerCorrect"]).length,
  };
}

fs.mkdirSync("artifacts",{recursive:true});
const games=await csv(GAMES_URL);
const outputs=[];
const gameInputs=[];
const coverageDiag={games:0,teamSides:0,ngsCpoe:0,rushYoe:0,separation:0,yacOe:0,snapShare:0};
for(const season of seasons){
  const [priorTeam,currentTeam,priorPlayer,currentPlayer,ngsPassing,ngsRushing,ngsReceiving,priorSnaps,currentSnaps]=await Promise.all([
    csv(`${RELEASE}/stats_team/stats_team_week_${season-1}.csv`),
    csv(`${RELEASE}/stats_team/stats_team_week_${season}.csv`),
    csv(`${RELEASE}/stats_player/stats_player_week_${season-1}.csv`),
    csv(`${RELEASE}/stats_player/stats_player_week_${season}.csv`),
    csv(`${RELEASE}/nextgen_stats/ngs_passing.csv.gz`),
    csv(`${RELEASE}/nextgen_stats/ngs_rushing.csv.gz`),
    csv(`${RELEASE}/nextgen_stats/ngs_receiving.csv.gz`),
    csv(`${RELEASE}/snap_counts/snap_counts_${season-1}.csv`),
    csv(`${RELEASE}/snap_counts/snap_counts_${season}.csv`),
  ]);
  const priorNgs={passing:ngsPassing.filter(r=>Number(r.season)===season-1),rushing:ngsRushing.filter(r=>Number(r.season)===season-1),receiving:ngsReceiving.filter(r=>Number(r.season)===season-1)};
  const currentNgs={passing:ngsPassing.filter(r=>Number(r.season)===season),rushing:ngsRushing.filter(r=>Number(r.season)===season),receiving:ngsReceiving.filter(r=>Number(r.season)===season)};
  const priorForm=formRows(games,season-1,99);
  for(const g of games){
    if(Number(g.season)!==season||String(g.game_type)!=="REG") continue;
    const week=Number(g.week), hs=num(g.home_score), as=num(g.away_score);
    if(!Number.isFinite(week)||hs==null||as==null) continue;
    const home=canon(g.home_team),away=canon(g.away_team);
    const tracking=trackingFeatures(priorNgs,currentNgs,priorSnaps,currentSnaps,week);
    const features=blendedFeatures(priorTeam,priorPlayer,currentTeam,currentPlayer,week,tracking);
    const modelGame={neutralSite:String(g.location||"").toLowerCase()==="neutral",nflFeatures:{home:features[home]||{},away:features[away]||{}}};
coverageDiag.games++;
    for(const x of [features[home]||{},features[away]||{}]){
      coverageDiag.teamSides++;
      if(num(x.qbNgsCpoe)!=null)coverageDiag.ngsCpoe++;
      if(num(x.rushYoePerAtt)!=null)coverageDiag.rushYoe++;
      if(num(x.receivingSeparation)!=null)coverageDiag.separation++;
      if(num(x.receivingYacOe)!=null)coverageDiag.yacOe++;
      if(num(x.snapShare)!=null)coverageDiag.snapShare++;
    }
    const pro=projectNflProV1(modelGame);
    const v2=projectNflProV2(modelGame);
    const currentForm=formRows(games,season,week);
    const base=projectNflFormV0({neutralSite:String(g.location||"").toLowerCase()==="neutral"},{
      homePrior:priorForm.get(home),awayPrior:priorForm.get(away),homeCurrent:currentForm.get(home),awayCurrent:currentForm.get(away)
    });
    const actualMargin=hs-as, actualTotal=hs+as, homeWon=hs>as;
    gameInputs.push({season,week,gameId:g.game_id,modelGame,actualMargin,actualTotal,homeWon});
    outputs.push({
      season,week,gameId:g.game_id,home,away,actualHome:hs,actualAway:as,
      proOk:Boolean(pro.ok),v2Ok:Boolean(v2.ok),baseOk:Boolean(base.ok),
      proHome:pro.home??null,proAway:pro.away??null,v2Home:v2.home??null,v2Away:v2.away??null,baseHome:base.home??null,baseAway:base.away??null,
      proMarginAbs:pro.ok?Math.abs(pro.margin-actualMargin):null,
      proTotalAbs:pro.ok?Math.abs(pro.total-actualTotal):null,
      proWinnerCorrect:pro.ok?((pro.margin>0)===homeWon):false,
      v2MarginAbs:v2.ok?Math.abs(v2.margin-actualMargin):null,
      v2TotalAbs:v2.ok?Math.abs(v2.total-actualTotal):null,
      v2WinnerCorrect:v2.ok?((v2.margin>0)===homeWon):false,
      v2Coverage:v2.advancedCoverage?.share??null,
      baseMarginAbs:base.ok?Math.abs(base.margin-actualMargin):null,
      baseTotalAbs:base.ok?Math.abs(base.total-actualTotal):null,
      baseWinnerCorrect:base.ok?((base.margin>0)===homeWon):false,
    });
  }
}
function evalWeights(weights,rows){
  const scored=rows.map(r=>{const p=projectNflProV2(r.modelGame,{weights});return{ok:p.ok,marginAbs:p.ok?Math.abs(p.margin-r.actualMargin):null,totalAbs:p.ok?Math.abs(p.total-r.actualTotal):null,winner:p.ok?((p.margin>0)===r.homeWon):false};}).filter(x=>x.ok);
  return{n:scored.length,marginMae:score(scored,"marginAbs"),totalMae:score(scored,"totalAbs"),winnerAccuracy:scored.length?scored.filter(x=>x.winner).length/scored.length:null};
}
const grid=[0,0.25,0.5,0.75,1,1.25];
const weightSearch=[];
for(const pressure of grid)for(const run of grid)for(const coverageRoute of grid){
  const weights={pressure,run,coverageRoute,availability:1};
  const train=gameInputs.filter(r=>r.season===2024),test=gameInputs.filter(r=>r.season===2025);
  const tr=evalWeights(weights,train),te=evalWeights(weights,test);
  weightSearch.push({weights,train:tr,test:te,objective:(tr.marginMae??99)+(tr.totalMae??99)});
}
weightSearch.sort((a,b)=>a.objective-b.objective);
const selected=weightSearch[0];
const selectedHoldout=selected?.test||null;
const paired=outputs.filter(r=>r.proOk&&r.v2Ok&&r.baseOk);
const pro=summarize(paired,"pro"), v2=summarize(paired,"v2"), base=summarize(paired,"base");
const decision={
  sample:{seasons,n:paired.length},
  featureCoverage:coverageDiag,
  weightCalibration:{method:"2024 grid-search training only; 2025 untouched holdout",grid,selected,top5:weightSearch.slice(0,5)},
  pro,v2,base,
  deltas:{
    v2VsV1:{marginMae:v2.marginMae-pro.marginMae,totalMae:v2.totalMae-pro.totalMae,winnerAccuracy:v2.winnerAccuracy-pro.winnerAccuracy},
    v2VsForm:{marginMae:v2.marginMae-base.marginMae,totalMae:v2.totalMae-base.totalMae,winnerAccuracy:v2.winnerAccuracy-base.winnerAccuracy},
  },
  beatsV1:{
    marginMae:v2.marginMae<pro.marginMae,
    totalMae:v2.totalMae<pro.totalMae,
    winnerAccuracy:v2.winnerAccuracy>pro.winnerAccuracy,
  },
  beatsBaseline:{
    marginMae:v2.marginMae<base.marginMae,
    totalMae:v2.totalMae<base.totalMae,
    winnerAccuracy:v2.winnerAccuracy>base.winnerAccuracy,
  },
};
decision.promoteCandidate=paired.length>=400&&Object.values(decision.beatsV1).every(Boolean)&&Object.values(decision.beatsBaseline).every(Boolean);
decision.status=decision.promoteCandidate?"PROMOTION_EVIDENCE_PASS":"RESEARCH_HOLD";
decision.rule="NFL-PRO-v2 must beat NFL-PRO-v1 and calibrated form baseline on paired walk-forward margin MAE, total MAE, and winner accuracy with n>=400. Historical test only uses feature families available point-in-time in this harness; absent NGS/availability families remain missing.";
decision.featureCaveat="This run reconstructs NGS weekly passing/rushing/receiving and snap counts strictly from weeks before each target game; week=0 season summaries are excluded. Historical availability remains excluded until a timestamp-safe source is validated.";
fs.writeFileSync("artifacts/nfl-pro-walkforward-rows.jsonl",paired.map(x=>JSON.stringify(x)).join("\n")+"\n");
fs.writeFileSync("artifacts/nfl-pro-walkforward-report.json",JSON.stringify(decision,null,2));
console.log(JSON.stringify(decision,null,2));
