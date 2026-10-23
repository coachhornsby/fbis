#!/usr/bin/env node
// Read physical D1 metadata for primary, market-history, operations, and cold-history.
// Retain versioned R2 evidence. Never changes D1 source product tables.
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {DATABASE_OWNERS,capacityAlertLevel,D1_HARD_LIMIT_BYTES} from '../functions/lib/databaseOwnership.js';

const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('CREDENTIALS_REQUIRED');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers={Authorization:`Bearer ${token}`};
// One metadata-only pass over every registered D1, including Q4 and sport shards.
const OWNED=Object.values(DATABASE_OWNERS);
const sha=b=>createHash('sha256').update(b).digest('hex');
const objectBase=base+'/r2/buckets/fbis-archive/objects/';
async function read(key){const r=await fetch(objectBase+key,{headers,signal:AbortSignal.timeout(90000)});if(r.status===404)return null;if(!r.ok)throw Error('R2_READ_'+r.status);return r.text();}
async function put(key,text){const r=await fetch(objectBase+key,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:text,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('R2_WRITE_'+r.status);const b=await read(key);if(b===null||sha(b)!==sha(text))throw Error('R2_MONITOR_READBACK_FAILED');}

const now=new Date(),databases=[];
for(const owner of OWNED){
  const r=await fetch(base+'/d1/database/'+owner.databaseId,{headers,signal:AbortSignal.timeout(90000)});
  const b=await r.json();
  if(!r.ok||!b.success||!Number.isSafeInteger(b.result?.file_size))throw Error('PHYSICAL_METADATA_MISSING_'+owner.key);
  const alert=capacityAlertLevel(b.result.file_size,D1_HARD_LIMIT_BYTES);
  databases.push({
    key:owner.key,
    id:owner.databaseId,
    name:b.result.name||owner.databaseName,
    role:owner.role,
    physicalBytes:b.result.file_size,
    capBytes:D1_HARD_LIMIT_BYTES,
    percentUsed:alert.percentUsed,
    alertLevel:alert.level,
    alerts:alert.alerts,
  });
}

const primary=databases.find(d=>d.key==='PRIMARY');
const platformPercent=Math.max(...databases.map(d=>d.percentUsed));
const platformThreshold=platformPercent>=100?100:platformPercent>=95?95:platformPercent>=85?85:platformPercent>=75?75:0;
const threshold=primary.alertLevel==='OVER_LIMIT'?100:primary.alertLevel==='CRITICAL'?90:primary.alertLevel==='HIGH'?85:primary.alertLevel==='WATCH'?80:primary.percentUsed>=70?70:0;
const action={0:'NORMAL',75:'WARN',85:'DEGRADED',95:'CRITICAL',100:'HARD_STORAGE_INCIDENT'}[platformThreshold];

const previousText=await read('research/storage-capacity/latest.json');let forecast=null;
const databaseForecasts={};let previous=null;
if(previousText){
  previous=JSON.parse(previousText);
  if(previous.contract!=='fbis-capacity-measurement-v1')throw Error('INVALID_PREVIOUS_MEASUREMENT');
  const days=(now-Date.parse(previous.measuredAt))/86400000;
  if(days>0){
    const priorPrimary=previous.databases.find(d=>d.key==='PRIMARY'||d.id===primary.id)||previous.databases[0];
    const growth=(primary.physicalBytes-priorPrimary.physicalBytes)/days;
    forecast={elapsedDays:days,primaryBytesPerDay:growth,daysToCap:primary.percentUsed>=100?0:growth>0?(primary.capBytes-primary.physicalBytes)/growth:null,method:'two_point_measurement_not_a_guarantee'};
    for(const db of databases){
      const prior=previous.databases.find(d=>d.id===db.id);
      if(!prior)continue;
      const dailyGrowth=(db.physicalBytes-prior.physicalBytes)/days;
      databaseForecasts[db.key]={observedBytesPerDay:dailyGrowth,daysToCap:db.percentUsed>=100?0:dailyGrowth>0?(db.capBytes-db.physicalBytes)/dailyGrowth:null,
        projectedBytes30d:Math.max(0,db.physicalBytes+dailyGrowth*30),projectedBytes90d:Math.max(0,db.physicalBytes+dailyGrowth*90),projectedBytes180d:Math.max(0,db.physicalBytes+dailyGrowth*180),
        method:'two_point_extrapolation_not_guaranteed'};
    }
  }
}

const report={
  contract:'fbis-capacity-measurement-v1',
  measuredAt:now.toISOString(),
  databases,
  primaryThresholdPercent:threshold,
  platformThresholdPercent:platformThreshold,
  action,
  alertsTriggered:{
    warn75:databases.filter(d=>d.percentUsed>=75).map(d=>d.key),
    degraded85:databases.filter(d=>d.percentUsed>=85).map(d=>d.key),
    critical95:databases.filter(d=>d.percentUsed>=95).map(d=>d.key),
    watch80:databases.filter(d=>d.percentUsed>=80).map(d=>d.key),
    high85:databases.filter(d=>d.percentUsed>=85).map(d=>d.key),
    critical90:databases.filter(d=>d.percentUsed>=90).map(d=>d.key),
  },
  bytesAbove8GbTarget:Math.max(0,primary.physicalBytes-8000000000),
  forecast,
  databaseForecasts,
  sourceDbMutations:0,
  retentionReleaseAuthorized:false,
  retentionRequiresVerifiedRecovery:true,
  billing:'NOT_VERIFIED',
  driveAutomation:'NOT_CONFIGURED',
  operationsDbPreferred:true,
  ownershipContract:'fbis-database-ownership-v1',
  emergencyGrowthSafeguard:'ROUTE_NEW_OPS_TO_OPERATIONS_DB_BLOCK_PRIMARY_HISTORICAL_GROWTH',
};

const body=JSON.stringify(report,null,2)+'\n';
const key=`research/storage-capacity/${now.toISOString().slice(0,10)}/measurement-${sha(body)}.json`;
await put(key,body);await put('research/storage-capacity/latest.json',body);
const output=process.env.CAPACITY_OUTPUT||'/tmp/fbis-capacity';
await mkdir(output,{recursive:true});await writeFile(output+'/result.json',body);
if(process.env.GITHUB_STEP_SUMMARY){
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## Storage: ${action}\n\nPrimary: ${primary.physicalBytes} bytes (${primary.percentUsed}%, ${primary.alertLevel}).\n\n`+
    `Alerts — 80%: ${report.alertsTriggered.watch80.join(', ')||'none'}; 85%: ${report.alertsTriggered.high85.join(', ')||'none'}; 90%: ${report.alertsTriggered.critical90.join(', ')||'none'}.\n\n`+
    `No production records deleted. Retention still requires verified recovery copies. OPERATIONS_DB is preferred for new operational workloads.\n`);
}
console.log(JSON.stringify({action,primaryBytes:primary.physicalBytes,alertLevel:primary.alertLevel,archiveKey:key,alertsTriggered:report.alertsTriggered}));
// Only signal a newly critical database; repeated hourly failures create alert storms.
const priorCritical=new Set((previous?.databases||[]).filter(d=>d.percentUsed>=95).map(d=>d.key));
if(report.alertsTriggered.critical95.some(key=>!priorCritical.has(key)))process.exitCode=1;
