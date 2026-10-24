#!/usr/bin/env node
// Exhaustive PRIMARY historical NBA key coverage against independent NBA_DB.
// Source and destination both read-only; values may legitimately differ post-cutover.
import {mkdir,writeFile} from "node:fs/promises";
import {SPORT_PREFIX_TABLES} from "../functions/lib/sportWorkingCopy.js";
const primary="b50c724c-903b-4241-8ce1-48d931e7a44c";
const nba="ed992525-d2ed-4b1d-8a12-feeb2efa152c";
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const group=Number(process.env.NBA_AUDIT_SHARD??0),shards=Number(process.env.NBA_AUDIT_SHARDS??6);
const out=process.env.NBA_AUDIT_OUTPUT||"artifacts/nba-source-coverage";
const tables=[...SPORT_PREFIX_TABLES.nba].sort();
if(!account||!token)throw Error("CLOUDFLARE_CREDENTIALS_REQUIRED");
if(!Number.isInteger(group)||!Number.isInteger(shards)||group<0||group>=shards||shards!==6)throw Error("INVALID_SHARD");
if(tables.length!==31||new Set(tables).size!==31||tables.some(t=>!/^nba_[a-z0-9_]+$/.test(t)))throw Error("INVALID_NBA_PREFIX_ALLOWLIST");
const headers={Authorization:"Bearer "+token,"Content-Type":"application/json"};
const base="https://api.cloudflare.com/client/v4/accounts/"+account;
async function query(database,sql,params=[]){
 let last;
 for(let attempt=0;attempt<5;attempt++){
  try{
   const res=await fetch(base+"/d1/database/"+database+"/query",{method:"POST",headers,
    body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(45000)});
   const data=await res.json();
   if(res.ok&&data.success===true&&data.result?.[0]?.success!==false){
    if(data.result?.[0]?.meta?.changed_db||Number(data.result?.[0]?.meta?.rows_written||0)!==0)throw Error("UNEXPECTED_SOURCE_MUTATION");
    return data.result?.[0]?.results||[];
   }
   last=new Error("D1_READ_FAILED_"+res.status+"_"+JSON.stringify(data.errors).slice(0,240));
  }catch(error){last=error;if(error?.message==="UNEXPECTED_SOURCE_MUTATION")throw error;}
  await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
 throw last;
}
const results=[];
await mkdir(out,{recursive:true});
for(const table of tables.filter((_,i)=>i%6===group)){
 const columns=await query(primary,"PRAGMA table_info("+table+")");
 const pk=columns.filter(x=>x.pk>0).sort((a,b)=>a.pk-b.pk).map(x=>x.name);
 if(pk.length!==1||!/^[a-z0-9_]+$/.test(pk[0]))throw Error("PK_SCHEMA_UNSUPPORTED_"+table);
 const key=pk[0];
 const srcStats=(await query(primary,"SELECT COUNT(*) n FROM "+table))[0];
 const destStats=(await query(nba,"SELECT COUNT(*) n FROM "+table))[0];
 const sourceCount=Number(srcStats?.n),destinationCount=Number(destStats?.n);
 if(!Number.isSafeInteger(sourceCount)||!Number.isSafeInteger(destinationCount))throw Error("INVALID_COUNT");
 let cursor=null,scanned=0,missing=0,pages=0;
 const samples=[];
 while(scanned<sourceCount){
  const sourceRows=await query(primary,"SELECT "+key+" AS source_key FROM "+table+
    " WHERE (? IS NULL OR "+key+">?) ORDER BY "+key+" LIMIT 40",[cursor,cursor]);
  if(sourceRows.length===0)throw Error("EARLY_SOURCE_EXHAUSTION_"+table);
  const ids=sourceRows.map(x=>x.source_key);
  if(ids.some(x=>x===null||x===undefined))throw Error("NULL_SOURCE_PK_"+table);
  const found=await query(nba,"SELECT "+key+" AS source_key FROM "+table+
    " WHERE "+key+" IN ("+ids.map(()=>"?").join(",")+")",ids);
  const present=new Set(found.map(x=>String(x.source_key)));
  for(const value of ids)if(!present.has(String(value))){missing++;if(samples.length<10)samples.push(String(value));}
  scanned+=ids.length;
  cursor=ids.at(-1);
  pages++;
  if(pages>5000)throw Error("PAGINATION_BUDGET_EXCEEDED_"+table);
 }
 const recount=Number((await query(primary,"SELECT COUNT(*) n FROM "+table))[0]?.n);
 const row={table,primaryCount:sourceCount,nbaCount:destinationCount,scanned,
   primaryCountAtFinish:recount,missingSourceKeys:missing,missingKeySamples:samples,
   sourceCoverageVerified:scanned===sourceCount&&recount===sourceCount&&missing===0,
   noSourceD1Writes:true,canAuthorizeWager:false};
 results.push(row);
 console.log(JSON.stringify({table,scanned,primaryCount:sourceCount,nbaCount:destinationCount,missing}));
}
const summary={contract:"fbis-nba-primary-source-key-coverage-v1",shard:group,shards,
  createdAt:new Date().toISOString(),tables:results,checked:results.length,
  sourceRowsChecked:results.reduce((n,x)=>n+x.scanned,0),
  missing:results.reduce((n,x)=>n+x.missingSourceKeys,0),
  completed:true,sourceRowsDeleted:0,sourceDbMutations:0,
  retentionReleaseAuthorized:false,canAuthorizeWager:false};
await writeFile(out+"/source-key-shard-"+group+".json",JSON.stringify(summary,null,2)+"\n");
if(summary.missing>0||results.some(x=>!x.sourceCoverageVerified))process.exitCode=2;
console.log(JSON.stringify({completed:true,shard:group,rowsChecked:summary.sourceRowsChecked,missing:summary.missing,ok:process.exitCode!==2}));
