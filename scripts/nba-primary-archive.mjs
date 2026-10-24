#!/usr/bin/env node
// NBA Phase 23: immutable, read-only PRIMARY -> R2 historical snapshot.
// This program contains no production D1 UPDATE/DELETE/DROP/INSERT path.
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { SPORT_PREFIX_TABLES, workingTablesForSport } from "../functions/lib/sportWorkingCopy.js";

export const SOURCE_DB="b50c724c-903b-4241-8ce1-48d931e7a44c";
export const BUCKET="fbis-archive";
const prefix="nba/primary-retirement/v1";
const token=process.env.CLOUDFLARE_API_TOKEN;
const account=process.env.CLOUDFLARE_ACCOUNT_ID;
const runId=String(process.env.GITHUB_RUN_ID || "operator-manual").replace(/[^a-zA-Z0-9_-]/g,"");
const shard=Number(process.env.NBA_ARCHIVE_SHARD ?? 0);
const shards=Number(process.env.NBA_ARCHIVE_SHARDS ?? 6);
const pageSize=Number(process.env.NBA_ARCHIVE_PAGE_SIZE ?? 200);
const work=process.env.NBA_ARCHIVE_OUTPUT || "/tmp/fbis-nba-primary-archive";
const base="https://api.cloudflare.com/client/v4/accounts/"+account;
const auth={Authorization:"Bearer "+token};
const digest=b=>createHash("sha256").update(b).digest("hex");
const validIdent=s=>/^[a-z][a-z0-9_]*$/.test(s);
const allTables=[...workingTablesForSport("nba").map(t=>t.table),...SPORT_PREFIX_TABLES.nba].sort();
const shared=new Set(workingTablesForSport("nba").map(t=>t.table));
const tables=allTables.filter((_,i)=>i%shards===shard);
const archiveRoot=prefix+"/"+runId+"/";
const receipt={contract:"fbis-nba-primary-r2-retirement-v1",runId,shard,shards,sourceDatabase:SOURCE_DB,
  destinationBucket:BUCKET,archiveRoot,tableCount:tables.length,startedAt:new Date().toISOString(),
  tables:[],sourceRowsDeleted:0,sourceDbMutations:0,retentionReleaseAuthorized:false,
  deletionAuthorized:false,canAuthorizeWager:false,completed:false};
if(!token||!account)throw Error("CREDENTIALS_REQUIRED");
if(!Number.isInteger(shard)||!Number.isInteger(shards)||shards<1||shards>12||shard<0||shard>=shards)throw Error("INVALID_SHARD");
if(!Number.isInteger(pageSize)||pageSize<1||pageSize>300)throw Error("INVALID_PAGE_SIZE");
if(new Set(allTables).size!==38||allTables.length!==38||!allTables.every(validIdent))throw Error("SCOPE_MUST_BE_EXACTLY_38_SAFE_TABLES");

