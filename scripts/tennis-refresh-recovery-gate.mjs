#!/usr/bin/env node
/**
 * Dispatch deduplication for a GitHub runner that started after Cloudflare
 * requested recovery. Existing GitHub runner concurrency is still required.
 */
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {evaluateTennisRefreshScope} from "../workers/tennis-refresh-health.mjs";
import {TENNIS_RECOVERY_AGE_MINUTES} from "../workers/tennis-refresh-recovery.mjs";

export function decideTennisRecoveryExecution(scope,health,manifest,now=Date.now()){
  if(!["current","full"].includes(scope))return {ok:false,run:false,reason:"INVALID_SCOPE"};
  const result=evaluateTennisRefreshScope(scope,health,manifest,now);
  if(!["HEALTHY","STALE"].includes(result.state))
    return {ok:false,run:false,reason:"SOURCE_LINEAGE_UNVERIFIED",evidence:result};
  if(result.ageMinutes < TENNIS_RECOVERY_AGE_MINUTES[scope])
    return {ok:true,run:false,reason:"ALREADY_REFRESHED_DURING_QUEUE",evidence:result};
  return {ok:true,run:true,reason:"STALE_REQUIRES_REFRESH",evidence:result};
}

export async function main(args=process.argv.slice(2)){
  const [scope,healthPath,manifestPath,outputPath]=args;
  if(!outputPath||!healthPath||!manifestPath)throw Error("usage: node scripts/tennis-refresh-recovery-gate.mjs scope health manifest GITHUB_OUTPUT");
  const [health,manifest]=await Promise.all([
    readFile(healthPath,"utf8").then(JSON.parse),
    readFile(manifestPath,"utf8").then(JSON.parse),
  ]);
  const decision=decideTennisRecoveryExecution(scope,health,manifest);
  console.log(JSON.stringify(decision));
  if(!decision.ok)throw Error(`TENNIS_RECOVERY_PREFLIGHT_${decision.reason}`);
  await import("node:fs/promises").then(({appendFile})=>
    appendFile(outputPath,`run=${decision.run?'true':'false'}\n`));
  return decision;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{console.error(e.message);process.exitCode=1;});
