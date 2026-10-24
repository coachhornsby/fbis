#!/usr/bin/env node
// Controlled, operator-only recovery using deployed CORE-approved Pages handler.
// Designed to be restarted: INSERT OR IGNORE; never deletes; preserves NBA_DB.
import { SPORT_PREFIX_TABLES } from "../functions/lib/sportWorkingCopy.js";
import { mkdir,writeFile } from "node:fs/promises";
const secret=process.env.HARVEST_SECRET;
const base=process.env.FBIS_BASE_URL||"https://fbis-myz.pages.dev";
if(!secret)throw Error("HARVEST_SECRET_REQUIRED");
const maxPagesPerTable=Number(process.env.NBA_RECOVERY_MAX_PAGES||2000);
if(!Number.isSafeInteger(maxPagesPerTable)||maxPagesPerTable<1||maxPagesPerTable>10000)
 throw Error("INVALID_RECOVERY_MAX_PAGES");
const out="artifacts/nba-research-recovery";
await mkdir(out,{recursive:true});
const manifest={contract:"fbis-nba-postcutover-additive-recovery-v1",
  source:"PRIMARY",target:"NBA_DB",tables:[],startedAt:new Date().toISOString(),
  sourceRowsDeleted:0,existingRowsOverwritten:0,retentionReleaseAuthorized:false,
  canAuthorizeWager:false,completed:false};
async function request(body){
 const res=await fetch(base+"/api/database-topology",{
  method:"POST",headers:{"x-harvest-secret":secret,"content-type":"application/json"},
  body:JSON.stringify({operation:"nba-primary-research-recover",...body}),
  signal:AbortSignal.timeout(115000)});
 const data=await res.json().catch(()=>null);
 if(!res.ok||data?.ok!==true)throw Error("RECOVERY_ENDPOINT_FAILED_"+res.status+"_"+JSON.stringify(data).slice(0,300));
 if(data.sourceRowsDeleted!==0||data.existingRowsOverwritten!==0||
  data.canAuthorizeWager!==false)throw Error("NBA_RECOVERY_SAFETY_RECEIPT_INVALID");
 return data;
}
try{
 for(const table of SPORT_PREFIX_TABLES.nba){
  let afterRowid=0,highRowid=null,scanned=0,inserted=0,existing=0,passes=0,complete=false;
  for(let i=0;i<maxPagesPerTable;i++){
   const p=await request({table,afterRowid,pageSize:80,highRowid});
   if(p.table!==table||p.nextCursor<afterRowid||p.sourceCursor!==afterRowid)
     throw Error("RECOVERY_CURSOR_INVALID_"+table);
   highRowid=p.frozenHighRowid;
   scanned+=p.scanned;inserted+=p.inserted;existing+=p.alreadyInNbaDb;
   afterRowid=p.nextCursor;passes++;
   if(p.exhausted){complete=true;break;}
   if(p.scanned===0)throw Error("RECOVERY_STALLED_"+table);
   if(passes%20===0)console.log(JSON.stringify({table,passes,scanned,inserted,remainingByCursor:highRowid-afterRowid}));
  }
  if(!complete)throw Error("RECOVERY_PAGE_BOUND_EXHAUSTED_"+table);
  const item={table,scanned,inserted,existing,frozenHighRowid:highRowid,
    lastCursor:afterRowid,pages:passes,complete:true};
  manifest.tables.push(item);
  await writeFile(out+"/"+table+".json",JSON.stringify(item,null,2)+"\n");
  console.log(JSON.stringify(item));
 }
 if(manifest.tables.length!==31)throw Error("INCOMPLETE_NBA_RESEARCH_TABLE_COVERAGE");
 manifest.completed=true;
}catch(e){
 manifest.error=String(e?.message||e).slice(0,750);process.exitCode=1;
}finally{
 manifest.finishedAt=new Date().toISOString();
 manifest.totalInserted=manifest.tables.reduce((n,x)=>n+x.inserted,0);
 manifest.totalScanned=manifest.tables.reduce((n,x)=>n+x.scanned,0);
 await writeFile(out+"/result.json",JSON.stringify(manifest,null,2)+"\n");
 console.log(JSON.stringify({completed:manifest.completed,tables:manifest.tables.length,
   scanned:manifest.totalScanned,inserted:manifest.totalInserted,sourceRowsDeleted:0,
   error:manifest.error||null}));
}
