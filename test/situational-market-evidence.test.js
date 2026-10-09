import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { adaptObservation, adaptPopulation, fromStoredRow, movement, registerProtocol, candidateSnapshot, researchGrade, summarizeGrades, verifySeal, canonicalJson, AUTHORITY } from '../research/situational/marketEvidence.mjs';
import { persistArtifact, readArtifact } from '../research/situational/artifactStore.mjs';
import { PATTERNS, VERSION } from '../research/situational/discovery.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const clock='2027-09-01T12:00:00Z', kickoff='2027-09-01T20:00:00Z';
function fixture() {
  const body={ providerEventId:'provider-g',sport:'NFL',league:'NFL',homeProviderId:'11',awayProviderId:'22',selectedProviderTeamId:'22',side:'AWAY',market:'FULL_GAME_SPREAD',period:'FULL_GAME',book:'Pinnacle',line:3.5,price:-110,observedAt:'2027-09-01T11:55:00Z' };
  const rawBody=JSON.stringify(body), fields=Object.fromEntries(Object.keys(body).map(k=>[k,k]));
  const record={...body,observationId:'obs-1',eventId:'canonical-g',homeId:'H',awayId:'A',selectedTeamId:'A',kickoff,source:'fixture-provider',acquiredAt:'2027-09-01T11:56:00Z',payloadHash:digest(rawBody),sourceRef:'immutable://fixture-body',signConvention:'SELECTED_TEAM_SIGNED'};
  const event={id:'canonical-g',providerEventId:'provider-g',sport:'NFL',league:'NFL',homeId:'H',awayId:'A',homeProviderId:'11',awayProviderId:'22',kickoff,verified:true,provenanceRef:'immutable://identity',availableAt:'2027-08-01T00:00:00Z'};
  const policy={source:'fixture-provider',version:'fixture-v1',maxAgeSeconds:300,bookmakers:['Pinnacle','DraftKings'],provenanceRef:'immutable://policy'};
  const mapping={source:'fixture-provider',verified:true,provenanceRef:'immutable://schema',availableAt:'2027-08-01T00:00:00Z',clockSemantics:'PROVIDER_ORIGINAL',signConvention:'SELECTED_TEAM_SIGNED',fields};
  return {record,context:{event,policy,mapping,rawBody,decisionAt:clock}};
}
const adapt=f=>adaptObservation(f.record,f.context);
function spec() {return { eventIds:['canonical-g'],population:[{eventId:'canonical-g',side:'AWAY',sport:'NFL',homeId:'H',awayId:'A',decisionAt:clock,kickoff}],populationRef:'immutable://full-cohort',patterns:PATTERNS,registryVersion:VERSION,sports:['NFL','CFB'],market:'FULL_GAME_SPREAD',period:'FULL_GAME',selectionRule:'ONE_REGISTERED_SIDE_PER_EVENT',minSample:30,alpha:0.05,statisticalPlanRef:'immutable://statistical-plan',correction:'BONFERRONI_FULL_REGISTRY',pushTreatment:'SEPARATE_RETURN_STAKE',stoppingRule:'FIXED_END_NO_EARLY_STOP',decisionSchedule:'fixed registered UTC decisions',inclusionRules:'all registered events',exclusionRules:'retain every invalid input',predictiveMetrics:'conditional Brier/log loss + push mass',economicMetrics:'one-unit simulated net and drawdown',incumbentComparison:'exact same decision and line',concentrationChecks:'event/season/team counts and overlap',uncertaintyMethod:'event/season cluster bootstrap before qualification',maxCaptureLagSeconds:30,freshnessPolicies:{'fixture-provider':fixture().context.policy},holdout:{startAt:'2027-09-01T00:00:00Z',endAt:'2027-10-01T00:00:00Z',unseen:true,provenanceRef:'immutable://unseen-holdout'}};}
const protocol=()=>registerProtocol(spec(),'2027-08-01T00:00:00Z');
function game() {
  const evidence=value=>({value,eventId:'canonical-g',source:'fixture',observedAt:'2027-09-01T11:50:00Z',availableAt:'2027-09-01T11:51:00Z',pitVerified:true,provenanceRef:'immutable://feature'});
  return {eventId:'canonical-g',sport:'NFL',side:'AWAY',decisionAt:clock,kickoff,identity:{verified:true,homeId:'H',awayId:'A',provenanceRef:'immutable://identity'},features:{rest:evidence(7),opponentRest:evidence(7),record:evidence({games:3,wins:2})}};
}
const candidate=()=>candidateSnapshot({game:game(),adapted:adapt(fixture()),protocol:protocol(),codeSha:'a'.repeat(40)},clock);
const outcome=()=>({eventId:'canonical-g',verified:true,status:'FINAL',homeScore:24,awayScore:21,source:'fixture-final',provenanceRef:'immutable://final',completedAt:'2027-09-01T23:00:00Z',observedAt:'2027-09-01T23:05:00Z'});

