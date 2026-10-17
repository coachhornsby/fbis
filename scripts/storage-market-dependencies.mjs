#!/usr/bin/env node
// Complete the independent backup closure of the pinned market pilot. Read only.
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {mkdir,writeFile} from 'node:fs/promises';
import {restoreArchivedRaw,payloadHash} from '../functions/lib/polymarketPayloadArchive.js';
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('CREDENTIALS_REQUIRED');
const pinned='abd8d59447376b9ddcf31a54fd15b51e94dd02b7250ff54d4765a4795a6ef2c7';
const sourceKey=`research/storage-recovery/market-research/market-research-${pinned}.json.gz`;
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/fbis-archive/objects/`;
const headers={Authorization:`Bearer ${token}`},sha=b=>createHash('sha256').update(b).digest('hex');
const out='/tmp/fbis-market-dependencies';await mkdir(out,{recursive:true});
const evidence={contract:'fbis-market-dependency-backup-v1',cohortSha256:pinned,sourceDbMutations:0,sourceRowsDeleted:0,retentionReleaseAuthorized:false,completed:false};
async function read(key){
 if(!/^(research\/storage-recovery\/market-research\/|market-sources\/polymarket-us\/(receipts|raw)\/)/.test(key)||key.includes('..'))throw Error('KEY_OUT_OF_SCOPE');
 const r=await fetch(base+key,{headers,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('R2_DEPENDENCY_READ_'+r.status);
 const max=128*1024*1024;if(Number(r.headers.get('content-length'))>max)throw Error('DEPENDENCY_TOO_LARGE');
 const reader=r.body.getReader(),parts=[];let length=0;
 try{while(true){const x=await reader.read();if(x.done)break;length+=x.value.byteLength;if(length>max)throw Error('DEPENDENCY_TOO_LARGE');parts.push(Buffer.from(x.value));}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(parts);
}
try{
 const compressed=await read(sourceKey);if(sha(compressed)!==pinned)throw Error('COHORT_HASH_FAILED');
 const cohort=JSON.parse(gunzipSync(compressed));if(cohort.rows.length!==2000||cohort.columns.length!==50)throw Error('COHORT_SCOPE_FAILED');
 const objects=new Map(),receipts=new Map(),rawKeys=new Set();let referencedRows=0;
 for(const row of cohort.rows){
  const raw=JSON.parse(row.raw_payload_json||'{}');if(!raw.archiveRef)continue;
  referencedRows++;
  const key=raw.archiveRef.receiptKey;
  if(!/^market-sources\/polymarket-us\/receipts\/[a-z0-9-]{1,180}\.json$/i.test(key))throw Error('INVALID_RECEIPT_KEY');
  if(!objects.has(key)){
   const body=await read(key),text=new TextDecoder('utf-8',{fatal:true}).decode(body),receipt=JSON.parse(text);
   objects.set(key,{key,sha256:sha(body),bytes:body.length,encoding:'utf8',body:text});receipts.set(key,receipt);
   if(!/^market-sources\/polymarket-us\/raw\/[a-f0-9]{64}\.json$/.test(receipt.rawKey))throw Error('INVALID_RAW_KEY');
   rawKeys.add(receipt.rawKey);
  }
 }
 for(const key of rawKeys){const body=await read(key),digest=sha(body);if(digest!==key.match(/([a-f0-9]{64})\.json$/)[1])throw Error('SOURCE_SNAPSHOT_KEY_HASH_FAILED');objects.set(key,{key,sha256:digest,bytes:body.length,encoding:'utf8',body:new TextDecoder('utf-8',{fatal:true}).decode(body)});}
 const archive={get:async key=>receipts.has(key)?{json:async()=>receipts.get(key)}:null};
 let restored=0;
 for(const row of cohort.rows){const raw=JSON.parse(row.raw_payload_json||'{}');if(!raw.archiveRef)continue;const full=await restoreArchivedRaw(raw,archive,{storedHash:row.raw_payload_hash});if(await payloadHash(full)!==raw.archiveRef.originalPayloadHash)throw Error('ORIGINAL_PAYLOAD_RECONSTRUCTION_FAILED');restored++;}
 const packageBody=Buffer.from(JSON.stringify({contract:'fbis-independent-market-dependency-bundle-v1',cohortSha256:pinned,objects:[...objects.values()]}));
 const bundle=gzipSync(packageBody,{level:9}),digest=sha(bundle),name=`market-dependencies-${digest}.json.gz`,key=`research/storage-recovery/market-research/${name}`;
 const put=await fetch(base+key,{method:'PUT',headers:{...headers,'Content-Type':'application/gzip'},body:bundle,signal:AbortSignal.timeout(90000)});if(!put.ok)throw Error('DEPENDENCY_BUNDLE_PUT_FAILED');
 const download=await read(key);if(sha(download)!==digest)throw Error('DEPENDENCY_BUNDLE_READBACK_FAILED');
 const independent=JSON.parse(gunzipSync(download));for(const object of independent.objects){if(sha(Buffer.from(object.body,'utf8'))!==object.sha256)throw Error('DEPENDENCY_OBJECT_HASH_FAILED');}
 await writeFile(out+'/'+name,download);
 Object.assign(evidence,{completed:true,referencedRows,originalPayloadsRestored:restored,receiptObjects:receipts.size,rawSnapshotObjects:rawKeys.size,objects:[...objects.values()].map(({body,...metadata})=>metadata),bundle:{key,name,sha256:digest,bytes:bundle.length,uncompressedBytes:packageBody.length,r2ReadbackVerified:true},driveVerification:'PENDING'});
}catch(error){evidence.error=error.message;process.exitCode=1;}
finally{await writeFile(out+'/result.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({completed:evidence.completed,referencedRows:evidence.referencedRows,error:evidence.error||null}));}
