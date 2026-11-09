// One bounded owner-requested ingestion. No schedule, model promotion, D1 or market calls.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {captureCbbdCurrentSource} from './lib/cbbdCurrentSource.mjs';
import {captureCfbdCore} from './lib/cfbdCoreSource.mjs';
const key=process.env.CFBD_CBBD_KEY,account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const counts={CFBD:0,CBBD:0};const reserve=provider=>{if(!Object.hasOwn(counts,provider)||counts[provider]>=1)throw Error('SHARED_COLLEGE_SOURCE_BUDGET_EXCEEDED');counts[provider]++;};
const receipt={generatedAt:new Date().toISOString(),providerCalls:counts,maxSharedProviderCalls:2,sources:[],errors:[],primaryModelInfluence:0,noD1:true,noMarkets:true,canAuthorizeWager:false};
const sha=x=>createHash('sha256').update(x).digest('hex');
async function persist(key,packet){
 const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/r2/buckets/fbis-archive/objects/'+key.split('/').map(encodeURIComponent).join('/');
 const body=JSON.stringify(packet);if(Buffer.byteLength(body)>3500000)throw Error('COLLEGE_SOURCE_PACKET_TOO_LARGE');
 const put=await fetch(url,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},body,signal:AbortSignal.timeout(30000)});
 if(!put.ok)throw Error('COLLEGE_R2_PUT_'+put.status);
 const read=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
 if(!read.ok||sha(await read.text())!==sha(body))throw Error('COLLEGE_R2_READBACK_MISMATCH');
 return {stored:true,key,sha256:sha(body)};
}
try{
 if(!key||!account||!token)throw Error('EXISTING_COLLEGE_OR_R2_CREDENTIALS_MISSING');
 for(const [provider,capture,path] of [
  ['CFBD',captureCfbdCore,'private/college-sources/cfbd/core/2026/latest.json'],
  ['CBBD',captureCbbdCurrentSource,'private/college-sources/cbbd/adjusted/2027/latest.json']
 ]){
  try{const {packet,receipt:source}=await capture({key,reserve});const storage=await persist(path,packet);receipt.sources.push({...source,storage});}
  catch(error){receipt.errors.push({provider,reason:String(error.message||error).replaceAll(key,'[redacted]').slice(0,200)});}
 }
}catch(error){receipt.errors.push({reason:String(error.message||error)});}
await mkdir('artifacts/college-current-sources',{recursive:true});
await writeFile('artifacts/college-current-sources/receipt.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt));if(receipt.errors.length)process.exitCode=1;
