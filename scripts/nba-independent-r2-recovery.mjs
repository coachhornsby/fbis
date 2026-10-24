#!/usr/bin/env node
// Independent retrieval of the EXISTING Phase 23 R2 archive. Read-only, no PRIMARY access.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {spawnSync} from "node:child_process";
import {join,resolve} from "node:path";
const sha=b=>createHash("sha256").update(b).digest("hex");
const shard=Number(process.env.NBA_RECOVERY_SHARD);
const archiveRun="40060554881";
const root="archive-evidence/nba-primary-archive-shard-"+shard;
const output=resolve("artifacts/nba-independent-recovery/shard-"+shard);
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!Number.isInteger(shard)||shard<0||shard>5||!account||!token)throw Error("INVALID_RECOVERY_INPUT");
const receipt=JSON.parse(await readFile(root+"/shard-"+shard+"-receipt.json","utf8"));
if(!receipt.completed||receipt.runId!==archiveRun||receipt.retentionReleaseAuthorized!==false
 ||receipt.sourceRowsDeleted!==0||receipt.shard!==shard||receipt.shards!==6)throw Error("UNTRUSTED_SHARD_RECEIPT");
await mkdir(output,{recursive:true});
async function get(key){
 if(!key.startsWith("nba/primary-retirement/v1/"+archiveRun+"/")||key.includes(".."))throw Error("ARCHIVE_KEY_SCOPE");
 const u="https://api.cloudflare.com/client/v4/accounts/"+account+"/r2/buckets/fbis-archive/objects/"+key;
 const response=await fetch(u,{headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(90000)});
 if(!response.ok)throw Error("INDEPENDENT_R2_GET_"+response.status);
 return Buffer.from(await response.arrayBuffer());
}
let rows=0;
for(const entry of receipt.tables){
 const local=await readFile(root+"/"+entry.table+"-verified-manifest.json");
 if(sha(local)!==entry.manifestSha256)throw Error("ARTIFACT_MANIFEST_DIGEST_"+entry.table);
 const fromR2=await get(entry.manifestKey);
 if(sha(fromR2)!==entry.manifestSha256||!fromR2.equals(local))throw Error("R2_MANIFEST_MISMATCH_"+entry.table);
 const m=JSON.parse(fromR2);
 if(m.table!==entry.table||m.sourceFrozenCount!==entry.rows||m.sourceRowsDeleted!==0
 ||m.retentionReleaseAuthorized!==false||m.parts.length!==entry.pages)throw Error("BAD_R2_MANIFEST_"+entry.table);
 const parts=[];
 for(const part of m.parts){
  const bytes=await get(part.key);
  if(sha(bytes)!==part.sha256)throw Error("R2_PART_DIGEST_"+entry.table);
  const unzipped=gunzipSync(bytes);
  if(sha(unzipped)!==part.uncompressedSha256)throw Error("R2_PART_PAYLOAD_"+entry.table);
  const filename=join(output,entry.table+"-"+part.index+".json");
  await writeFile(filename,unzipped);
  parts.push({...part,localFile:filename});
 }
 const localManifest=join(output,entry.table+"-manifest.json");
 await writeFile(localManifest,JSON.stringify({...m,parts}));
 const p=spawnSync("python3",["scripts/lib/nba-primary-archive-restore.py",localManifest],{encoding:"utf8",timeout:180000,maxBuffer:1048576});
 if(p.status!==0)throw Error("RECOVERY_RESTORE_FAILED_"+entry.table+":"+(p.stderr||"").slice(-300));
 const check=JSON.parse(p.stdout);
 if(!check.ok||check.restoredRows!==entry.rows||!check.fullFieldParity||check.sqliteIntegrity!=="ok")
  throw Error("RECOVERY_PARITY_FAILED_"+entry.table);
 rows+=entry.rows;
 console.log(JSON.stringify({table:entry.table,rows:entry.rows,independentR2Restore:true}));
}
const result={contract:"nba-phase26-independent-r2-recovery-v1",runId:archiveRun,shard,
 tableCount:receipt.tables.length,rows,verified:true,primaryReads:0,primaryMutations:0,
 retentionReleaseAuthorized:false,completedAt:new Date().toISOString()};
await writeFile(join(output,"receipt.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result));
