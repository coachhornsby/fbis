#!/usr/bin/env node
/**
 * Bounded, fail-closed retry for Cloudflare D1's *pre-import* exclusive lock.
 * Only the exact "another import" rejection is replayable: a generic D1
 * failure may have partially committed and MUST NOT be retried.
 * The workflow's job-level concurrency group prevents known NBA writer overlap.
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const RETRY_DELAYS_MS=Object.freeze([8000,20000,40000]);

export function isPreImportLock(output="") {
  return /currently processing a long-running import[\s\S]{0,160}cannot start another import until that completes or times out/i.test(String(output));
}

export async function runD1ImportWithRetry({file,execute,sleep=ms=>new Promise(r=>setTimeout(r,ms)),delays=RETRY_DELAYS_MS,log=()=>{}}) {
  if(typeof file!=="string"||!file.endsWith(".sql")||file.startsWith("-")||!file.trim())
    throw new Error("invalid SQL file");
  if(typeof execute!=="function")throw new Error("execute callback required");
  const maxAttempts=delays.length+1;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    let outcome;
    try {outcome=await execute(file,attempt);}
    catch(error){outcome={code:1,output:String(error?.message||error)};}
    if(outcome?.code===0) {
      log({type:"IMPORT_APPLIED",file,attempt});
      return {ok:true,file,attempts:attempt};
    }
    const output=String(outcome?.output||"");
    if(!isPreImportLock(output))throw new Error(`D1_IMPORT_NON_REPLAYABLE_FAILURE file=${file} attempt=${attempt}: ${output.slice(-900)}`);
    if(attempt===maxAttempts)throw new Error(`D1_IMPORT_LOCK_EXHAUSTED file=${file} attempts=${attempt}`);
    const delay=delays[attempt-1];
    log({type:"PRE_IMPORT_LOCK_RETRY",file,attempt,nextDelayMs:delay});
    await sleep(delay);
  }
  throw new Error("D1_IMPORT_UNREACHABLE");
}

function executeWrangler(file) {
  return new Promise((resolve,reject)=>{
    const child=spawn("npx",["wrangler","d1","execute","fbis","--remote",`--file=${file}`],{
      stdio:["ignore","pipe","pipe"],
      env:process.env,
    });
    let output="";
    for(const stream of [child.stdout,child.stderr]){
      stream.on("data",data=>{
        const str=String(data);
        output=(output+str).slice(-12000);
        process.stderr.write(str);
      });
    }
    child.on("error",reject);
    child.on("close",(code)=>resolve({code:code??1,output}));
  });
}

export async function main(argv=process.argv) {
  const file=argv[2];
  if(!file||argv.length!==3)throw new Error("usage: node scripts/d1-import-lock-retry.mjs path/to/file.sql");
  const info=await stat(file);
  if(!info.isFile()||info.size===0)throw new Error(`D1 import file is empty/invalid: ${file}`);
  return runD1ImportWithRetry({
    file,execute:executeWrangler,
    log:v=>process.stderr.write(JSON.stringify(v)+"\n"),
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error?.message||error);process.exitCode=1;});
}
