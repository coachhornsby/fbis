import { createHash } from 'node:crypto';
/** Offline canonical evidence tools; do not import in Cloudflare Workers (Node crypto). */
const keys=['canonicalEventId','canonicalPlayerId','canonical_market','period'];
const string=x=>typeof x==='string'&&x.trim().length>0;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const stable=x=>JSON.stringify(canonical(x));
const hash=x=>createHash('sha256').update(stable(x)).digest('hex');
export function freezePropEvidence({prediction,contract,observedAt}={}) {
 const problems=[];
 if(!prediction||!contract)return {ok:false,problems:['MISSING_INPUT']};
 for(const k of keys)if(!string(prediction[k])||prediction[k]!==contract[k])problems.push('IDENTITY_MISMATCH:'+k);
 if(!string(prediction.modelVersion)||!string(contract.contractId)||!string(contract.provider))problems.push('PROVENANCE_MISSING');
 const t=Date.parse(observedAt),start=Date.parse(contract.eventStart),asOf=Date.parse(prediction.asOf);
 if(!Number.isFinite(t)||!Number.isFinite(start)||!Number.isFinite(asOf)||t>=start||asOf>t)problems.push('TIME_INVALID');
 if(problems.length)return {ok:false,problems};
 const frozen=Object.freeze({...prediction,frozenAt:observedAt});
 const payload={schemaVersion:1,prediction:frozen,contract:{...contract},observedAt};
 return {ok:true,id:hash(payload),payload,canQualify:false,canAuthorizeWager:false};
}
/** Immutable append-only ledger validation. Corrections are new revisions, not replacements. */
export function reconcilePropEvidence(existing=[],incoming=[]) {
 const rows=new Map(),problems=[];
 for(const row of [...existing,...incoming]){
  if(!row||!string(row.id)||!row.payload){problems.push('INVALID_ENVELOPE');continue;}
  if(hash(row.payload)!==row.id){problems.push('CONTENT_HASH_MISMATCH:'+row.id);continue;}
  const old=rows.get(row.id);
  if(old&&JSON.stringify(old.payload)!==JSON.stringify(row.payload))problems.push('COLLISION_OR_MUTATION:'+row.id);
  else rows.set(row.id,row);
 }
 return {ok:problems.length===0,records:[...rows.values()],problems,canAuthorizeWager:false};
}
