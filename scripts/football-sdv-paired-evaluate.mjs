#!/usr/bin/env node
/**
 * Matched, retrospective FBIS champion vs empirical drive challenger evaluation.
 * Each game shares the same verified outcome and the identical frozen champion
 * score baseline. SDV history was obtained after the games; no prospective
 * qualification or independent model-performance claim is permitted.
 */
import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import {simulateMatchupDriveShadow} from "../functions/lib/footballPossessionMatchupResearch.js";
import {evaluatePairedModels} from "../functions/lib/footballPairedModelAudit.js";
const args=Object.fromEntries(process.argv.slice(2).filter(s=>s.startsWith("--")).map(s=>s.slice(2).split("=")));
const dir=args.input||"artifacts/football-sdv",rounds=Number(args.iterations||150),min=Number(args.min||8);
if(!Number.isInteger(rounds)||rounds<100||rounds>1000)throw Error("INVALID_SIMULATION_DRAW_COUNT");
const raw=fs.readFileSync(path.join(dir,"normalized-research-games.jsonl"),"utf8");
const games=raw.trim().split("\n").filter(Boolean).map(x=>JSON.parse(x));
const bySport=Object.groupBy(games,g=>g.sport);
const exclusions={},out={},reports={};
function count(reason,sport){exclusions[sport]??={};exclusions[sport][reason]=(exclusions[sport][reason]||0)+1}
function readChampion(file){
 let raw=JSON.parse(fs.readFileSync(file,"utf8"));
 if(Array.isArray(raw)&&raw.length===1&&Array.isArray(raw[0].results))raw=raw[0].results;
 if(raw?.result?.length===1&&Array.isArray(raw.result[0].results))raw=raw.result[0].results;
 if(!Array.isArray(raw))throw Error("CHAMPION_EXPORT_NOT_ARRAY");
 return raw;
}
for(const sport of ["nfl","cfb"]){
 const exports=readChampion(path.join(dir,sport+"-matched-champions.json"));
 const pool=bySport[sport]||[],lookup=new Map(pool.map(g=>[g.gameId,g])),rows=[];
 for(const b of exports){
  const g=lookup.get(String(b.gameId));
  if(!g){count("NO_RECONCILED_SOURCE_GAME",sport);continue}
  const frozenAt=b.frozenAt;
  if(!frozenAt||!b.snapshotId||
    !(Date.parse(frozenAt)<Date.parse(g.kickoff))||
    Math.abs(Date.parse(b.kickoff)-Date.parse(g.kickoff))>60000||
    g.homeTeamId!==b.homeTeamId||g.awayTeamId!==b.awayTeamId||
    ![b.champHome,b.champAway].every(n=>Number.isFinite(n)&&n>=0&&n<=90)||
    ![g.homeScore,g.awayScore].every(Number.isFinite)){
     count("BASELINE_OR_TEAM_MISMATCH",sport);continue;
  }
  let simulation;
  try{
   simulation=simulateMatchupDriveShadow({
    sport,gameId:String(g.gameId),snapshotId:String(b.snapshotId),
    frozenAt,kickoff:g.kickoff,homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,
    projectedHome:b.champHome,projectedAway:b.champAway,
    trainingGames:pool,historicalReconstruction:true,iterations:rounds});
  }catch(e){count(String(e.message||e).slice(0,90),sport);continue}
  rows.push({
   sport,gameId:g.gameId,kickoff:g.kickoff,homeTeamId:g.homeTeamId,awayTeamId:g.awayTeamId,
   frozenAt,baselineSnapshotId:b.snapshotId,baselineVersion:b.baselineVersion,
   archiveSourceObservedAt:g.observedAt,sourceFingerprint:g.sourceFingerprint,
   trainingGames:simulation.trainingGames,trainingDrives:simulation.trainingDrives,
   simulations:simulation.iterations,actualHome:g.homeScore,actualAway:g.awayScore,
   championHome:b.champHome,championAway:b.champAway,
   challengerHome:simulation.distributions.home_score.mean,
   challengerAway:simulation.distributions.away_score.mean,
   homeLeadProb:simulation.distributions.home_regulation_lead.mean,
   awayLeadProb:simulation.distributions.away_regulation_lead.mean,
   tieProb:simulation.distributions.regulation_tie.mean,
   homeBlowoutProb:simulation.distributions.home_blowout_14.mean,
   awayBlowoutProb:simulation.distributions.away_blowout_14.mean,
   evidenceMode:"RECONSTRUCTED_HISTORICAL_NOT_PIT",prospective:false,
   canAuthorizeWager:false});
 }
 out[sport]=rows;
 reports[sport]=evaluatePairedModels(rows,{sport,minimumSample:min,bootstrapDraws:800});
 fs.writeFileSync(path.join(dir,sport+"-paired-champion-challenger.jsonl"),rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
}
const audit={generatedAt:new Date().toISOString(),model:"EMPIRICAL_DRIVE_CHALLENGER_CONDITIONED_ON_FROZEN_FBiS_SCORES",
 method:"PAIRED_POSTGAME_RECONSTRUCTED_HISTORICAL",originalArchivePIT:false,
 canQualify:false,canAuthorizeWager:false,exclusions,reports,
 note:"Frozen original FBIS projections are used as challenger baseline inputs. Improvement is an incremental ablation, not independent champion competition."};
fs.writeFileSync(path.join(dir,"football-paired-audit.json"),JSON.stringify(audit,null,2));
console.log(JSON.stringify({paired:Object.fromEntries(Object.entries(reports).map(([s,r])=>[s,{
 n:r.n,status:r.status,championMarginMAE:r.champion.marginMAE,
 challengerMarginMAE:r.challenger.marginMAE,
 championTotalMAE:r.champion.totalMAE,challengerTotalMAE:r.challenger.totalMAE,
 exclusions:exclusions[s]}]))},null,2));
