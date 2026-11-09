// Ephemeral, same-job reuse of the two validated Torvik CSV captures.
// Never upload this private input, restamp receipts, or refetch after reuse fails.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {indexTorvikRows} from '../../functions/lib/torvikCbb.js';
import {torvikRecoveryUrls} from './torvikRecovery.mjs';
const MAX_BYTES=2*1024*1024,TTL_MS=6*3600000;
// Rollout date is an operator hold, not a claim about the provider's quota clock.
export function torvikRecoveryAdmitted({enabled,notBefore,now=Date.now()}={}){
 if(enabled!=='1'||!Number.isFinite(now))return false;
 if(!notBefore)return true;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(notBefore))return false;
 const start=Date.parse(notBefore+'T00:00:00Z');
 return Number.isFinite(start)&&new Date(start).toISOString().slice(0,10)===notBefore&&now>=start;
}
const factors=['efgPct','efgPctD','ftr','ftrD','orbRate','drbRate','tovRate','tovRateD','threePtPct','threePtPctD','twoPtPct','twoPtPctD'];
export function validateTorvikRecoveryInput(value,{season=2027,now=Date.now()}={}){
 const urls=torvikRecoveryUrls(season),bad=()=>{throw Error('INVALID_TORVIK_REUSED_INPUT');};
 if(!Number.isFinite(now)||value?.version!==1||value.season!==season||value.providerUpdatedAt!==null||value.canAuthorizeWager!==false||value.canQualify!==false||
  !Array.isArray(value.receipts)||value.receipts.length!==2||!Array.isArray(value.rows)||value.rows.length<330||value.rows.length>400)bad();
 value.receipts.forEach((r,i)=>{const at=Date.parse(r?.retrievedAt);if(r?.url!==urls[i]||r.httpStatus!==200||r.providerUpdatedAt!==null||!Number.isInteger(r.bytes)||r.bytes<=0||r.bytes>MAX_BYTES||!/^[a-f0-9]{64}$/.test(r.sha256||'')||!Number.isFinite(at)||at>now||now-at>=TTL_MS)bad();});
 for(const r of value.rows){
  if(typeof r.team!=='string'||!r.team.trim()||![r.adjOe,r.adjDe,r.tempo].every(Number.isFinite)||r.adjOe<60||r.adjOe>150||r.adjDe<60||r.adjDe>150||r.tempo<40||r.tempo>110)bad();
  for(const k of factors)if(!Number.isFinite(r[k])||r[k]<0||r[k]>(k.startsWith('ftr')?2:1))bad();
 }
 const index=indexTorvikRows(value.rows,season-1);
 if(index.matched!==value.rows.length||Object.keys(index.byCanonicalId).length!==value.rows.length||new Set(value.rows.map(r=>r.team)).size!==value.rows.length)bad();
 return {ok:true,state:'PRIVATE_RESEARCH_INPUT',season,rows:value.rows,index,receipts:value.receipts,providerUpdatedAt:null,canQualify:false,canAuthorizeWager:false};
}
export async function obtainTorvikRecoveryInput({inputPath,outputPath,capture,season=2027,now=Date.now}={}){
 if(inputPath){
  if((await stat(inputPath)).size>MAX_BYTES)throw Error('TORVIK_REUSED_INPUT_TOO_LARGE');
  const raw=await readFile(inputPath,'utf8');if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('TORVIK_REUSED_INPUT_TOO_LARGE');
  return validateTorvikRecoveryInput(JSON.parse(raw),{season,now:now()});
 }
 const result=await capture();if(!result?.ok)return result;
 const value={version:1,season:result.season,rows:result.rows,receipts:result.receipts,providerUpdatedAt:result.providerUpdatedAt,canQualify:result.canQualify,canAuthorizeWager:result.canAuthorizeWager};
 const validated=validateTorvikRecoveryInput(value,{season,now:now()});
 if(outputPath){const raw=JSON.stringify(value);if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('TORVIK_REUSED_INPUT_TOO_LARGE');await writeFile(outputPath,raw,{mode:0o600});}
 return validated;
}
