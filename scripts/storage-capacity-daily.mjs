#!/usr/bin/env node
// Read physical D1 metadata; retain versioned R2 evidence. Never changes D1.
import {createHash} from 'node:crypto';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('CREDENTIALS_REQUIRED');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers={Authorization:`Bearer ${token}`};
const ids=['b50c724c-903b-4241-8ce1-48d931e7a44c','c32ccf06-c896-4d24-bb89-3e87a7412899','1142b60c-6e00-4286-87b8-4edff9de3129'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const objectBase=base+'/r2/buckets/fbis-archive/objects/';
async function read(key){const r=await fetch(objectBase+key,{headers,signal:AbortSignal.timeout(90000)});if(r.status===404)return null;if(!r.ok)throw Error('R2_READ_'+r.status);return r.text();}
async function put(key,text){const r=await fetch(objectBase+key,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:text,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('R2_WRITE_'+r.status);const b=await read(key);if(b===null||sha(b)!==sha(text))throw Error('R2_MONITOR_READBACK_FAILED');}
const now=new Date(),databases=[];
for(const id of ids){const r=await fetch(base+'/d1/database/'+id,{headers,signal:AbortSignal.timeout(90000)});const b=await r.json();if(!r.ok||!b.success||!Number.isSafeInteger(b.result?.file_size))throw Error('PHYSICAL_METADATA_MISSING');databases.push({id,name:b.result.name,physicalBytes:b.result.file_size,capBytes:10000000000});}
const primary=databases[0],ratio=primary.physicalBytes/primary.capBytes;
const threshold=ratio>=1?100:ratio>=.95?95:ratio>=.9?90:ratio>=.85?85:ratio>=.8?80:ratio>=.7?70:0;
const action={0:'NORMAL',70:'ARCHIVE_REVIEW',80:'ARCHIVE_PRIORITY',85:'RETIREMENT_PREPARATION',90:'CRITICAL',95:'EMERGENCY_REVIEW',100:'HARD_STORAGE_INCIDENT'}[threshold];
const previousText=await read('research/storage-capacity/latest.json');let forecast=null;
if(previousText){const previous=JSON.parse(previousText);if(previous.contract!=='fbis-capacity-measurement-v1')throw Error('INVALID_PREVIOUS_MEASUREMENT');const days=(now-Date.parse(previous.measuredAt))/86400000;if(days>0){const growth=(primary.physicalBytes-previous.databases[0].physicalBytes)/days;forecast={elapsedDays:days,primaryBytesPerDay:growth,daysToCap:ratio>=1?0:growth>0?(primary.capBytes-primary.physicalBytes)/growth:null,method:'two_point_measurement_not_a_guarantee'};}}
const report={contract:'fbis-capacity-measurement-v1',measuredAt:now.toISOString(),databases,primaryThresholdPercent:threshold,action,bytesAbove8GbTarget:Math.max(0,primary.physicalBytes-8000000000),forecast,sourceDbMutations:0,retentionReleaseAuthorized:false,billing:'NOT_VERIFIED',driveAutomation:'NOT_CONFIGURED',emergencyGrowthSafeguard:'OPERATOR_REVIEW_REQUIRED_NO_FEED_SCHEDULE_CHANGES'};
const body=JSON.stringify(report,null,2)+'\n',key=`research/storage-capacity/${now.toISOString().slice(0,10)}/measurement-${sha(body)}.json`;
await put(key,body);await put('research/storage-capacity/latest.json',body);
const output=process.env.CAPACITY_OUTPUT||'/tmp/fbis-capacity';
await mkdir(output,{recursive:true});await writeFile(output+'/result.json',body);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Storage: ${action}\n\nPrimary: ${primary.physicalBytes} bytes. Remaining recovery to 8 GB: ${report.bytesAbove8GbTarget} bytes.\n\nNo production records deleted. Drive automation and billing remain unverified.\n`);
console.log(JSON.stringify({action,primaryBytes:primary.physicalBytes,archiveKey:key}));
// GitHub's failed-run notification is the operator alert; measurement is already durable.
if(threshold>=90)process.exitCode=1;