test('eligible raw-bound quote preserves clocks, price, exact side and authority',()=>{
  const r=adapt(fixture());assert.equal(r.classification,'PIT_VERIFIED');assert.equal(r.quote.line,3.5);assert.equal(r.quote.availableAt,'2027-09-01T11:56:00Z');assert.deepEqual(r.authority,AUTHORITY);
});
test('missing provider clock never falls back to acquisition clock',()=>{
  const f=fixture();f.record.observedAt=null;const r=adapt(f);assert.equal(r.quote,null);assert.ok(r.reasons.some(x=>x.code==='MISSING_PROVIDER_TIMESTAMP'));assert.equal(r.descriptive.observedAt,null);
});
test('raw timestamp must be original provider field, not copied collection time',()=>{
  const f=fixture();f.record.observedAt=f.record.acquiredAt;assert.ok(adapt(f).reasons.some(x=>x.code==='PROVIDER_CLOCK_NOT_BOUND_TO_RAW'));
  f.context.mapping.clockSemantics='ACQUISITION';assert.equal(adapt(f).quote,null);
});
test('changed snapshot bytes or substituted price fail hash/raw binding',()=>{
  const f=fixture();f.context.rawBody+=' ';assert.ok(adapt(f).reasons.some(x=>x.code==='RAW_SOURCE_UNVERIFIED'));
  const b=fixture();b.record.price=-105;assert.ok(adapt(b).reasons.some(x=>x.code==='RAW_FIELD_MISMATCH:price'));
});
test('canonical/provider event and team conflicts rejected without fuzzy joins',()=>{
  for(const patch of [{eventId:'other'},{homeId:'other'},{providerEventId:'other'},{selectedTeamId:'H'}]){const f=fixture();Object.assign(f.record,patch);assert.equal(adapt(f).quote,null);}
});
test('wrong period or unsupported market rejected',()=>{
  for(const patch of [{period:'FIRST_HALF'},{market:'MONEYLINE'}]){const f=fixture();Object.assign(f.record,patch);assert.equal(adapt(f).classification,'INVALID_MARKET');}
});
test('book identity is explicit, approved and never consensus',()=>{
  for(const book of ['','consensus','Unknown','OtherBook',null]){const f=fixture();f.record.book=book;assert.equal(adapt(f).quote,null);}
});
test('American odds reject strings fractions zero unsafe and nonfinite',()=>{
  for(const price of ['-110',-110.5,0,99,1e20,Infinity,null]){const f=fixture();f.record.price=price;assert.equal(adapt(f).quote,null);}
});
test('spread signs follow declared selected-side semantics; zero preserved',()=>{
  const f=fixture();f.record.line=-3.5;assert.ok(adapt(f).reasons.some(x=>x.code==='SPREAD_SIGN_OR_RAW_LINE_CONFLICT'));
  const z=fixture();const body=JSON.parse(z.context.rawBody);body.line=0;z.context.rawBody=JSON.stringify(body);z.record.line=0;z.record.payloadHash=digest(z.context.rawBody);assert.equal(adapt(z).quote.line,0);
});
test('home-signed convention negates only away selection when explicitly verified',()=>{
  const f=fixture();f.context.mapping.signConvention='HOME_TEAM_SIGNED';f.record.signConvention='HOME_TEAM_SIGNED';f.record.line=-3.5;
  assert.equal(adapt(f).quote.line,-3.5);f.record.signConvention='SELECTED_TEAM_SIGNED';assert.equal(adapt(f).quote,null);
});
test('exact freshness boundary accepted, older quote excluded',()=>{
  const f=fixture();assert.notEqual(adapt(f).quote,null);f.context.decisionAt='2027-09-01T12:00:00.001Z';assert.equal(adapt(f).classification,'STALE_AT_DECISION');
});
test('post-kickoff and future acquisition/provider information fail closed',()=>{
  for(const patch of [{observedAt:kickoff},{acquiredAt:'2027-09-01T12:00:01Z'}]){const f=fixture();Object.assign(f.record,patch);assert.ok(adapt(f).reasons.some(x=>x.code==='POST_KICKOFF_OR_FUTURE_INFORMATION'));}
});
test('duplicate and conflicting observations rejected as a complete population',()=>{
  const a=fixture(),b=fixture();b.record.line=4;const r=adaptPopulation([a.record,b.record],[a.context,b.context]);assert.ok(r.every(x=>x.quote===null));assert.ok(r.every(x=>x.reasons.some(y=>y.code==='DUPLICATE_OR_CONFLICTING_OBSERVATION')));
});
test('stored ACTION/odds rows preserve unknown provider clock and identities',()=>{
  const a=fromStoredRow('action_market_book_observations',{id:'x',sport:'nfl',collected_at:clock,provider_timestamp:null,selection:'away',market_type:'spread',market_period:'event',line:3.5});assert.equal(a.observedAt,null);assert.equal(a.side,'AWAY');assert.equal(a.homeId,null);
  const o=fromStoredRow('odds_snapshots',{id:1,sport:'cfb',captured_at:clock});assert.equal(o.observedAt,null);assert.equal(o.acquiredAt,clock);assert.equal(o.payloadHash,null);
});
function secondQuote(patch={}) {const f=fixture();const body={...JSON.parse(f.context.rawBody),observedAt:'2027-09-01T11:56:00Z',line:4,...patch};f.context.rawBody=JSON.stringify(body);f.record={...f.record,...body,observationId:'obs-2',acquiredAt:'2027-09-01T11:57:00Z',payloadHash:digest(f.context.rawBody)};return adapt(f);}
test('movement distinguishes line and price changes; public/RLM unavailable',()=>{
  const r=movement([adapt(fixture()),secondQuote({price:-115})]);assert.equal(r.status,'VERIFIED_RESEARCH_SERIES');assert.equal(r.points[1].lineChange,.5);assert.equal(r.points[1].priceChange,-5);assert.equal(r.reverseLineMovement,null);
});
test('cross-book and missing provider clocks cannot create movement',()=>{
  assert.equal(movement([adapt(fixture()),secondQuote({book:'DraftKings'})]).status,'UNAVAILABLE');const f=fixture();f.record.observedAt=null;assert.equal(movement([adapt(f),adapt(fixture())]).status,'UNAVAILABLE');
});
test('protocol rejects already-inspected history and incomplete plans',()=>{
  assert.throws(()=>registerProtocol(spec(),'2027-09-02T00:00:00Z'),/HOLDOUT/);const s=spec();delete s.uncertaintyMethod;assert.throws(()=>registerProtocol(s,'2027-08-01T00:00:00Z'),/MISSING_PROTOCOL/);
});
test('all preregistered hypotheses retained, duplicates forbidden',()=>{
  const s=spec();s.patterns=[...PATTERNS,PATTERNS[0]];assert.throws(()=>registerProtocol(s,'2027-08-01T00:00:00Z'),/REGISTRY/);assert.equal(protocol().payload.patterns.length,4);
});
test('prospective snapshot requires capture before kickoff and registered lag',()=>{
  assert.equal(candidate().payload.classification,'PROSPECTIVE_SHADOW');const input={game:game(),adapted:adapt(fixture()),protocol:protocol(),codeSha:'a'.repeat(40)};
  assert.equal(candidateSnapshot(input,'2027-09-01T12:01:00Z').payload.classification,'RETROSPECTIVE_RECONSTRUCTION');assert.equal(candidateSnapshot(input,'2027-09-02T00:00:00Z').payload.classification,'RETROSPECTIVE_RECONSTRUCTION');
});
test('future feature availability does not become a candidate match',()=>{
  const g=game();g.features.rest.value=4;g.features.rest.availableAt='2027-09-01T12:01:00Z';const c=candidateSnapshot({game:g,adapted:adapt(fixture()),protocol:protocol(),codeSha:'a'.repeat(40)},clock);assert.equal(c.payload.packet.diagnostics['short-rest'],'MISSING_OR_INVALID_EVIDENCE');
});
test('snapshot is detached and tamper detectable',()=>{
  const c=candidate();assert.equal(verifySeal(c),true);const changed=JSON.parse(JSON.stringify(c));changed.payload.quote.price=-105;assert.equal(verifySeal(changed),false);
});
test('wager/promotion authority activation forbidden',()=>{
  const g=game();g.canAuthorizeWager=true;assert.throws(()=>candidateSnapshot({game:g,adapted:adapt(fixture()),protocol:protocol(),codeSha:'a'.repeat(40)},clock),/AUTHORITY/);
});
test('nonmatching cohort games still require verified final outcomes',()=>{
  assert.equal(candidate().payload.packet.candidates.length,0);assert.equal(researchGrade(candidate(),null).payload.status,'PENDING');const bad=outcome();bad.eventId='other';assert.equal(researchGrade(candidate(),bad).payload.status,'PENDING');
});
test('grade uses exact preserved entry price, never realized profit or invented EV/CLV',()=>{
  const g=researchGrade(candidate(),outcome());assert.equal(g.payload.status,'RESEARCH_GRADED');assert.ok(Math.abs(g.payload.simulatedProfitUnits-100/110)<1e-12);assert.equal(g.payload.expectedValueUnits,null);assert.equal(g.payload.clv,null);assert.equal(g.payload.economicBasis,'PROSPECTIVE_SIMULATED');
});
test('push returns stake; scores remain source-provenance bound',()=>{
  const f=fixture();const body=JSON.parse(f.context.rawBody);body.line=3;f.context.rawBody=JSON.stringify(body);f.record.line=3;f.record.payloadHash=digest(f.context.rawBody);const c=candidateSnapshot({game:game(),adapted:adapt(f),protocol:protocol(),codeSha:'a'.repeat(40)},clock);const g=researchGrade(c,outcome());assert.equal(g.payload.result,'PUSH');assert.equal(g.payload.simulatedProfitUnits,0);
});
test('append-only candidate retries preserve bytes and conflict on changed evidence',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fbis-research-'));try{const c=candidate();const a=await persistArtifact(dir,c);assert.equal((await persistArtifact(dir,c)).status,'ALREADY_PRESENT');const prior=await readFile(a.path,'utf8');const input={game:game(),adapted:adapt(fixture()),protocol:protocol(),codeSha:'b'.repeat(40)};const changed=candidateSnapshot(input,clock);await assert.rejects(persistArtifact(dir,changed),/IMMUTABLE_ARTIFACT_CONFLICT/);assert.equal(await readFile(a.path,'utf8'),prior);assert.equal((await readArtifact(a.path)).sha256,c.sha256);}finally{await rm(dir,{recursive:true,force:true});}
});
test('outcomes live in a separate artifact and cannot overwrite original candidate',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fbis-research-'));try{const c=candidate(),saved=await persistArtifact(dir,c),before=await readFile(saved.path,'utf8');await persistArtifact(dir,researchGrade(c,outcome()));assert.equal(await readFile(saved.path,'utf8'),before);}finally{await rm(dir,{recursive:true,force:true});}
});
test('filesystem tampering detected on reload',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fbis-research-'));try{const saved=await persistArtifact(dir,candidate());const body=JSON.parse(await readFile(saved.path,'utf8'));body.payload.classification='PROSPECTIVE';await chmod(saved.path,0o644);await writeFile(saved.path,JSON.stringify(body));await assert.rejects(readArtifact(saved.path),/TAMPER/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('missing outcomes block aggregate economics; duplicate grades rejected',()=>{
  const c=candidate(),pending=researchGrade(c,null);assert.equal(summarizeGrades(protocol(),[c],[pending]).profitUnits,null);const g=researchGrade(c,outcome());assert.equal(summarizeGrades(protocol(),[c],[g]).realizedProfit,null);assert.throws(()=>summarizeGrades(protocol(),[c],[g,g]),/DUPLICATE/);
});
test('canonical serialization ignores object order but rejects unknown/nonfinite values',()=>{
  assert.equal(canonicalJson({b:1,a:2}),canonicalJson({a:2,b:1}));assert.throws(()=>canonicalJson({a:undefined}),/NON_JSON/);assert.throws(()=>canonicalJson(Infinity),/NON_JSON/);
});
test('falsy or array raw JSON cannot bypass field binding',()=>{
  for(const body of ['null','false','0','[]']){const f=fixture();f.context.rawBody=body;f.record.payloadHash=digest(body);const r=adapt(f);assert.equal(r.quote,null);assert.ok(r.reasons.some(x=>x.code==='RAW_SOURCE_NOT_OBJECT'));}
});
test('candidate identity, registered side and exact decision must match',()=>{
  for(const patch of [{identity:{verified:true,homeId:'WRONG',awayId:'OTHER',provenanceRef:'x'}},{side:'HOME'},{decisionAt:'2027-09-01T12:00:01Z'}]) {
    const g={...game(),...patch};assert.throws(()=>candidateSnapshot({game:g,adapted:adapt(fixture()),protocol:protocol(),codeSha:'a'.repeat(40)},g.decisionAt),/MISMATCH/);
  }
});
test('same event different code versions cannot double simulated economics',()=>{
  const a=candidate(),b=candidateSnapshot({game:game(),adapted:adapt(fixture()),protocol:protocol(),codeSha:'b'.repeat(40)},clock);
  assert.throws(()=>summarizeGrades(protocol(),[a,b],[researchGrade(a,outcome()),researchGrade(b,outcome())]),/DUPLICATE_EVENT/);
});
test('omitted candidates or final grades leave complete-cohort economics unavailable',()=>{
  const c=candidate();assert.equal(summarizeGrades(protocol(),[],[]).profitUnits,null);assert.equal(summarizeGrades(protocol(),[c],[]).profitUnits,null);
});
test('pending observations cannot block later separate final grade',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fbis-research-'));try{const c=candidate();await persistArtifact(dir,researchGrade(c,null));const final=await persistArtifact(dir,researchGrade(c,outcome()));assert.equal(final.status,'CREATED');}finally{await rm(dir,{recursive:true,force:true});}
});
test('rehashed semantic alterations fail reconstructed contract checks',()=>{
  const c=JSON.parse(JSON.stringify(candidate()));c.payload.classification='RETROSPECTIVE_RECONSTRUCTION';const {sha256,...body}=c;c.sha256=digest(canonicalJson(body));assert.equal(verifySeal(c),false);
  const p=JSON.parse(JSON.stringify(protocol()));p.payload.population[0].side='WRONG';const {sha256:ignored,...b}=p;p.sha256=digest(canonicalJson(b));assert.equal(verifySeal(p),false);
});
test('changed adapter result cannot reach immutable candidate evidence',()=>{
  const a=JSON.parse(JSON.stringify(adapt(fixture())));a.quote.price=-105;
  assert.throws(()=>candidateSnapshot({game:game(),adapted:a,protocol:protocol(),codeSha:'a'.repeat(40)},clock),/CHANGED_ADAPTER/);
});
test('null provider event identities cannot pass equal-null joins',()=>{
  const f=fixture(),body=JSON.parse(f.context.rawBody);body.providerEventId=null;f.context.rawBody=JSON.stringify(body);f.record.payloadHash=digest(f.context.rawBody);f.record.providerEventId=null;f.context.event.providerEventId=null;
  assert.equal(adapt(f).quote,null);assert.ok(adapt(f).reasons.some(r=>r.code==='MISSING_PROVIDER_EVENT_ID'));
});
test('population conflicts survive candidate serialization and semantic reload',()=>{
  const a=fixture(),b=fixture();const adapted=adaptPopulation([a.record,b.record],[a.context,b.context])[0];
  const c=candidateSnapshot({game:game(),adapted,protocol:protocol(),codeSha:'a'.repeat(40)},clock);
  assert.equal(c.payload.quote,null);assert.ok(c.payload.adapterDiagnostics.some(r=>r.code==='DUPLICATE_OR_CONFLICTING_OBSERVATION'));assert.equal(verifySeal(c),true);
});
test('movement cannot use altered adapter outputs',()=>{
  const changed=JSON.parse(JSON.stringify(secondQuote()));changed.quote.line=9;
  assert.equal(movement([adapt(fixture()),changed]).reason,'CHANGED_ADAPTER_RESULT');
});
test('statistical alpha and preserved plan must be frozen before holdout',()=>{
  const s=spec();s.alpha=null;assert.throws(()=>registerProtocol(s,'2027-08-01T00:00:00Z'),/STATISTICAL_PLAN/);
});
test('asserted opposing PIT flag alone cannot supply a paired no-vig baseline',()=>{
  const q={...adapt(fixture()).quote,side:'HOME',line:-3.5};assert.equal(researchGrade(candidate(),outcome(),{oppositeQuote:q}).payload.noVigBaseline,null);
});
test('CLI refuses backdated registration and does not accept input capture clocks',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fbis-research-cli-'));try{
    const s=spec();s.holdout={...s.holdout,startAt:'2020-09-01T00:00:00Z',endAt:'2020-10-01T00:00:00Z'};s.recordedAt='2019-01-01T00:00:00Z';
    const path=join(dir,'input.json');await writeFile(path,JSON.stringify(s));const r=spawnSync(process.execPath,['scripts/situational-market-evidence.mjs','register',path],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/HOLDOUT_NOT_UNSEEN_FUTURE/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
