import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { captureAuditJson, prospectiveSourceReadiness } from '../research/situational/captureReadiness.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const body={providerEventId:'p',sport:'NFL',league:'NFL',homeProviderId:'h',awayProviderId:'a',selectedProviderTeamId:'a',side:'AWAY',market:'FULL_GAME_SPREAD',period:'FULL_GAME',book:'DraftKings',price:-110,line:3.5,observedAt:'2027-09-01T11:59:00Z',state:'OPEN'};
 const rawBody=JSON.stringify(body),sourceRef='r2://research/raw/fixture.json',acquiredAt='2027-09-01T11:59:01Z',kickoff='2027-09-01T20:00:00Z';
 const record={...body,observationId:'o',eventId:'e',homeId:'H',awayId:'A',selectedTeamId:'A',source:'test-source',sourceRef,payloadHash:digest(rawBody),acquiredAt,kickoff,signConvention:'SELECTED_TEAM_SIGNED'};
 const context={decisionAt:'2027-09-01T12:00:00Z',rawBody,event:{id:'e',providerEventId:'p',homeId:'H',awayId:'A',homeProviderId:'h',awayProviderId:'a',sport:'NFL',league:'NFL',kickoff,verified:true,availableAt:'2027-08-01T00:00:00Z',provenanceRef:'r2://research/identity.json'},policy:{source:'test-source',maxAgeSeconds:600,bookmakers:['DraftKings'],version:'fixture-v1',provenanceRef:'r2://research/policy.json'},mapping:{source:'test-source',verified:true,provenanceRef:'r2://research/schema.json',availableAt:'2027-08-01T00:00:00Z',clockSemantics:'PROVIDER_ORIGINAL',signConvention:'SELECTED_TEAM_SIGNED',fields:Object.fromEntries(Object.keys(body).map(k=>[k,k]))}};
 // Synthetic audited-registry fixture. This is not historical proof or a real audit.
 const receipt={captureId:'c',source:'test-source',sourceRef,payloadHash:record.payloadHash,acquiredAt,firstAvailableAt:acquiredAt,providerObservedAt:body.observedAt,independentlyTimed:true,auditRef:'r2://research/audit.json',captureLogRef:'r2://research/receipt.json',observationAuthorityRef:'r2://research/provider-semantics.json'};
 return{entries:[{captureId:'c',adapterInput:{record,context},origin:'ORIGINAL_CAPTURE',marketState:{path:'state',semanticsRef:'r2://research/state-semantics.json'}}],reviewedReceipts:[receipt],sources:[]};
}
const assess=f=>captureAuditJson(f).observations[0];
test('missing original clock is B capture-only, never A',()=>{const f=fixture();f.entries[0].adapterInput.record.observedAt=null;assert.equal(assess(f).evidenceClass,'B');assert.equal(assess(f).quote,null);});
test('capture time cannot substitute for source time',()=>{const f=fixture();const r=f.entries[0].adapterInput.record;r.observedAt=r.acquiredAt;f.reviewedReceipts[0].providerObservedAt=r.acquiredAt;assert.equal(assess(f).eligibleHistorical,false);});
test('independent availability requires the externally reviewed receipt and exact content',()=>{const f=fixture();assert.equal(assess(f).evidenceClass,'A');f.reviewedReceipts=[];assert.equal(assess(f).evidenceClass,'D');});
test('raw payload mismatch invalidates receipt and quote',()=>{const f=fixture();f.entries[0].adapterInput.context.rawBody+=' ';assert.equal(assess(f).evidenceClass,'D');});
test('invalid source reference fails closed',()=>{const f=fixture();f.entries[0].adapterInput.record.sourceRef='local-file-mtime';assert.equal(assess(f).evidenceClass,'D');});
test('wrong canonical event never gains eligibility from a receipt',()=>{const f=fixture();f.entries[0].adapterInput.record.eventId='wrong';assert.equal(assess(f).evidenceClass,'D');});
test('wrong bookmaker or market fails raw and contract binding',()=>{for(const patch of [{book:'Other'},{market:'MONEYLINE'},{period:'FIRST_HALF'}]){const f=fixture();Object.assign(f.entries[0].adapterInput.record,patch);assert.equal(assess(f).quote,null);}});
test('incorrect spread direction fails exact raw binding',()=>{const f=fixture();f.entries[0].adapterInput.record.line=-3.5;assert.equal(assess(f).quote,null);});
test('late availability cannot enter an earlier decision',()=>{const f=fixture();f.reviewedReceipts[0].firstAvailableAt='2027-09-01T12:00:01Z';assert.equal(assess(f).quote,null);});
test('duplicate capture identities invalidate all members',()=>{const f=fixture();f.entries.push(structuredClone(f.entries[0]));assert.ok(captureAuditJson(f).observations.every(x=>x.quote===null));});
test('archive retrieval never becomes a prospective capture',()=>{const f=fixture();f.entries[0].origin='RETROSPECTIVE_ARCHIVE';assert.equal(assess(f).prospectiveReady,false);f.reviewedReceipts=[];assert.equal(assess(f).evidenceClass,'C');});
test('partial provider fields cannot produce a quote',()=>{const f=fixture();delete f.entries[0].adapterInput.context.mapping.fields.price;assert.equal(assess(f).quote,null);});
test('post-kickoff quote is excluded even with supplied receipts',()=>{const f=fixture();f.entries[0].adapterInput.context.decisionAt='2027-09-01T21:00:00Z';assert.equal(assess(f).quote,null);});
test('blocked providers never become invocable under approved flags',()=>{for(const source of ['action','prizepicks','apify']){const r=prospectiveSourceReadiness({source,approvedReuse:true,rawPreserved:true,originalClockPreserved:true,openStatePreserved:true,noAdditionalRequests:true,quotaCostVerified:true});assert.equal(r.status,'NOT_READY');assert.equal(r.canInvokeProvider,false);}});
test('authority activation and injected acquisition callbacks are rejected',()=>{const f=fixture();f.canAuthorizeWager=true;assert.throws(()=>captureAuditJson(f),/AUTHORITY/);delete f.canAuthorizeWager;f.fetcher=()=>{throw Error('must never run')};assert.throws(()=>captureAuditJson(f),/NON_JSON/);});
test('capture-only proof without provider authority remains B',()=>{const f=fixture();delete f.reviewedReceipts[0].observationAuthorityRef;assert.equal(assess(f).evidenceClass,'B');});
test('suspended or missing active state never becomes an executable offer',()=>{const f=fixture();f.entries[0].marketState.path='missing';assert.equal(assess(f).quote,null);});

