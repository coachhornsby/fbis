#!/usr/bin/env node
/** Research-only 2026 paired NFL v0.2 replay; no mutation or winner promotion. */
import fs from "node:fs";
import path from "node:path";
import {simulateNflClockFieldResearch} from "../functions/lib/nflClockFieldSimulationResearch.js";
import {evaluatePairedModels} from "../functions/lib/footballPairedModelAudit.js";
const dir=process.argv[2]||"artifacts/football-sdv";
const readRows=file=>fs.readFileSync(path.join(dir,file),"utf8")
 .split("\n").filter(Boolean).map(JSON.parse);
const archive=readRows("normalized-research-games.jsonl").filter(r=>r.sport==="nfl");
const originals=readRows("nfl-paired-champion-challenger.jsonl");
const lookup=new Map(archive.map(r=>[r.gameId,r]));
const excluded={},rows=[],previous=[];
for(const p of originals){
 const g=lookup.get(p.gameId);
 if(!g){excluded.NO_VERIFIED_NFL_SOURCE=(excluded.NO_VERIFIED_NFL_SOURCE||0)+1;continue}
 try{
  const model=simulateNflClockFieldResearch({
   gameId:p.gameId,snapshotId:p.baselineSnapshotId,frozenAt:p.frozenAt,
   kickoff:p.kickoff,homeTeamId:p.homeTeamId,awayTeamId:p.awayTeamId,
   projectedHome:p.championHome,projectedAway:p.championAway,
   trainingGames:archive,iterations:150,historicalReconstruction:true});
  rows.push({...p,challengerHome:model.distributions.home_score.mean,
   challengerAway:model.distributions.away_score.mean,
   homeLeadProb:model.distributions.home_regulation_lead.mean,
   awayLeadProb:model.distributions.away_regulation_lead.mean,
   tieProb:model.distributions.regulation_tie.mean,
   homeBlowoutProb:model.distributions.home_blowout_14.mean,
   awayBlowoutProb:model.distributions.away_blowout_14.mean,
   modelId:model.modelId,timeEvidence:model.timeEvidence,
   fieldPositionMode:model.fieldPositionMode,
   durationRule:model.durationRule,modelEvidenceFingerprint:model.evidenceFingerprint,
   clockedTrainingDrives:model.clockedTrainingDrives});
  previous.push(p);
 }catch(e){const reason=String(e.message||e);excluded[reason]=(excluded[reason]||0)+1}
}
const newModel=evaluatePairedModels(rows,{sport:"nfl",minimumSample:15,bootstrapDraws:1000});
const previousModel=evaluatePairedModels(previous,{sport:"nfl",minimumSample:15,bootstrapDraws:1000});
const report={evaluatedAt:new Date().toISOString(),mode:"POSTGAME_RECONSTRUCTED_NOT_PROSPECTIVE",
 source:"SDV_NFLVERSE_GAME_SECONDS_REMAINING",
 model:"NFL-VERIFIED-PLAYCLOCK-FIELD-SHADOW-v0.2",
 n:rows.length,excluded,previousModel,newModel,
 clockEvidence:"FIRST_TO_LAST_PLAY_TIMESTAMP_LOWER_BOUND",
 durationModel:"HEURISTIC_PLUS_25_S_NOT_EXACT_DRIVE_DURATION",
 fieldTransitions:"NOT_FULLY_MODELED",
 candidatePromotion:"BLOCKED_PROSPECTIVE_NOT_VALIDATED",
 canQualify:false,canAuthorizeWager:false,changesProductionChampion:false};
fs.writeFileSync(path.join(dir,"nfl-clock-field-holdout.json"),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(dir,"nfl-clock-field-per-game.jsonl"),rows.map(x=>JSON.stringify(x)).join("\n")+"\n");
console.log(JSON.stringify({n:report.n,excluded,
 championMarginMAE:newModel.champion.marginMAE,
 oldMarginMAE:previousModel.challenger.marginMAE,
 clockMarginMAE:newModel.challenger.marginMAE,
 oldTotalMAE:previousModel.challenger.totalMAE,
 clockTotalMAE:newModel.challenger.totalMAE,
 canAuthorizeWager:false},null,2));
if(report.n<15)throw Error("NFL_CLOCK_STATE_HOLDOUT_INSUFFICIENT_VERIFIED_EVIDENCE");
