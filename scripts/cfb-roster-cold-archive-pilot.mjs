#!/usr/bin/env node
/** Controlled retrospective D1 -> R2 copy. Does not write, update, or delete any D1 row. */
import {writeFile} from 'node:fs/promises';
import {archiveScope,archiveSegment,archiveManifest,sha256,CFB_ROSTER_SOURCE_DB} from './lib/cfb-roster-cold-archive.mjs';

const scope=archiveScope({
  season:process.env.ARCHIVE_SEASON || '2004',
  startRowid:process.env.ARCHIVE_START_ROWID || '0',
  maxRows:process.env.ARCHIVE_MAX_ROWS || '500',
  batchRows:process.env.ARCHIVE_BATCH_ROWS || '100',
});
const apply=process.env.ARCHIVE_APPLY==='true';
if(process.env.ARCHIVE_APPLY && !['true','false'].includes(process.env.ARCHIVE_APPLY))throw Error('INVALID_APPLY_FLAG');
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token||!account)throw Error('CLOUDFLARE_READ_AND_R2_CREDENTIALS_REQUIRED');
const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account);
const dbApi=base+'/d1/database/'+CFB_ROSTER_SOURCE_DB+'/query';
const r2Api=base+'/r2/buckets/fbis-archive/objects/';
const headers={Authorization:'Bearer '+token};
const output='/tmp/fbis-cfb-roster-archive-pilot.json';
const evidence={contract:'fbis-cold-roster-pilot-v1',scope,apply,completed:false,rowsCopied:0,segments:[],sourceDbMutations:0};
async function save(){await writeFile(output,JSON.stringify(evidence,null,2)+'\n');}
async function query(sql){
  const res=await fetch(dbApi,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({sql}),signal:AbortSignal.timeout(90000)});
  const body=await res.json();
  if(!res.ok||!body.success||body.result?.some(x=>x.success!==true))throw Error('D1_READ_FAILED_'+res.status);
  return body.result[0].results||[];
}
async function r2Read(key){
  const response=await fetch(r2Api+encodeURIComponent(key),{headers,signal:AbortSignal.timeout(90000)});
  if(response.status===404)return null;
  if(!response.ok)throw Error('R2_READ_FAILED_'+response.status);
  return await response.text();
}
async function r2StoreAndVerify(key,body){
  const existing=await r2Read(key);
  if(existing!==null&&sha256(existing)!==sha256(body))throw Error('R2_CONTENT_ADDRESS_COLLISION');
  if(existing===null){
    let writeError=null;
    try{
      const put=await fetch(r2Api+encodeURIComponent(key),{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream'},body,signal:AbortSignal.timeout(90000)});
      if(!put.ok)writeError=Error('R2_WRITE_FAILED_'+put.status);
    }catch(error){writeError=error;}
    // A write can complete despite transport failure. Independently read before deciding.
    const stored=await r2Read(key);
    if(stored===null||sha256(stored)!==sha256(body))throw writeError||Error('R2_WRITE_NOT_VERIFIED');
  }
  const restored=await r2Read(key);
  if(restored===null||sha256(restored)!==sha256(body)||Buffer.byteLength(restored)!==Buffer.byteLength(body))throw Error('R2_SHA256_READBACK_FAILED');
}
try{
  const initial=(await query('SELECT MAX(rowid) AS upper,COUNT(*) AS n FROM cfb_roster_observations WHERE season='+scope.season))[0];
  const upper=Number(initial?.upper||0),seasonTotal=Number(initial?.n||0);
  if(!Number.isSafeInteger(upper)||!seasonTotal)throw Error('INVALID_SOURCE_BOUNDARY');
  evidence.frozenUpperRowid=String(upper);evidence.sourceSeasonTotal=seasonTotal;
  let cursor=scope.startRowid;
  while(evidence.rowsCopied<scope.maxRows){
    const limit=Math.min(scope.batchRows,scope.maxRows-evidence.rowsCopied);
    const sql='SELECT CAST(rowid AS TEXT) AS __archive_rowid,* FROM cfb_roster_observations WHERE season='+scope.season+' AND rowid>'+cursor+' AND rowid<='+upper+' ORDER BY rowid LIMIT '+limit;
    const rows=await query(sql);
    if(!rows.length)break;
    const segment=archiveSegment(rows,{season:scope.season,upperRowid:upper});
    if(apply)await r2StoreAndVerify(segment.key,segment.body);
    const same=await query('SELECT CAST(rowid AS TEXT) AS __archive_rowid,* FROM cfb_roster_observations WHERE season='+scope.season+' AND rowid>='+segment.firstRowid+' AND rowid<='+segment.lastRowid+' ORDER BY rowid');
    if(JSON.stringify(rows)!==JSON.stringify(same))throw Error('D1_SOURCE_CHANGED_DURING_COPY');
    evidence.segments.push({key:segment.key,sha256:segment.sha256,bytes:segment.bytes,firstRowid:segment.firstRowid,lastRowid:segment.lastRowid,count:segment.count,verified:apply});
    evidence.rowsCopied+=segment.count;
    const last=Number(segment.lastRowid);if(last<=cursor)throw Error('NONADVANCING_CURSOR');cursor=last;
    evidence.nextRowid=String(cursor);
    await save();
  }
  if(apply&&evidence.segments.length){
    const manifest=archiveManifest({scope,upperRowid:upper,totalInSeason:seasonTotal,segments:evidence.segments,exportedAt:new Date().toISOString()});
    await r2StoreAndVerify(manifest.key,manifest.body);
    evidence.manifest={key:manifest.key,sha256:manifest.sha256,bytes:Buffer.byteLength(manifest.body)};
  }
  evidence.completed=true;
}catch(error){evidence.error=String(error?.message||error);throw error;}
finally{await save();console.log(JSON.stringify({contract:evidence.contract,scope,apply,completed:evidence.completed,rowsCopied:evidence.rowsCopied,partCount:evidence.segments.length,manifest:evidence.manifest||null,sourceDbMutations:0,error:evidence.error||null}));}
