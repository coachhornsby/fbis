#!/usr/bin/env node
// Consolidate six immutable R2 evidence shards. No production mutation.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { SPORT_PREFIX_TABLES, workingTablesForSport } from "../functions/lib/sportWorkingCopy.js";
const sha256=s=>createHash("sha256").update(s).digest("hex");
const names=[...workingTablesForSport("nba").map(x=>x.table),...SPORT_PREFIX_TABLES.nba].sort();
if(names.length!==38||new Set(names).size!==38)throw Error("NBA_ARCHIVE_SCOPE_NOT_38_TABLES");
const received=new Set(),records=[],sources=[],manifestHashes=[];
const root="archive-evidence";
for(let shard=0;shard<6;shard++){
 const dir=root+"/nba-primary-archive-shard-"+shard;
 const receipt=JSON.parse(await readFile(dir+"/shard-"+shard+"-receipt.json","utf8"));
 if(receipt.completed!==true||receipt.sourceRowsDeleted!==0||receipt.sourceDbMutations!==0
    ||receipt.retentionReleaseAuthorized!==false||receipt.deletionAuthorized!==false
    ||receipt.shard!==shard||receipt.shards!==6)throw Error("INVALID_SHARD_RECEIPT_"+shard);
 const expected=names.filter((_,i)=>i%6===shard);
 if(receipt.tables.length!==expected.length)throw Error("INCOMPLETE_SHARD_"+shard);
 for(const item of receipt.tables){
  if(!expected.includes(item.table)||received.has(item.table)||!item.verified)
   throw Error("TABLE_MISSING_DUPLICATE_OR_UNVERIFIED_"+item.table);
  received.add(item.table);
  const bytes=await readFile(dir+"/"+item.table+"-verified-manifest.json");
  if(sha256(bytes)!==item.manifestSha256)throw Error("ARCHIVE_MANIFEST_DIGEST_MISMATCH_"+item.table);
  const m=JSON.parse(bytes.toString("utf8"));
  if(!m.independentRestoreVerified||!m.r2ReadbackVerified||!m.sourceRecheckVerified
    ||m.sourceRowsDeleted!==0||m.retentionReleaseAuthorized!==false
    ||m.sourceFrozenCount!==item.rows||m.parts.length!==item.pages
    ||m.restoration?.restoredRows!==item.rows||m.restoration?.sqliteIntegrity!=="ok"
    ||m.restoration?.fullFieldParity!==true)throw Error("ARCHIVE_RESTORE_UNVERIFIED_"+item.table);
  if(m.parts.reduce((sum,x)=>sum+x.count,0)!==item.rows)throw Error("PART_COUNT_MISMATCH_"+item.table);
  records.push({table:item.table,rows:item.rows,pages:item.pages,manifestKey:item.manifestKey,
    manifestSha256:item.manifestSha256,verified:true});
  manifestHashes.push(item.manifestSha256);
 }
 sources.push(receipt.runId);
}
if(received.size!==38||new Set(sources).size!==1)throw Error("ARCHIVE_COVERAGE_OR_RUN_MISMATCH");
const result={contract:"fbis-nba-primary-r2-retirement-certification-v1",certifiedAt:new Date().toISOString(),
 runId:sources[0],sourceDatabase:"b50c724c-903b-4241-8ce1-48d931e7a44c",
 destinationBucket:"fbis-archive",archivedTableCount:38,
 archivedRows:records.reduce((n,r)=>n+r.rows,0),
 manifestsSha256:sha256(Buffer.from(manifestHashes.sort().join("\n"))),
 allR2Sha256ReadbacksVerified:true,allSourceRechecksVerified:true,
 allIndependentSQLiteRestoresPassed:true,primaryRowsDeleted:0,
 primaryDbMutations:0,retentionReleaseAuthorized:false,
 deletionAuthorized:false,canAuthorizeWager:false,
 tables:records.sort((a,b)=>a.table.localeCompare(b.table)),completed:true};
await writeFile(root+"/certified-receipt.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({completed:result.completed,archiveTables:38,rows:result.archivedRows,
 r2Verified:true,independentRestore:true,sourceRowsDeleted:0,retentionAuthorized:false}));
