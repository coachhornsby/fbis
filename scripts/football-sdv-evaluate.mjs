#!/usr/bin/env node
/**
 * SDV archived football drive normalization + walk-forward research.
 *
 * Archive observedAt is the acquisition date. Historical evaluation is explicitly
 * RECONSTRUCTED and cannot be represented as prospectively captured evidence.
 * The current sport ranking engines and canonical wagers are never touched.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import crypto from "node:crypto";
import {extractNflfastRPossessionGame} from "../functions/lib/nflPbpDriveResearchAdapter.js";
import {extractSdvCfbDriveGame} from "../functions/lib/cfbSdvPbpDriveAdapter.js";
import {simulateMatchupDriveShadow,selectMatchupDriveHistory} from "../functions/lib/footballPossessionMatchupResearch.js";

const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith("--")).map(x=>x.slice(2).split("=")));
const folder=args.input||"artifacts/football-sdv";
const maxGames=Math.min(400,Math.max(1,Number(args.maxGames||200)));
const rounds=Math.min(500,Math.max(100,Number(args.iterations||150)));
const now=new Date().toISOString(),stats={},all=[],historicMarkets=new Map();
const mark=(s,key)=>{s[key]=(s[key]||0)+1};
async function load(file){
 const sport=path.basename(file).split("-")[0];
 const counter=stats[sport]??={sources:0,accepted:0,rejected:{},bySeason:{}};
 const reader=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
 for await(const line of reader){
  if(!line.trim())continue;
  counter.sources++;
  try{
   const raw=JSON.parse(line);
   if(raw.marketReference?.source==="NFLVERSE_PFR_HISTORICAL_CLOSING"&&
     Number.isFinite(raw.marketReference.homeMargin)&&Number.isFinite(raw.marketReference.total))
    historicMarkets.set(sport+"|"+raw.gameId,raw.marketReference);
   const sourceArtifactHash=crypto.createHash("sha256").update(JSON.stringify(raw.sourceRows)).digest("hex");
   const fn=sport==="nfl"?extractNflfastRPossessionGame:extractSdvCfbDriveGame;
   const game=fn({gameId:raw.gameId,kickoff:raw.kickoff,
    gradedAt:raw.gradedAt,observedAt:raw.observedAt,
    sourceRows:raw.sourceRows,plays:raw.sourceRows,
    sourceArtifactHash,sourceAsset:raw.sourceAsset});
   game.sport=sport;game.season=raw.season;
   game.sourceAsset=raw.sourceAsset;
   // Immutable per-game content fingerprint; do not hash the current observation clock.
   if(sport==="nfl")game.sourceFingerprint=sourceArtifactHash;
   game.evidenceClass="POSTGAME_RECONSTRUCTED";game.prospective=false;
   counter.accepted++;counter.bySeason[raw.season]=(counter.bySeason[raw.season]||0)+1;
   all.push(game);
  }catch(e){mark(counter.rejected,String(e.message||e).slice(0,90))}
 }
}
const files=fs.readdirSync(folder).filter(f=>/^(nfl|cfb)-\d{4}-games\.jsonl$/.test(f)).sort();
for(const file of files)await load(path.join(folder,file));
fs.writeFileSync(path.join(folder,"normalized-research-games.jsonl"),all.map(g=>JSON.stringify(g)).join("\n")+"\n");
function mean(xs){return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null}
function fairBaseline(g,training){
 function aggregate(team,type){
  const xs=training.filter(x=>x.homeTeamId===team||x.awayTeamId===team).map(x=>{
   const home=x.homeTeamId===team;
   return type==="for"?(home?x.homeScore:x.awayScore):(home?x.awayScore:x.homeScore);
  });
  return xs.length>=3?mean(xs):null;
 }
 const hFor=aggregate(g.homeTeamId,"for"),aFor=aggregate(g.awayTeamId,"for");
 const hAllow=aggregate(g.homeTeamId,"allow"),aAllow=aggregate(g.awayTeamId,"allow");
 if([hFor,aFor,hAllow,aAllow].some(x=>x===null))return null;
 return {home:(hFor+aAllow)/2,away:(aFor+hAllow)/2};
}
const round=x=>x===null?null:Math.round(x*10000)/10000;
function grade(items){
 const n=items.length;
 const paired=items.filter(x=>x.historicalMarket&&Number.isFinite(x.historicalMarket.homeMargin)&&
   Number.isFinite(x.historicalMarket.total));
 const buckets=Array.from({length:10},(_,k)=>{
  const xs=items.filter(x=>Math.min(9,Math.floor(x.homeProb*10))===k);
  return {bin:k,n:xs.length,predicted:round(mean(xs.map(x=>x.homeProb))),
   observed:round(mean(xs.map(x=>Number(x.homeScore>x.awayScore))))};
 });
 return {games:n,winBrier:round(mean(items.map(x=>x.brier))),
  winLogLoss:round(mean(items.map(x=>x.logLoss))),
  projectedMarginMAE:round(mean(items.map(x=>Math.abs(x.predMargin-(x.homeScore-x.awayScore))))),
  projectedTotalMAE:round(mean(items.map(x=>Math.abs(x.predTotal-(x.homeScore+x.awayScore))))),
  blowout14Brier:round(mean(items.map(x=>x.blowoutBrier))),
  medianRankP:round(mean(items.map(x=>Math.max(x.homeProb,x.awayProb)))),
  calibrationBuckets:buckets,
  historicalClosingLineComparison:{source:"NFLVERSE_PFR_HISTORICAL_CLOSING",
   sampleN:paired.length,
   referenceMarginMAE:round(mean(paired.map(x=>Math.abs(x.historicalMarket.homeMargin-(x.homeScore-x.awayScore))))),
   referenceTotalMAE:round(mean(paired.map(x=>Math.abs(x.historicalMarket.total-(x.homeScore+x.awayScore))))),
   challengerMarginMAE:round(mean(paired.map(x=>Math.abs(x.predMargin-(x.homeScore-x.awayScore))))),
   challengerTotalMAE:round(mean(paired.map(x=>Math.abs(x.predTotal-(x.homeScore+x.awayScore))))),
   contemporaneousQuotesVerified:false,CLV:null,ROI:null}};
}
const reports={};
const minTrain=20;
for(const sport of ["nfl","cfb"]){
 const games=all.filter(x=>x.sport===sport).sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.gameId.localeCompare(b.gameId));
 const holdout=games.filter(x=>x.season>=2025).slice(0,maxGames);
 const outcomes=[],excluded={},prevModel=[];
 for(const g of holdout){
  // Retrospective cutoff: 24h before actual schedule kickoff.
  // Cannot claim that today's SDV archive existed at this point in the past.
  const frozenAt=new Date(Date.parse(g.kickoff)-86400000).toISOString();
  const pool=games.filter(x=>Date.parse(x.kickoff)<Date.parse(frozenAt));
  if(pool.length<minTrain){mark(excluded,"INSUFFICIENT_PRIOR_GAMES");continue}
  const baseline=fairBaseline(g,pool);
  if(!baseline){mark(excluded,"NO_PREGAME_TEAM_SCORING_HISTORY");continue}
  const id="SDV_HISTORICAL_RECONSTRUCTION:"+g.gameId;
  let r;
  try{
   const coverage=selectMatchupDriveHistory(pool,{sport,targetGameId:g.gameId,frozenAt,
     homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,historicalReconstruction:true});
   if(!coverage.eligible){mark(excluded,"INSUFFICIENT_VERIFIED_MATCHUP_HISTORY");continue}
   r=simulateMatchupDriveShadow({sport,gameId:g.gameId,snapshotId:id,frozenAt,
    kickoff:g.kickoff,homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,
    projectedHome:baseline.home,projectedAway:baseline.away,trainingGames:pool,
    historicalReconstruction:true,iterations:rounds});
  }catch(e){mark(excluded,String(e.message||e).slice(0,90));continue}
  const d=r.distributions, ps=[d.home_regulation_lead.mean,
    d.away_regulation_lead.mean,d.regulation_tie.mean];
  const actual=g.homeScore>g.awayScore?0:g.homeScore<g.awayScore?1:2;
  const hbo=Number(g.homeScore-g.awayScore>=14),abo=Number(g.awayScore-g.homeScore>=14);
  outcomes.push({gameId:g.gameId,kickoff:g.kickoff,season:g.season,homeTeamId:g.homeTeamId,
   awayTeamId:g.awayTeamId,homeScore:g.homeScore,awayScore:g.awayScore,
   sourceFingerprint:g.sourceFingerprint,sourceObservedAt:g.observedAt,
   historicalMarket:historicMarkets.get(sport+"|"+g.gameId)||null,
   reconstructed:true,prospective:false,trainingGames:r.trainingGames,trainingDrives:r.trainingDrives,
   modelId:r.modelId,modelVersion:r.modelVersion,iterations:r.iterations,
   homeProb:ps[0],awayProb:ps[1],tieProb:ps[2],
   predMargin:d.margin.mean,predTotal:d.total.mean,
   brier:ps.reduce((a,p,i)=>a+(p-Number(actual===i))**2,0),
   logLoss:-Math.log(Math.max(1e-12,ps[actual])),
   blowoutBrier:((d.home_blowout_14.mean-hbo)**2+(d.away_blowout_14.mean-abo)**2)/2});
 }
 reports[sport]={archiveGames:games.length,holdoutCandidates:holdout.length,
  reconstructedOnly:true,prospective:false,excluded,
  model:grade(outcomes),baseline:"lagged team points for / opponent allowed",
  liveChampionComparison:null,closingPriceComparison:sport==="nfl"?"RETROSPECTIVE_PFR_CLOSING_COMPARISON":null,
  contemporaneousPricingVerified:false,CLV:null,ROI:null,
  limitations:["SDV archive observed after games; not strict historical point-in-time",
    "No contemporaneous wager/closing line ledger joined",
    "Empirical challenger never promotes on retrospective results"]};
 const out=path.join(folder,sport+"-reconstructed-backtest.jsonl");
 fs.writeFileSync(out,outcomes.map(o=>JSON.stringify(o)).join("\n")+"\n");
}
const report={runAt:now,evidenceMode:"POSTGAME_RECONSTRUCTED_NOT_PIT",
 source:"sportsdataverse-py",canAuthorizeWager:false,canQualify:false,
 acquisitionSummary:stats,cohorts:reports,
 policy:"No substitution for prospective captures, market-grade evidence, or model champion."};
fs.writeFileSync(path.join(folder,"football-sdv-evaluation.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({acquisition:stats,evaluation:Object.fromEntries(
 Object.entries(reports).map(([k,v])=>[k,{n:v.model.games,excluded:v.excluded}]))},null,2));
if(stats.nfl?.accepted<30||stats.cfb?.accepted<30)
 throw Error("SDV_VERIFIED_GAME_COVERAGE_BELOW_MINIMUM");