test('case variants of restricted providers remain blocked',()=>{for(const source of ['ACTION',' Apify ','PrizePicks'])assert.ok(prospectiveSourceReadiness({source}).reasons.includes('PROVIDER_RESTRICTED'));});
test('unknown providers never receive readiness approval',()=>{assert.ok(prospectiveSourceReadiness({source:'new-provider',approvedReuse:true,rawPreserved:true,originalClockPreserved:true,openStatePreserved:true,noAdditionalRequests:true,quotaCostVerified:true}).reasons.includes('UNKNOWN_SOURCE'));});
test('offline historical eligibility never claims a frozen prospective candidate',()=>{const r=assess(fixture());assert.equal(r.eligibleHistorical,true);assert.equal(r.prospectiveReady,false);assert.equal(r.candidateStatus,'NOT_CREATED');});
test('malformed URLs and whitespace references fail closed',()=>{for(const sourceRef of ['https:///','https://user:pass@example.com/raw','r2://bad bucket/raw']){const f=fixture();f.entries[0].adapterInput.record.sourceRef=sourceRef;f.reviewedReceipts[0].sourceRef=sourceRef;assert.equal(assess(f).quote,null);}});
test('invalid independent receipt references cannot establish A evidence',()=>{for(const key of ['auditRef','captureLogRef','observationAuthorityRef']){const f=fixture();f.reviewedReceipts[0][key]='https:///';assert.notEqual(assess(f).evidenceClass,'A');}});
