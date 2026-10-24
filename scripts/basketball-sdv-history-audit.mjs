#!/usr/bin/env node
/**
 * Audit real SDV release possessions. This is not a time-travel backtest:
 * generated/observed time is actual acquisition and tipoff is unresolved.
 */
import {createReadStream,createWriteStream,mkdirSync,writeFileSync,readFileSync,existsSync} from "node:fs";
import {createGunzip,createGzip} from "node:zlib";
import {createInterface} from "node:readline";
import {normalizeSdvBasketballReleaseGame} from "../functions/lib/basketballSdvReleaseHistory.js";
import {nbaCanonicalFixtureEvidence,matchNbaStatsScheduleToCanonical} from "../functions/lib/basketballSdvFixtureJoin.js";

const sport=process.argv[2],season=Number(process.argv[3]);
if(!["nba","cbb"].includes(sport)||!Number.isInteger(season))
 throw Error("INVALID_SDV_AUDIT_TARGET");
const dir="artifacts/basketball-sdv",input=dir+"/"+sport+"-"+season+"-source.jsonl.gz";
mkdirSync(dir,{recursive:true});
const rl=createInterface({input:createReadStream(input).pipe(createGunzip()),crlfDelay:Infinity});
const accepted=createWriteStream(dir+"/"+sport+"-"+season+"-reconciled.jsonl");
const gameCompression=createGzip({level:6});
const verifiedOut=createWriteStream(dir+"/"+sport+"-"+season+"-verified-games.jsonl.gz");
gameCompression.pipe(verifiedOut);
const nbaCanonicalPath=process.env.FBIS_NBA_CANONICAL_FILE||"";
if(sport==="nba"&&(!nbaCanonicalPath||!existsSync(nbaCanonicalPath)))
 throw Error("INDEPENDENT_NBA_CANONICAL_ARCHIVE_REQUIRED");
const nbaCanonical=sport==="nba"?
 nbaCanonicalFixtureEvidence(readFileSync(nbaCanonicalPath,"utf8")):null;
const report={sport,season,modelFamily:"BASKETBALL_SDV_EMPIRICAL_V0.1",
 reportType:"REAL_SOURCE_GAME_QA_NOT_BACKTEST",
 sourceRows:0,checked:0,scoreReconciled:0,withExactTipoff:0,
 admittedToTraining:0,sourceOnly:0,missingTipoff:0,
 excluded:{},sampleRejected:[],sampleAccepted:[],
 prospectivelyGraded:0,calibrated:false,canQualify:false,
 canAuthorizeWager:false,changesProductionChampion:false};
for await(const line of rl){
 if(!line.trim())continue;
 const row=JSON.parse(line);
 report.checked++;
 report.sourceRows+=row.rows.length;
 if(sport==="nba"){
  const pairing=matchNbaStatsScheduleToCanonical(row.schedule,nbaCanonical,{statsGameId:row.gameId});
  if(pairing.tipoff){row.tipoff=pairing.tipoff;row.tipoffEvidence=pairing.evidence;}
  else report.excluded["TIPOFF_"+pairing.status]=(report.excluded["TIPOFF_"+pairing.status]||0)+1;
 }
 try{
  const result=normalizeSdvBasketballReleaseGame(row);
  report.scoreReconciled++;
  if(result.status==="VERIFIED_HISTORICAL_GAME"){
   report.withExactTipoff++;report.admittedToTraining++;
   gameCompression.write(JSON.stringify(result.game)+"\n");
  } else {report.sourceOnly++;report.missingTipoff++;}
  const summary={gameId:row.gameId,season:row.season,sport,
   sourceObservedAt:result.sourceObservedAt,
   sourceFingerprint:result.sourceFingerprint??result.game?.sourceFingerprint,
   status:result.status,possessions:result.count??result.game?.possessions.length,
   tipoffVerified:result.status==="VERIFIED_HISTORICAL_GAME",
   canQualify:false,canAuthorizeWager:false};
  accepted.write(JSON.stringify(summary)+"\n");
  if(report.sampleAccepted.length<6)report.sampleAccepted.push(summary);
 }catch(err){
  const key=String(err?.message||"SDV_SOURCE_INVALID").slice(0,120);
  report.excluded[key]=(report.excluded[key]||0)+1;
  if(report.sampleRejected.length<10)
   report.sampleRejected.push({gameId:row.gameId,reason:key});
 }
}
await new Promise((resolve,reject)=>accepted.end(err=>err?reject(err):resolve()));
await new Promise((resolve,reject)=>{
 verifiedOut.on("finish",resolve);verifiedOut.on("error",reject);
 gameCompression.end();
});
report.canonicalGameCount=nbaCanonical?.distinctGames??0;
report.status=report.withExactTipoff>0?"HISTORICAL_SDV_VERIFIED_TIPOFF_SOURCE":
 report.scoreReconciled>0?"HISTORICAL_SCORE_RECONCILED_TIPOFF_UNVERIFIED":
 "NO_RECONCILED_GAMES";
writeFileSync(dir+"/"+sport+"-"+season+"-qa.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(report,null,2));
// Source validation must never "succeed" on an empty/incompatible provider export.
if(report.checked<100||report.scoreReconciled===0)process.exitCode=2;
