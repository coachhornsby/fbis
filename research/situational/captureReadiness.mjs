// Offline research gate only. No fetchers, credentials, production writers or clocks
// are created here. Reviewed receipts must come from an independent evidence audit.
import { createHash } from 'node:crypto';
import { adaptPopulation, canonicalJson, AUTHORITY } from './marketEvidence.mjs';
import { timestamp } from './discovery.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const reference=s=>{
  if(typeof s!=='string' || /\s/.test(s)) return false;
  if(s.startsWith('https://')){try{const u=new URL(s);return u.protocol==='https:' && !!u.hostname && !u.username && !u.password;}catch{return false;}}
  return /^(r2:\/\/[^/]+\/[^?#]+|git:\/\/[a-f0-9]{40}\/[^?#]+)$/.test(s);
};
const blocked=new Set(['action','prizepicks','apify']);
const approvedSourceIds=new Set(['parlay','theodds','sharpapi','therundown']);

export function auditOfflineCaptures(entries,{reviewedReceipts=[]}={}) {
  if(!Array.isArray(entries) || entries.length>10000 || !Array.isArray(reviewedReceipts)) throw new Error('INVALID_OR_UNBOUNDED_INPUT');
  const adapted=adaptPopulation(entries.map(e=>e.adapterInput?.record),entries.map(e=>e.adapterInput?.context));
  const ids=entries.map(e=>e.captureId);
  return entries.map((entry,i)=>{
    const a=adapted[i],input=entry.adapterInput,record=input?.record,context=input?.context,reasons=a.reasons.map(r=>r.code);
    const add=r=>reasons.push(r);
    if(typeof entry.captureId!=='string' || !entry.captureId || ids.filter(id=>id===entry.captureId).length!==1) add('DUPLICATE_OR_INVALID_CAPTURE_ID');
    if(!reference(record?.sourceRef)) add('INVALID_SOURCE_REFERENCE');
    if(!['ORIGINAL_CAPTURE','RETROSPECTIVE_ARCHIVE'].includes(entry.origin)) add('UNKNOWN_CAPTURE_ORIGIN');
    let raw;
    try{raw=JSON.parse(context.rawBody);}catch{add('RAW_BODY_UNAVAILABLE');}
    const bodyBound=raw && !Array.isArray(raw) && typeof raw==='object' && typeof context.rawBody==='string' && hash(context.rawBody)===record?.payloadHash;
    const receipts=reviewedReceipts.filter(r=>r.captureId===entry.captureId);
    const receipt=receipts.length===1 ? receipts[0]:null;
    const acquisition=timestamp(record?.acquiredAt),decision=timestamp(context?.decisionAt),observed=timestamp(record?.observedAt);
    const captureProven=bodyBound && reference(record?.sourceRef) && receipt && receipt.payloadHash===record.payloadHash && receipt.sourceRef===record.sourceRef && receipt.source===record.source && reference(receipt.auditRef) && reference(receipt.captureLogRef) && receipt.independentlyTimed===true && timestamp(receipt.acquiredAt)!==null && timestamp(receipt.acquiredAt)===acquisition;
    if(!captureProven) add('INDEPENDENT_CAPTURE_RECEIPT_UNAVAILABLE');
    const availability=timestamp(receipt?.firstAvailableAt);
    const originalProven=captureProven && reference(receipt.observationAuthorityRef) && observed!==null && timestamp(receipt.providerObservedAt)===observed && availability!==null && observed<=availability && availability<=acquisition && decision!==null && availability<=decision;
    if(!originalProven) add('ORIGINAL_AVAILABILITY_UNVERIFIED');
    // Status must be bound to the same raw bytes, not an adapter/default flag.
    const path=entry.marketState?.path;
    const parts=typeof path==='string' ? path.split('.'):[];
    const safe=parts.length && parts.every(k=>k && !['__proto__','prototype','constructor'].includes(k));
    const state=safe ? parts.reduce((v,k)=>v && Object.hasOwn(v,k) ? v[k]:undefined,raw):undefined;
    const open=state==='OPEN' && reference(entry.marketState?.semanticsRef);
    if(!open) add('MARKET_OPEN_STATE_UNVERIFIED');
    if(entry.origin==='RETROSPECTIVE_ARCHIVE') add('RETROSPECTIVE_ARCHIVE_NOT_PROSPECTIVE');
    const rawErrors=a.reasons.filter(r=>!['MISSING_PROVIDER_TIMESTAMP','INVALID_PROVIDER_TIMESTAMP','PROVIDER_CLOCK_NOT_BOUND_TO_RAW','QUOTE_STALE_AT_DECISION','POST_KICKOFF_OR_FUTURE_INFORMATION','ACQUISITION_PRECEDES_PROVIDER_OBSERVATION'].includes(r.code));
    const structurallyValid=bodyBound && rawErrors.length===0 && !reasons.includes('INVALID_SOURCE_REFERENCE') && !reasons.includes('DUPLICATE_OR_INVALID_CAPTURE_ID') && !reasons.includes('UNKNOWN_CAPTURE_ORIGIN');
    const eligible=structurallyValid && originalProven && open && a.quote!==null;
    const evidenceClass=eligible?'A':structurallyValid && captureProven?'B':structurallyValid && entry.origin==='RETROSPECTIVE_ARCHIVE'?'C':'D';
    // Archive retrieval cannot create a prospective capture; an independently
    // verified historical quote may still be A for historical research only.
    return {captureId:entry.captureId ?? null,evidenceClass,eligibleHistorical:eligible,
      prospectiveReady:false,candidateStatus:'NOT_CREATED',quote:eligible?a.quote:null,
      reasons:[...new Set(reasons)],rawHash:bodyBound?record.payloadHash:null,
      sourceRef:record?.sourceRef ?? null,providerObservedAt:record?.observedAt ?? null,
      acquiredAt:record?.acquiredAt ?? null,firstAvailableAt:originalProven?receipt.firstAvailableAt:null,
      auditRef:captureProven?receipt.auditRef:null,trustBasis:'EXTERNALLY_REVIEWED_RECEIPT_MANIFEST_NOT_SELF_VERIFIED',
      authority:AUTHORITY};
  });
}

export function prospectiveSourceReadiness({source,approvedReuse,rawPreserved,originalClockPreserved,openStatePreserved,noAdditionalRequests,quotaCostVerified}) {
  const reasons=[];
  const sourceId=typeof source==='string'?source.trim().toLowerCase():null;
  if(!approvedSourceIds.has(sourceId) && !blocked.has(sourceId)) reasons.push('UNKNOWN_SOURCE');
  if(blocked.has(sourceId)) reasons.push('PROVIDER_RESTRICTED');
  if(approvedReuse!==true) reasons.push('REUSE_AUTHORIZATION_UNVERIFIED');
  if(rawPreserved!==true) reasons.push('RAW_CAPTURE_NOT_PRESERVED');
  if(originalClockPreserved!==true) reasons.push('ORIGINAL_QUOTE_CLOCK_UNAVAILABLE');
  if(openStatePreserved!==true) reasons.push('EXECUTABILITY_UNVERIFIED');
  if(noAdditionalRequests!==true || quotaCostVerified!==true) reasons.push('ZERO_MARGINAL_ACQUISITION_COST_UNVERIFIED');
  return{source:source ?? null,status:reasons.length?'NOT_READY':'DRY_RUN_READY',reasons,
    acquisitionEnabled:false,canInvokeProvider:false,authority:AUTHORITY};
}

export function captureAuditJson(input) {
  // Strict JSON rejects functions/callbacks, nonfinite values and unknown authority.
  canonicalJson(input);
  const rejectAuthority=v=>{if(v && typeof v==='object')for(const[k,x]of Object.entries(v)){if(['canAuthorizeWager','canQualify','canPromote','canAuthorize','can_authorize_wager','can_qualify','can_promote'].includes(k)&&x!==false&&x!==0)throw new Error('AUTHORITY_ACTIVATION_FORBIDDEN');rejectAuthority(x);}};
  rejectAuthority(input);
  return{contract:'SITUATIONAL-CAPTURE-READINESS-v1',observations:auditOfflineCaptures(input.entries,{reviewedReceipts:input.reviewedReceipts}),sources:(input.sources||[]).map(prospectiveSourceReadiness),authority:AUTHORITY};
}
