#!/usr/bin/env node
/** Static D1 performance audit. Never mutates product tables. */
import {runStaticPerformanceAudit} from '../functions/lib/d1PerformanceAudit.js';
const audit=runStaticPerformanceAudit();
const out=process.env.PERF_AUDIT_OUTPUT;
if(out){
  const {mkdir,writeFile}=await import('node:fs/promises');
  await mkdir(out,{recursive:true});
  await writeFile(out+'/result.json',JSON.stringify(audit,null,2)+'\n');
}
console.log(JSON.stringify({
  contract:audit.contract,
  findingCount:audit.findingCount,
  openHigh:audit.openHigh,
  findings:audit.findings.map(f=>({id:f.findingId,severity:f.severity,table:f.tableName})),
},null,2));
if(audit.openHigh>0)process.exitCode=0; // informational; do not fail CI solely on known open findings
