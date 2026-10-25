#!/usr/bin/env node
// Aggregate the independently re-retrieved R2/SQLite recovery evidence.
// Does not connect to Cloudflare, PRIMARY, or NBA_DB. Never authorizes deletion.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {SPORT_PREFIX_TABLES,workingTablesForSport} from "../functions/lib/sportWorkingCopy.js";
const expectedTables=new Set([...SPORT_PREFIX_TABLES.nba,...workingTablesForSport("nba").map(t=>t.table)]);
if(expectedTables.size!==38)throw Error("SCOPE_DRIFT");
const expectedRows=[5348,41625,1972,11477,12316,40745];
const expectedCounts=[7,7,6,6,6,6];
const records=[];let sum=0,tables=0;
for(let shard=0;shard<6;shard++){
 const p="archive-evidence/independent/nba-independent-r2-recovery-"+shard+"/receipt.json";
 const r=JSON.parse(await readFile(p,"utf8"));
 if(r.contract!=="nba-phase26-independent-r2-recovery-v1"||r.shard!==shard||
  r.runId!=="40060554881"||r.verified!==true||r.tableCount!==expectedCounts[shard]||
  r.rows!==expectedRows[shard]||r.primaryReads!==0||r.primaryMutations!==0||
  r.retentionReleaseAuthorized!==false)throw Error("UNTRUSTED_INDEPENDENT_SHARD_"+shard);
 sum+=r.rows;tables+=r.tableCount;records.push(r);
}
const orig=JSON.parse(await readFile("archive-evidence/original/nba-primary-archive-certified-receipt/certified-receipt.json","utf8"));
if(orig.contract!=="fbis-nba-primary-r2-retirement-certification-v1"||orig.completed!==true||
 orig.runId!=="40060554881"||orig.archivedTableCount!==38||orig.archivedRows!==sum||
 orig.primaryDbMutations!==0||orig.primaryRowsDeleted!==0||orig.retentionReleaseAuthorized!==false||
 orig.allIndependentSQLiteRestoresPassed!==true||orig.allR2Sha256ReadbacksVerified!==true||
 orig.tables?.length!==38||new Set(orig.tables.map(x=>x.table)).size!==38||
 orig.tables.some(x=>!expectedTables.has(x.table)||x.verified!==true))
 throw Error("ORIGINAL_CERTIFICATE_MISMATCH");
if(tables!==38||sum!==113483)throw Error("RECOVERY_TOTAL_MISMATCH");
const result={contract:"fbis-nba-independent-r2-recovery-aggregate-v1",
 originalRunId:"40060554881",recoveryShards:6,restoredTables:tables,restoredRows:sum,
 independentR2ReadbackAndOfflineSQLiteRestoresVerified:true,
 originalArchiveCertificateVerified:true,primaryReads:0,primaryMutations:0,
 primaryRowsDeleted:0,retentionReleaseAuthorized:false,deletionAuthorized:false,
 observationAndConsumerAuditCertified:false,completed:true,certifiedAt:new Date().toISOString(),shards:records};
await mkdir("archive-evidence/certified",{recursive:true});
await writeFile("archive-evidence/certified/nba-independent-recovery.json",JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({completed:true,tables,rows:sum,independentRecovery:true,retentionAuthorized:false}));
