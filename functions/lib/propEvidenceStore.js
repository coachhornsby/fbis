/**
 * Append-only, content-addressed research evidence in the existing ARCHIVE R2 bucket.
 * Storage collisions and read faults never count as successful writes.
 * This module does not change D1 sport routing or grant wagering authority.
 */
const prefix='player-props/evidence/v1/';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const stable=x=>JSON.stringify(canonical(x));
async function digest(payload,subtle) {
 const bytes=new TextEncoder().encode(stable(payload));
 return [...new Uint8Array(await subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function persistPropEvidence(env,payload,{webCrypto=globalThis.crypto}={}) {
 if(!env?.ARCHIVE?.get||!env.ARCHIVE?.put||!webCrypto?.subtle?.digest)return {ok:false,reason:'STORAGE_OR_CRYPTO_UNAVAILABLE'};
 if(!payload||typeof payload!=='object'||payload.schemaVersion!==1||!['FROZEN_PROJECTION','MARKET_SNAPSHOT','OFFICIAL_RESULT','SETTLEMENT_GRADE'].includes(payload.kind))return {ok:false,reason:'INVALID_EVIDENCE_KIND'};
 if(!payload.observedAt||!Number.isFinite(Date.parse(payload.observedAt))||!payload.canonicalEventId||!payload.canonicalPlayerId||!payload.sourceId)return {ok:false,reason:'IDENTITY_OR_CLOCK_MISSING'};
 const id=await digest(payload,webCrypto.subtle),key=prefix+payload.kind.toLowerCase()+'/'+id+'.json';
 const contents=stable({id,payload});
 try {
  const prior=await env.ARCHIVE.get(key);
  if(prior){
   const value=await prior.text();
   if(value!==contents)return {ok:false,reason:'EXISTING_CONTENT_CONFLICT',id};
   return {ok:true,id,existed:true,canAuthorizeWager:false};
  }
  await env.ARCHIVE.put(key,contents,{httpMetadata:{contentType:'application/json'}});
  const check=await env.ARCHIVE.get(key);
  if(!check||await check.text()!==contents)return {ok:false,reason:'READBACK_MISMATCH',id};
  return {ok:true,id,existed:false,canAuthorizeWager:false};
 }catch{return {ok:false,reason:'STORAGE_READ_OR_WRITE_FAILED',id};}
}
export async function readPropEvidence(env,kind,id,{webCrypto=globalThis.crypto}={}) {
 if(!['FROZEN_PROJECTION','MARKET_SNAPSHOT','OFFICIAL_RESULT','SETTLEMENT_GRADE'].includes(kind)||!/^[a-f0-9]{64}$/.test(id||''))return {ok:false,reason:'INVALID_KEY'};
 if(!env?.ARCHIVE?.get||!webCrypto?.subtle?.digest)return {ok:false,reason:'STORAGE_OR_CRYPTO_UNAVAILABLE'};
 try {
  const obj=await env.ARCHIVE.get(prefix+kind.toLowerCase()+'/'+id+'.json');
  if(!obj)return {ok:false,reason:'NOT_FOUND'};
  const entry=await obj.json();
  if(entry.id!==id||entry.payload?.kind!==kind||await digest(entry.payload,webCrypto.subtle)!==id)return {ok:false,reason:'CONTENT_INTEGRITY_FAILED'};
  return {ok:true,id,payload:entry.payload,canAuthorizeWager:false};
 }catch{return {ok:false,reason:'READ_FAILED'};}
}
