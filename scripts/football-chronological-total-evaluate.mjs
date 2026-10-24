#!/usr/bin/env node
/**
 * Replay the sealed 2026 SDV/FBIS paired sample without new parameter leakage.
 * No outcome from the holdout is read during alpha fitting.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {evaluateChronologicalTotalOnly} from "../functions/lib/footballChronologicalTotalResearch.js";
const dir=process.argv[2]||"artifacts/football-chronological";
const report={createdAt:new Date().toISOString(),scope:"RECONSTRUCTED_HISTORICAL_ABLATION_ONLY",
 originalSourceArtifact:"https://github.com/coachhornsby/fbis/actions/runs/40047245186/artifacts/12542310154",
 canQualify:false,canAuthorizeWager:false,noChampionChange:true,sports:{}};
for(const sport of ["nfl","cfb"]){
 const filename=path.join(dir,sport+"-paired-champion-challenger.jsonl");
 const raw=fs.readFileSync(filename,"utf8");
 const rows=raw.split("\n").filter(Boolean).map(x=>JSON.parse(x));
 const score=evaluateChronologicalTotalOnly(rows,{sport,minTrain:50,minHoldout:40});
 report.sports[sport]={...score,fileSha256:crypto.createHash("sha256").update(raw).digest("hex")};
 console.log(sport,JSON.stringify({
 n:score.n,trainN:score.trainN,holdoutN:score.holdoutN,
 alpha:score.alpha,holdout:score.holdout,status:score.status,
 canAuthorizeWager:score.canAuthorizeWager
 }));
}
if(report.sports.cfb.holdoutN<40||
   report.sports.cfb.holdout?.deltaMAE===null||
   report.sports.nfl.canAuthorizeWager!==false||report.sports.cfb.canAuthorizeWager!==false)
 throw Error("CHRONOLOGICAL_RESEARCH_READINESS_FAILED");
fs.writeFileSync(path.join(dir,"football-chronological-total-evaluation.json"),
 JSON.stringify(report,null,2));
