#!/usr/bin/env node
/**
 * Independent D1 read-only reconciliation gate, before promoting NBA team
 * profiles to current R2. Catches partially committed multi-file imports.
 */
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const defaultSql=`SELECT
 (SELECT COUNT(DISTINCT team_id) FROM nba_team_profiles WHERE as_of=?) AS teams,
 (SELECT COUNT(DISTINCT team_key) FROM nba_team_profile_snapshots WHERE as_of=?) AS snapshots,
 (SELECT COUNT(DISTINCT player_id) FROM nba_player_state_profiles WHERE as_of=?) AS players,
 (SELECT COUNT(*) FROM nba_team_schedule_items WHERE observed_at=?) AS schedule_items`;

export function checkNbaProfileReconciliation(profile, counts) {
  const asOf=profile?.asOf;
  const quality=profile?.quality||{};
  const problems=[];
  if(!Number.isFinite(Date.parse(asOf||"")))problems.push("AS_OF_MISSING");
  if(quality.teams!==30||!(quality.players>300)||!(quality.scheduleItems>1000))
    problems.push("SOURCE_QUALITY_UNVERIFIED");
  const found=counts||{};
  if(Number(found.teams)!==30)problems.push("TEAM_PROFILE_COUNT_INCOMPLETE");
  if(Number(found.snapshots)!==30)problems.push("IMMUTABLE_TEAM_SNAPSHOT_COUNT_INCOMPLETE");
  if(!Number.isInteger(Number(found.players))||Number(found.players)<300 ||
     Number(found.players)<Math.floor(Number(quality.players||0)*.95))
    problems.push("PLAYER_PERSISTENCE_INCOMPLETE");
  if(!Number.isInteger(Number(found.schedule_items))||Number(found.schedule_items)<1000 ||
     Number(found.schedule_items)<Math.floor(Number(quality.scheduleItems||0)*.95))
    problems.push("SCHEDULE_PERSISTENCE_INCOMPLETE");
  return {ok:problems.length===0,asOf,sourceQuality:quality,persisted:found,problems};
}

export function parseD1Counts(apiResult) {
  const body=apiResult;
  if(body?.success!==true||!Array.isArray(body.result)||body.result[0]?.success===false)
    throw new Error(`D1_READ_ONLY_RECONCILIATION_FAILED_${body?.errors?.[0]?.code??"UNKNOWN"}`);
  const row=body.result[0]?.results?.[0];
  if(!row)throw new Error("D1_RECONCILIATION_NO_ROWS");
  return row;
}

export function parseWranglerD1Counts(body) {
  const rows=Array.isArray(body)?body:body?.result;
  const row=rows?.[0]?.results?.[0];
  if(!row||rows?.[0]?.success===false)throw new Error("WRANGLER_READ_ONLY_COUNTS_UNAVAILABLE");
  return row;
}

export async function queryWranglerReadOnly(sql) {
  return new Promise((resolve,reject)=>{
    const child=spawn("npx",["wrangler","d1","execute","fbis","--remote","--json","--command",sql],{
      stdio:["ignore","pipe","pipe"],env:process.env,
    });
    let stdout="",stderr="";
    child.stdout.on("data",data=>{stdout+=String(data);});
    child.stderr.on("data",data=>{stderr=(stderr+String(data)).slice(-3000);});
    child.on("error",reject);
    child.on("close",code=>{
      if(code!==0){reject(new Error("WRANGLER_D1_READ_FAILED "+stderr.slice(-280)));return;}
      try{resolve(parseWranglerD1Counts(JSON.parse(stdout)));}
      catch(e){reject(e);}
    });
  });
}

export async function readNbaPersistence(profile,{fetchImpl=fetch,env=process.env,wranglerRead=queryWranglerReadOnly}={}) {
  const account=env.CLOUDFLARE_ACCOUNT_ID;
  const token=env.CLOUDFLARE_API_TOKEN;
  const database=env.CLOUDFLARE_D1_DATABASE_ID||"b50c724c-903b-4241-8ce1-48d931e7a44c";
  if(!account||!token||!database)throw new Error("D1_READ_ONLY_CREDENTIALS_UNAVAILABLE");
  const asOf=String(profile?.asOf||"");
  if(!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(asOf))
    throw new Error("RECONCILIATION_AS_OF_INVALID");
  try {
    const res=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/query`,{
      method:"POST",
      headers:{"authorization":`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({sql:defaultSql,params:Array(4).fill(asOf)}),
      signal:AbortSignal.timeout(20000),
    });
    if(!res.ok)throw new Error(`D1_RECONCILIATION_HTTP_${res.status}`);
    return parseD1Counts(await res.json());
  } catch(error){
    // Only a read is retried via Wrangler, never any SQL import. A hard
    // auth/schema failure remains terminal and cannot publish R2.
    const reason=String(error?.message||error);
    if(!/7500|D1_RECONCILIATION_HTTP_50[0234]/.test(reason))throw error;
    if(typeof wranglerRead!=="function")throw error;
    console.error("D1 read-only API unavailable; attempting Wrangler read-only cross-check.");
    const safe=`'${asOf}'`;
    return wranglerRead(defaultSql.replaceAll("?",safe));
  }
}

export async function main(argv=process.argv) {
  const path=argv[2]||"artifacts/nba-team-profiles.json";
  const profile=JSON.parse(await readFile(path,"utf8"));
  const counts=await readNbaPersistence(profile);
  const evidence=checkNbaProfileReconciliation(profile,counts);
  console.log(JSON.stringify(evidence));
  if(!evidence.ok)throw new Error("NBA_PROFILE_PARTIAL_IMPORT_NOT_PUBLISHABLE");
  return evidence;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(e=>{console.error(String(e?.message||e));process.exitCode=1;});
