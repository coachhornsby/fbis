import {JSONParser} from "@streamparser/json";
/** Lossless storage representation only. Prices, IDs and clocks never change.
 * Full evidence already exists in immutable Polymarket page receipts in R2.
 */
export const POLY_PAYLOAD_STORAGE_VERSION='polymarket-receipt-v1';
export const receiptKey=id=>{
 if(!/^[a-z0-9-]{1,180}$/i.test(id||''))throw Error('INVALID_ARCHIVE_RECEIPT_ID');
 return `market-sources/polymarket-us/receipts/${id}.json`;
};
export async function payloadHash(raw){
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof raw==='string'?raw:JSON.stringify(raw)));
 return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function validRawKey(key){return /^market-sources\/polymarket-us\/raw\/[a-f0-9]{64}\.json$/.test(key||'');}
function receiptMatches(receipt,raw){
 return receipt?.receiptId===raw?.receiptId&&receipt?.rawKey===raw?.rawSnapshotKey&&validRawKey(receipt.rawKey)&&Array.isArray(receipt.offers);
}
export async function compactArchivedRaw(raw,receipt,{originalHash=null}={}){
 if(raw?.archiveRef?.version===POLY_PAYLOAD_STORAGE_VERSION)return {raw,changed:false,reason:'ALREADY_COMPACT'};
 if(!receiptMatches(receipt,raw))return {raw,changed:false,reason:'RECEIPT_IDENTITY_UNVERIFIED'};
 if(!Array.isArray(raw?.providerMarket?.marketSides))return {raw,changed:false,reason:'NO_REPEATED_MARKET_SIDES'};
 const digest=await payloadHash(raw);
 if(originalHash&&digest!==originalHash)return {raw,changed:false,reason:'SOURCE_PAYLOAD_HASH_MISMATCH'};
 // Exactly matching bytes distinguish same-contract captures and preserve rematch
 // extras. Unmatched/rewritten records remain inline rather than guessing.
 let matched=false;
 for(const o of receipt.offers){
  if(o?.raw?.providerMarketId!==raw.providerMarketId||o?.raw?.providerOutcomeId!==raw.providerOutcomeId)continue;
  if(await payloadHash(o.raw)===digest){matched=true;break;}
 }
 if(!matched)return {raw,changed:false,reason:'ARCHIVED_OFFER_HASH_MISMATCH'};
 const {marketSides,...market}=raw.providerMarket;
 const result={...raw,providerMarket:market,archiveRef:{version:POLY_PAYLOAD_STORAGE_VERSION,
   receiptKey:receiptKey(raw.receiptId),originalPayloadHash:digest,
   omittedFields:['providerMarket.marketSides']}};
 const before=JSON.stringify(raw).length,after=JSON.stringify(result).length;
 if(after>=before)return {raw,changed:false,reason:'NO_STORAGE_SAVING'};
 return {raw:result,changed:true,reason:'ARCHIVE_VERIFIED',originalHash:digest};
}
const offerIdentity=raw=>JSON.stringify([raw?.providerMarketId,raw?.providerOutcomeId]);
/** Parse only selected offer objects. keepStack=false releases unmatched siblings.
 * The receipt stays in R2; no replacement or auxiliary objects are created.
 */