async function cloudflare(path,body){
 const response=await fetch(base+path,{method:body?"POST":"GET",headers:{...auth,...(body?{"content-type":"application/json"}:{})},
   body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});
 const data=await response.json();
 if(!response.ok||data.success!==true)throw Error("CLOUDFLARE_API_FAILURE_"+response.status);
 return data.result;
}
async function query(sql){
 if(!/^(SELECT|PRAGMA)\b/.test(sql))throw Error("PRIMARY_READ_ONLY_REQUIRED");
 const result=await cloudflare("/d1/database/"+SOURCE_DB+"/query",{sql});
 if(!Array.isArray(result)||result.some(x=>x.success===false||x.meta?.changed_db===true||Number(x.meta?.rows_written||0)!==0))
   throw Error("SOURCE_QUERY_READONLY_ASSERTION_FAILED");
 return result[0]?.results||[];
}
async function r2Get(key){
 const response=await fetch(base+"/r2/buckets/"+BUCKET+"/objects/"+key,
   {headers:auth,signal:AbortSignal.timeout(90000)});
 if(response.status===404)return null;
 if(!response.ok)throw Error("R2_READ_FAILED_"+response.status);
 return Buffer.from(await response.arrayBuffer());
}
async function r2PutAndReadback(key,bytes){
 const expected=digest(bytes);
 const exists=await r2Get(key);
 if(exists&&digest(exists)!==expected)throw Error("IMMUTABLE_R2_KEY_COLLISION");
 if(!exists){
  const r=await fetch(base+"/r2/buckets/"+BUCKET+"/objects/"+key,
    {method:"PUT",headers:{...auth,"content-type":"application/octet-stream"},
     body:bytes,signal:AbortSignal.timeout(90000)});
  if(!r.ok)throw Error("R2_WRITE_FAILED_"+r.status);
 }
 const read=await r2Get(key);
 if(!read||read.length!==bytes.length||digest(read)!==expected)
   throw Error("R2_SHA256_READBACK_MISMATCH");
 return read;
}
function scope(table){
 return shared.has(table) ? "sport='nba' AND " : "";
}
async function fetchPart(table,high,cursor){
 const sql="SELECT CAST(rowid AS TEXT) AS __fbis_rowid,* FROM "+table+
  " WHERE "+scope(table)+"rowid>"+cursor+" AND rowid<="+high+" ORDER BY rowid LIMIT "+pageSize;
 return query(sql);
}
async function recheckPart(table,partRows){
 if(!partRows.length)return;
 const ids=partRows.map(x=>Number(x.__fbis_rowid));
 if(!ids.every(x=>Number.isSafeInteger(x)&&x>=0))throw Error("ROWID_NOT_SAFE_INTEGER");
 const replay=await query("SELECT CAST(rowid AS TEXT) AS __fbis_rowid,* FROM "+table+
  " WHERE "+scope(table)+"rowid IN ("+ids.join(",")+") ORDER BY rowid");
 if(JSON.stringify(replay)!==JSON.stringify(partRows))throw Error("PRIMARY_SOURCE_ROWS_CHANGED_"+table);
}
async function archiveTable(table){
 const local=join(work,table);await mkdir(local,{recursive:true});
 const schema=(await query("SELECT sql FROM sqlite_master WHERE type='table' AND name='"+table+"'"))[0]?.sql;
 if(!schema||/WITHOUT ROWID/i.test(schema))throw Error("UNSUPPORTED_OR_MISSING_TABLE_SCHEMA_"+table);
 const info=await query("PRAGMA table_info("+table+")");
 const columns=info.map(x=>x.name);
 if(!columns.length||!columns.every(validIdent)||columns.includes("__fbis_rowid"))throw Error("UNSUPPORTED_COLUMN_SCHEMA_"+table);
 const stats=(await query("SELECT COUNT(*) AS n,MAX(rowid) AS hi FROM "+table+" WHERE "+(shared.has(table)?"sport='nba'":"1=1")))[0];
 const frozenCount=Number(stats?.n||0),high=Number(stats?.hi||0);
 if(!Number.isSafeInteger(frozenCount)||!Number.isSafeInteger(high))throw Error("UNSAFE_SOURCE_BOUNDARY");
 const manifest={contract:"fbis-nba-primary-table-archive-v1",table,sport:"nba",
   sourceDatabase:SOURCE_DB,scope:shared.has(table)?"sport='nba'":"entire-table",
   schema,columns,frozenUpperRowid:String(high),sourceFrozenCount:frozenCount,
   pages:0,parts:[],independentRestoreVerified:false,sourceRecheckVerified:false,
   r2ReadbackVerified:false,sourceRowsDeleted:0,retentionReleaseAuthorized:false};
 let cursor=0,index=0,observed=0;
 while(true){
  const rows=await fetchPart(table,high,cursor);
  if(!rows.length)break;
  if(shared.has(table)&&rows.some(r=>r.sport!=="nba"))throw Error("CROSS_SPORT_ROW_IN_ARCHIVE");
  const last=Number(rows.at(-1).__fbis_rowid);
  if(!Number.isSafeInteger(last)||last<=cursor||last>high)throw Error("INVALID_ROWID_PAGINATION");
  const body=Buffer.from(JSON.stringify({contract:"fbis-nba-primary-lossless-part-v1",
    table,sourceDatabase:SOURCE_DB,scope:manifest.scope,columns,
    frozenUpperRowid:String(high),rows}));
  const zipped=gzipSync(body,{level:7});
  const sha=digest(zipped);
  const key=archiveRoot+table+"/"+sha+".json.gz";
  const recovered=await r2PutAndReadback(key,zipped);
  if(digest(gunzipSync(recovered))!==digest(body))throw Error("R2_COMPRESSION_INTEGRITY_FAILED");
  const filename=join(local,"part-"+String(index).padStart(5,"0")+".json");
  await writeFile(filename,gunzipSync(recovered));
  await recheckPart(table,rows);
  manifest.parts.push({index,key,sha256:sha,uncompressedSha256:digest(body),
    firstRowid:rows[0].__fbis_rowid,lastRowid:rows.at(-1).__fbis_rowid,count:rows.length,
    localFile:filename});
  observed+=rows.length;cursor=last;index++;
  if(index>10000)throw Error("ARCHIVE_PAGE_CIRCUIT_BREAKER");
 }
 if(observed!==frozenCount)throw Error("FROZEN_ROW_COUNT_MISMATCH_"+table);
 // Check every archived row again after the last page, not merely a count.
 for(const part of manifest.parts){
  const body=JSON.parse(await readFile(part.localFile,"utf8"));
  await recheckPart(table,body.rows);
 }
 manifest.sourceRecheckVerified=true;
 const localManifest=join(local,"table-manifest.json");
 await writeFile(localManifest,JSON.stringify(manifest));
 const py=spawnSync("python3",["scripts/lib/nba-primary-archive-restore.py",localManifest],{
  encoding:"utf8",timeout:180000,maxBuffer:2*1024*1024});
 if(py.status!==0)throw Error("INDEPENDENT_SQLITE_RESTORE_FAILED_"+table+":"+(py.stderr||"").slice(-300));
 const proof=JSON.parse(py.stdout);
 if(proof.restoredRows!==frozenCount||proof.sqliteIntegrity!=="ok"||!proof.fullFieldParity)
  throw Error("INDEPENDENT_RESTORE_PARITY_FAILED_"+table);
 manifest.independentRestoreVerified=true;
 manifest.restoration=proof;
 manifest.pages=manifest.parts.length;
 manifest.r2ReadbackVerified=true;
 const shareable={...manifest,parts:manifest.parts.map(({localFile,...part})=>part)};
 const receiptBytes=Buffer.from(JSON.stringify(shareable,null,2)+"\n");
 const receiptSha=digest(receiptBytes);
 const receiptKey=archiveRoot+table+"/manifest-"+receiptSha+".json";
 await r2PutAndReadback(receiptKey,receiptBytes);
 await writeFile(join(work,table+"-verified-manifest.json"),receiptBytes);
 return {table,rows:frozenCount,pages:manifest.pages,manifestKey:receiptKey,
   manifestSha256:receiptSha,verified:true,independentRestore:proof.sqliteIntegrity,
   sourceRowsDeleted:0};
}
try{
 await mkdir(work,{recursive:true});
 for(const table of tables){
  const item=await archiveTable(table);
  receipt.tables.push(item);
  console.log(JSON.stringify({table:item.table,rows:item.rows,pages:item.pages,verified:item.verified}));
 }
 receipt.totalRows=receipt.tables.reduce((n,x)=>n+x.rows,0);
 receipt.completed=true;receipt.completedAt=new Date().toISOString();
}catch(error){
 receipt.error=String(error?.stack||error?.message||error).slice(0,1500);
 process.exitCode=1;
}finally{
 await mkdir(work,{recursive:true});
 await writeFile(join(work,"shard-"+shard+"-receipt.json"),JSON.stringify(receipt,null,2)+"\n");
 console.log(JSON.stringify({completed:receipt.completed,shard,tables:receipt.tables.length,
  rows:receipt.totalRows||0,error:receipt.error||null,sourceRowsDeleted:0}));
}
