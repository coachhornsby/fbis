#!/usr/bin/env node
import {readFile,writeFile} from "node:fs/promises";
import {SPORT_PREFIX_TABLES} from "../functions/lib/sportWorkingCopy.js";
const expected=new Set(SPORT_PREFIX_TABLES.nba);
const seen=new Set(),rows=[];let total=0;
for(let shard=0;shard<6;shard++){
 const s=JSON.parse(await readFile("artifacts/nba-source-coverage/source-key-shard-"+shard+".json","utf8"));
 if(!s.completed||s.shard!==shard||s.shards!==6||s.sourceRowsDeleted!==0||s.sourceDbMutations!==0
 ||s.retentionReleaseAuthorized!==false||s.checked!==s.tables.length)throw Error("INVALID_SHARD_"+shard);
 for(const row of s.tables){
  if(!expected.has(row.table)||seen.has(row.table)||!row.sourceCoverageVerified||row.missingSourceKeys!==0
    ||row.scanned!==row.primaryCount||row.primaryCountAtFinish!==row.primaryCount)throw Error("FAILED_TABLE_"+row.table);
  seen.add(row.table);rows.push(row);total+=row.scanned;
 }
}
if(seen.size!==31)throw Error("INCOMPLETE_NBA_PREFIX_KEY_COVERAGE");
const receipt={contract:"fbis-nba-primary-key-coverage-certified-v1",at:new Date().toISOString(),
  tables:31,sourceRowsCovered:total,missingKeys:0,allSourceKeysPresentInSportDb:true,
  sourceRowsDeleted:0,sourceDbMutations:0,retentionReleaseAuthorized:false,
  deletionAuthorized:false,scope:"nba-prefixed-history-only",completed:true,
  records:rows.sort((a,b)=>a.table.localeCompare(b.table))};
await writeFile("artifacts/nba-source-coverage/certified.json",JSON.stringify(receipt,null,2)+"\n");
console.log(JSON.stringify({completed:true,tables:31,sourceRowsCovered:total,missing:0}));