export async function readReceiptMatches(archive,key,identities){
 const object=await archive.get(key);
 if(!object)return null;
 const maxBytes=128*1024*1024;
 if(object.size>maxBytes)throw Error('ARCHIVED_RECEIPT_TOO_LARGE');
 // Unit-test stores may expose json() only; real R2 bodies always stream.
 if(!object.body?.getReader){
  const receipt=await object.json();
  return {...receipt,offers:(receipt.offers||[]).filter(o=>identities.has(offerIdentity(o.raw)))};
 }
 const receipt={offers:[]};
 const parser=new JSONParser({paths:['$.receiptId','$.rawKey','$.offers.*'],keepStack:false,stringBufferSize:65536});
 parser.onValue=({key,value})=>{
  if(key==='receiptId')receipt.receiptId=value;
  else if(key==='rawKey')receipt.rawKey=value;
  else if(value?.raw&&identities.has(offerIdentity(value.raw))){
   if(receipt.offers.length>=1000)throw Error('ARCHIVE_MATCH_BUDGET_EXCEEDED');
   receipt.offers.push(value);
  }
 };
 const reader=object.body.getReader();let read=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;
   read+=part.value.byteLength;if(read>maxBytes)throw Error('ARCHIVED_RECEIPT_TOO_LARGE');
   parser.write(part.value);
  }
  if(!parser.isEnded)parser.end();
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{reader.releaseLock();}
 return receipt;
}
export async function restoreArchivedRaw(raw,archive,{storedHash=null}={}){
 if(!raw?.archiveRef)return raw;
 if(raw.archiveRef.version!==POLY_PAYLOAD_STORAGE_VERSION||raw.archiveRef.receiptKey!==receiptKey(raw.receiptId)||!validRawKey(raw.rawSnapshotKey))throw Error('INVALID_ARCHIVE_REFERENCE');
 if(storedHash&&await payloadHash(raw)!==storedHash)throw Error('STORED_PAYLOAD_HASH_MISMATCH');
 const receipt=await readReceiptMatches(archive,raw.archiveRef.receiptKey,new Set([offerIdentity(raw)]));
 if(!receipt)throw Error('ARCHIVED_RECEIPT_MISSING');
 if(!receiptMatches(receipt,raw))throw Error('ARCHIVED_RECEIPT_IDENTITY_MISMATCH');
 for(const o of receipt.offers){
  if(o?.raw?.providerMarketId!==raw.providerMarketId||o?.raw?.providerOutcomeId!==raw.providerOutcomeId)continue;
  if(await payloadHash(o.raw)===raw.archiveRef.originalPayloadHash){
   const {archiveRef,...current}=raw;
   // Preserve original property order as well as values for byte-exact SHA replay.
   return {...o.raw,...current,providerMarket:{...o.raw.providerMarket,...current.providerMarket}};
  }
 }
 throw Error('ARCHIVED_PAYLOAD_HASH_MISMATCH');
}
/** Keyset scan; updates use compare-and-swap. No rows, forecasts or prices deleted. */
export async function compactPolymarketPayloadBatch(env,{afterRowid=0,limit=250,cutoff,dryRun=true}={}){
 if(!Number.isSafeInteger(afterRowid)||afterRowid<0||!Number.isSafeInteger(limit)||limit<1||limit>500||!Number.isFinite(Date.parse(cutoff)))throw Error('INVALID_COMPACTION_SCOPE');
 if(!env.DB?.prepare||!env.DB?.batch||!env.ARCHIVE?.get)throw Error('ARCHIVE_AND_DATABASE_REQUIRED');
 // Force the rowid range: a source index otherwise scans/sorts the entire ledger per page.
 const rows=(await env.DB.prepare(`SELECT rowid storage_rowid,id,raw_payload_json,raw_payload_hash
   FROM normalized_market_observations NOT INDEXED WHERE rowid>? AND source='Polymarket US'
   AND collected_at<=? AND length(raw_payload_json)<=65536
   ORDER BY rowid LIMIT ?`).bind(afterRowid,cutoff,limit).all()).results||[];
 const cache=new Map(),statements=[],proofs=[],reasons={};let before=0,after=0;
 const identities=new Set();
 for(const row of rows){try{const raw=JSON.parse(row.raw_payload_json);if(!raw.archiveRef)identities.add(offerIdentity(raw));}catch{}}

 for(const row of rows){
  let raw;try{raw=JSON.parse(row.raw_payload_json)}catch{reasons.INVALID_JSON=(reasons.INVALID_JSON||0)+1;continue;}
  if(raw?.archiveRef){reasons.ALREADY_COMPACT=(reasons.ALREADY_COMPACT||0)+1;continue;}
  if(!raw?.receiptId||!validRawKey(raw.rawSnapshotKey)){reasons.NO_ARCHIVE_REFERENCE=(reasons.NO_ARCHIVE_REFERENCE||0)+1;continue;}
  const key=receiptKey(raw.receiptId);let receipt;
  if(cache.has(key))receipt=cache.get(key);
  else{
   try{receipt=await readReceiptMatches(env.ARCHIVE,key,identities);}
   catch(error){if(error.message!=='ARCHIVED_RECEIPT_TOO_LARGE')throw error;receipt={unavailable:'ARCHIVE_TOO_LARGE'};}
   if(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(key,receipt);
  }
  if(!receipt||receipt.unavailable){const reason=receipt?.unavailable||'ARCHIVE_MISSING';reasons[reason]=(reasons[reason]||0)+1;continue;}
  const compact=await compactArchivedRaw(raw,receipt,{originalHash:row.raw_payload_hash});
  if(!compact.changed){reasons[compact.reason]=(reasons[compact.reason]||0)+1;continue;}
  const text=JSON.stringify(compact.raw),hash=await payloadHash(text);
  const oldBytes=new TextEncoder().encode(row.raw_payload_json).length,newBytes=new TextEncoder().encode(text).length;
  if(!dryRun)statements.push(env.DB.prepare(`UPDATE normalized_market_observations
    SET raw_payload_json=?,raw_payload_hash=? WHERE id=? AND raw_payload_hash=?`)
    .bind(text,hash,row.id,row.raw_payload_hash));
  proofs.push({id:row.id,originalHash:compact.originalHash,oldBytes,newBytes});before+=oldBytes;after+=newBytes;
 }
 let updated=0,bytesRemoved=0;const verificationSamples=[];
 if(!dryRun&&statements.length){
  // Bound each transaction and preserve exact input/result correspondence.
  for(let i=0;i<statements.length;i+=50){
   const results=await env.DB.batch(statements.slice(i,i+50));
   for(let j=0;j<results.length;j++){const changes=Number(results[j]?.meta?.changes||0);updated+=changes;if(changes){bytesRemoved+=proofs[i+j].oldBytes-proofs[i+j].newBytes;if(verificationSamples.length<3)verificationSamples.push({id:proofs[i+j].id,originalHash:proofs[i+j].originalHash});}}
  }
 }
 return {ok:true,version:POLY_PAYLOAD_STORAGE_VERSION,dryRun,examined:rows.length,eligible:proofs.length,updated,
   beforePayloadBytes:before,afterPayloadBytes:after,potentialPayloadBytesSaved:before-after,bytesRemoved,
   nextCursor:rows.length===limit?rows.at(-1).storage_rowid:null,cutoff,reasons,
   verificationSamples,newArchiveObjects:0,deletedRows:0,canAuthorizeWager:false};
}
