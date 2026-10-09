// OFFLINE RESEARCH ONLY. No production bindings, routes, provider calls or authority.
import { createHash } from 'node:crypto';
import { timestamp, scanGame, gradeSpread, economics, PATTERNS, VERSION as REGISTRY_VERSION } from './discovery.mjs';
import { profitUnitsFromAmerican, binaryCalibrationLosses, maximumDrawdown } from '../../functions/lib/canonical/economicGrading.js';

export const CONTRACT = 'SITUATIONAL-MARKET-EVIDENCE-v1';
export const AUTHORITY = Object.freeze({ researchOnly: true, canQualify: false, canAuthorizeWager: false, canPromote: false });
const str = x => typeof x === 'string' && x.trim() !== '';
const num = x => typeof x === 'number' && Number.isFinite(x);
const hash = x => createHash('sha256').update(x).digest('hex');
const hex = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const clone = x => JSON.parse(canonicalJson(x));

export function canonicalJson(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (num(v)) return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + Array.from(v, canonicalJson).join(',') + ']';
  if (v && Object.getPrototypeOf(v) === Object.prototype) return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  throw new Error('NON_JSON_EVIDENCE');
}
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
function assertAuthority(v) {
  if (!v || typeof v !== 'object') return;
  for (const [k, value] of Object.entries(v)) {
    if (['canQualify', 'canAuthorize', 'canAuthorizeWager', 'canPromote', 'can_qualify', 'can_authorize_wager'].includes(k) && value !== false && value !== 0) throw new Error('AUTHORITY_ACTIVATION_FORBIDDEN');
    assertAuthority(value);
  }
}
function seal(kind, payload) {
  assertAuthority(payload);
  const body = { contract: CONTRACT, kind, payload: clone(payload), authority: AUTHORITY };
  return freeze({ ...body, sha256: hash(canonicalJson(body)) });
}
export function verifySeal(envelope) {
  try {
    if (!envelope || envelope.contract !== CONTRACT || !['PROTOCOL', 'CANDIDATE', 'GRADE'].includes(envelope.kind)) return false;
    assertAuthority(envelope);
    const { sha256, ...body } = envelope;
    if (!hex(sha256) || canonicalJson(envelope.authority) !== canonicalJson(AUTHORITY) || hash(canonicalJson(body)) !== sha256) return false;
    const p=envelope.payload;
    if(envelope.kind === 'PROTOCOL') return registerProtocol(p,p.recordedAt).sha256 === sha256;
    if(envelope.kind === 'CANDIDATE') return candidateSnapshot({game:p.game,adapted:reproduceAdapter(p.adapterInput),protocol:p.protocol,codeSha:p.codeSha},p.recordedAt).sha256 === sha256;
    if(envelope.kind === 'GRADE') return researchGrade(p.candidate,p.outcome,p.evaluation).sha256 === sha256;
    return false;
  } catch { return false; }
}

const atPath = (body, path) => typeof path === 'string' && path.split('.').every(k => k && !['__proto__','prototype','constructor'].includes(k)) ? path.split('.').reduce((v, k) => v && Object.hasOwn(v, k) ? v[k] : undefined, body) : undefined;

// Existing D1 rows remain descriptive without the independently verified raw/mapping
// context required below. No clock fallback, fuzzy identity join or book substitution.
export function fromStoredRow(table, r) {
  if (table === 'action_market_book_observations') return {
    observationId: r.id ?? null, eventId: r.canonical_event_id ?? null, providerEventId: r.provider_event_id ?? null,
    sport: r.sport?.toUpperCase() ?? null, league: null, kickoff: r.event_start_time ?? null,
    market: r.market_type === 'spread' ? 'FULL_GAME_SPREAD' : r.market_type ?? null,
    period: r.market_period === 'event' ? 'FULL_GAME' : r.market_period ?? null,
    side: ['home','away'].includes(r.selection) ? r.selection.toUpperCase() : r.selection ?? null,
    line: r.line ?? null, price: r.american_price ?? null, book: r.sportsbook ?? null,
    source: 'action', observedAt: r.provider_timestamp ?? null, acquiredAt: r.collected_at ?? null,
    payloadHash: r.raw_payload_hash ?? null, sourceRef: r.source_observation_id ?? null,
    signConvention: 'SELECTED_TEAM_SIGNED', homeId: null, awayId: null, selectedTeamId: null };
  if (table === 'odds_snapshots') return {
    observationId: String(r.id), eventId: r.game_id ?? null, providerEventId: r.event_id ?? null,
    sport: r.sport?.toUpperCase() ?? null, league: null, kickoff: r.game_start ?? null,
    market: r.market === 'spread' ? 'FULL_GAME_SPREAD' : r.market ?? null,
    period: r.period === 'fg' ? 'FULL_GAME' : r.period ?? null, side: r.side ?? null,
    line: r.line ?? null, price: r.price ?? null, book: r.book ?? null, source: 'stored-odds',
    observedAt: null, acquiredAt: r.captured_at ?? null, payloadHash: null, sourceRef: null,
    signConvention: 'SELECTED_TEAM_SIGNED', homeId: null, awayId: null, selectedTeamId: null };
  if (table === 'normalized_market_observations') return {
    observationId: r.id ?? null, eventId: r.canonical_event_id ?? null, providerEventId: r.provider_event_id ?? null,
    sport: r.sport?.toUpperCase() ?? null, league: r.league ?? null, kickoff: r.event_start_time ?? null,
    market: r.market_family === 'spread' ? 'FULL_GAME_SPREAD' : r.market_family ?? null,
    period: r.period === 'fg' ? 'FULL_GAME' : r.period ?? null, side: r.side ?? null,
    line: r.line ?? null, price: r.american_odds ?? null, book: null, source: r.source ?? null,
    observedAt: r.source_observed_at ?? null, acquiredAt: r.collected_at ?? null,
    payloadHash: r.raw_payload_hash ?? null, sourceRef: null, signConvention: null,
    homeId: null, awayId: null, selectedTeamId: null };
  throw new Error('UNSUPPORTED_STORAGE_CONTRACT');
}

export function adaptObservation(record, { event, decisionAt, policy, rawBody, mapping } = {}) {
  const reasons = [], add = (code, classification) => reasons.push({ code, classification });
  const decision = timestamp(decisionAt), kickoff = timestamp(event?.kickoff), observed = timestamp(record?.observedAt), acquired = timestamp(record?.acquiredAt);
  if (!record || !str(record.observationId)) add('MISSING_OBSERVATION_ID', 'PROVENANCE_INCOMPLETE');
  if (!str(record?.providerEventId) || !str(event?.providerEventId)) add('MISSING_PROVIDER_EVENT_ID', 'UNMATCHED_EVENT');
  if (!event || !str(event.id) || event.verified !== true || !str(event.provenanceRef) || !str(event.homeId) || !str(event.awayId) || !str(event.homeProviderId) || !str(event.awayProviderId) || event.homeId === event.awayId || event.homeProviderId === event.awayProviderId || record?.eventId !== event.id || record?.sport !== event.sport || record?.league !== event.league || record?.homeId !== event.homeId || record?.awayId !== event.awayId || record?.providerEventId !== event.providerEventId || timestamp(record?.kickoff) !== kickoff || kickoff === null) add('EVENT_OR_TEAM_MISMATCH', 'UNMATCHED_EVENT');
  if (timestamp(event?.availableAt) === null || decision === null || timestamp(event?.availableAt) > decision) add('EVENT_NOT_AVAILABLE_AT_DECISION', 'PROVENANCE_INCOMPLETE');
  if (!['NFL','CFB'].includes(record?.sport) || record?.market !== 'FULL_GAME_SPREAD' || record?.period !== 'FULL_GAME') add('UNSUPPORTED_MARKET_OR_PERIOD', 'INVALID_MARKET');
  if (!['HOME','AWAY'].includes(record?.side) || record?.selectedTeamId !== (record?.side === 'HOME' ? event?.homeId : event?.awayId)) add('SELECTION_MISMATCH', 'INVALID_MARKET');
  if (!num(record?.line)) add('INVALID_LINE', 'INVALID_MARKET');
  if (!Number.isSafeInteger(record?.price) || Math.abs(record.price) < 100) add('INVALID_AMERICAN_ODDS', 'INVALID_MARKET');
  if (!str(record?.book) || /^(consensus|average|unknown|none|n\/a)$/i.test(record.book) || !policy?.bookmakers?.includes(record.book)) add('INVALID_OR_UNVERIFIED_BOOK', 'INVALID_MARKET');
  if (!policy || policy.source !== record?.source || !str(policy.version) || !str(policy.provenanceRef) || !num(policy.maxAgeSeconds) || policy.maxAgeSeconds < 0) add('MISSING_SOURCE_FRESHNESS_POLICY', 'PROVENANCE_INCOMPLETE');
  if (observed === null) add(record?.observedAt == null || record?.observedAt === '' ? 'MISSING_PROVIDER_TIMESTAMP' : 'INVALID_PROVIDER_TIMESTAMP', 'PROVENANCE_INCOMPLETE');
  if (acquired === null) add('MISSING_OR_INVALID_ACQUISITION_TIMESTAMP', 'PROVENANCE_INCOMPLETE');
  if (decision === null || decision >= kickoff || observed !== null && (observed >= kickoff || observed > decision) || acquired !== null && (acquired >= kickoff || acquired > decision)) add('POST_KICKOFF_OR_FUTURE_INFORMATION', 'INVALID_MARKET');
  if (observed !== null && acquired !== null && observed > acquired) add('ACQUISITION_PRECEDES_PROVIDER_OBSERVATION', 'PROVENANCE_INCOMPLETE');
  if (decision !== null && observed !== null && num(policy?.maxAgeSeconds) && decision - observed > policy.maxAgeSeconds * 1000) add('QUOTE_STALE_AT_DECISION', 'STALE_AT_DECISION');
  let body = null;
  if (!str(rawBody) || !hex(record?.payloadHash) || hash(rawBody) !== record.payloadHash || !str(record?.sourceRef)) add('RAW_SOURCE_UNVERIFIED', 'PROVENANCE_INCOMPLETE');
  else { try { body = JSON.parse(rawBody); if (!body || Array.isArray(body) || typeof body !== 'object') { body=null; add('RAW_SOURCE_NOT_OBJECT','PROVENANCE_INCOMPLETE'); } } catch { add('RAW_SOURCE_NOT_JSON', 'PROVENANCE_INCOMPLETE'); } }
  const mappingOK = mapping?.verified === true && str(mapping.provenanceRef) && mapping.source === record?.source && timestamp(mapping.availableAt) !== null && timestamp(mapping.availableAt) <= decision && mapping.clockSemantics === 'PROVIDER_ORIGINAL' && mapping.signConvention === record?.signConvention && ['SELECTED_TEAM_SIGNED','HOME_TEAM_SIGNED'].includes(mapping.signConvention);
  if (!mappingOK) add('UNVERIFIED_SCHEMA_OR_SPREAD_CONVENTION', 'PROVENANCE_INCOMPLETE');
  if (body && mappingOK) {
    const bindings = ['providerEventId','sport','league','side','market','period','book','price'];
    for (const key of bindings) if (atPath(body, mapping.fields?.[key]) !== record[key]) add('RAW_FIELD_MISMATCH:' + key, 'PROVENANCE_INCOMPLETE');
    for (const [key,value] of [['homeProviderId',event.homeProviderId],['awayProviderId',event.awayProviderId],['selectedProviderTeamId',record.side === 'HOME' ? event.homeProviderId : event.awayProviderId]]) if (atPath(body,mapping.fields?.[key]) !== value) add('RAW_TEAM_ID_MISMATCH:'+key,'UNMATCHED_EVENT');
    if (timestamp(atPath(body, mapping.fields?.observedAt)) !== observed || observed === null) add('PROVIDER_CLOCK_NOT_BOUND_TO_RAW', 'PROVENANCE_INCOMPLETE');
    const rawLine = atPath(body, mapping.fields?.line), selectedLine = mapping.signConvention === 'HOME_TEAM_SIGNED' && record.side === 'AWAY' ? -rawLine : rawLine;
    if (!num(rawLine) || selectedLine !== record.line) add('SPREAD_SIGN_OR_RAW_LINE_CONFLICT', 'INVALID_MARKET');
  }
  let descriptive = null;
  try { descriptive = record ? clone(record) : null; } catch { add('NON_JSON_SOURCE_RECORD', 'INVALID_MARKET'); }
  const classifications = [...new Set(reasons.map(r => r.classification))];
  const classification = ['UNMATCHED_EVENT','INVALID_MARKET','PROVENANCE_INCOMPLETE','STALE_AT_DECISION'].find(c => classifications.includes(c)) || 'PIT_VERIFIED';
  return freeze({ contract: CONTRACT, authority: AUTHORITY, observationId: record?.observationId ?? null, classification,
    input:descriptive ? {record:descriptive,context:{event:event ? clone(event):null,decisionAt:decisionAt ?? null,policy:policy ? clone(policy):null,rawBody:rawBody ?? null,mapping:mapping ? clone(mapping):null}} : null,
    descriptive, reasons, quote: reasons.length ? null : {
      eventId: event.id, sport: event.sport, league: event.league, homeId: event.homeId, awayId: event.awayId,
      selectedTeamId: record.selectedTeamId, side: record.side, market: record.market, period: record.period,
      line: record.line, price: record.price, book: record.book, source: record.source,
      observedAt: record.observedAt, acquiredAt: record.acquiredAt, availableAt: record.acquiredAt,
      provenanceRef: record.sourceRef, payloadHash: record.payloadHash, mappingRef: mapping.provenanceRef,
      decisionAt, kickoff: event.kickoff, policy: clone(policy), pitVerified: true } });
}

export function adaptPopulation(records, contexts) {
  const results = records.map((r, i) => adaptObservation(r, contexts[i]));
  const groups = new Map();
  records.forEach((r, i) => {
    const keys = [`id:${r.source}:${r.observationId}`];
    if (timestamp(r.observedAt) !== null) keys.push(canonicalJson([r.source,r.eventId,r.book,r.market,r.period,r.side,timestamp(r.observedAt)]));
    for (const k of keys) { const indexes = groups.get(k) || []; indexes.push(i); groups.set(k, indexes); }
  });
  const duplicate = new Set([...groups.values()].filter(a => a.length > 1).flat());
  return results.map((r, i) => {
    if(!duplicate.has(i)) return r;
    // Retain the conflicting source pair, not an unbounded copy of the full slate.
    const other=[...groups.values()].find(a=>a.length>1 && a.includes(i)).find(j=>j!==i);
    return freeze({ ...r, input:{...r.input,population:{records:clone([records[i],records[other]]),contexts:clone([contexts[i],contexts[other]])}},quote:null,classification:'INVALID_MARKET',reasons:[...r.reasons,{code:'DUPLICATE_OR_CONFLICTING_OBSERVATION',classification:'INVALID_MARKET'}] });
  });
}

export function reproduceAdapter(input) {
  if(input?.population) return adaptPopulation(input.population.records,input.population.contexts)[0];
  return adaptObservation(input?.record,input?.context);
}

export function movement(results) {
  const unavailable = reason => ({ status: 'UNAVAILABLE', reason, points: null, reverseLineMovement: null, publicDisagreement: null, authority: AUTHORITY });
  try { if(results.some(r=>!r.input || canonicalJson(reproduceAdapter(r.input)) !== canonicalJson(r))) return unavailable('CHANGED_ADAPTER_RESULT'); } catch { return unavailable('CHANGED_ADAPTER_RESULT'); }
  if (results.length < 2 || results.some(r => r.classification !== 'PIT_VERIFIED' || !r.quote)) return unavailable('INSUFFICIENT_VERIFIED_SOURCE_CLOCKS');
  const quotes = results.map(r => r.quote), key = q => canonicalJson([q.eventId,q.book,q.market,q.period,q.side,q.selectedTeamId]);
  if (quotes.some(q => key(q) !== key(quotes[0]))) return unavailable('CROSS_MARKET_OR_BOOK_SERIES');
  quotes.sort((a,b) => timestamp(a.observedAt) - timestamp(b.observedAt));
  if (new Set(quotes.map(q => timestamp(q.observedAt))).size !== quotes.length) return unavailable('DUPLICATE_SOURCE_CLOCK');
  return { status: 'VERIFIED_RESEARCH_SERIES', points: quotes.map((q,i) => ({ observedAt:q.observedAt, availableAt:q.availableAt, line:q.line, price:q.price,
    lineChange:i ? q.line - quotes[i-1].line : null, priceChange:i ? q.price - quotes[i-1].price : null })), reverseLineMovement:null, publicDisagreement:null,
    diagnostics:['AUTHENTICATED_PUBLIC_DENOMINATOR_UNAVAILABLE'], authority:AUTHORITY };
}

export function registerProtocol(spec, recordedAt = new Date().toISOString()) {
  const start = timestamp(spec?.holdout?.startAt), end = timestamp(spec?.holdout?.endAt), locked = timestamp(recordedAt);
  if (locked === null || start === null || end === null || locked >= start || start >= end || spec.holdout.unseen !== true || !str(spec.holdout.provenanceRef)) throw new Error('HOLDOUT_NOT_UNSEEN_FUTURE');
  if (!Array.isArray(spec.eventIds) || !spec.eventIds.length || spec.eventIds.some(id => !str(id)) || new Set(spec.eventIds).size !== spec.eventIds.length || !str(spec.populationRef)) throw new Error('INCOMPLETE_COHORT_MANIFEST');
  if(!Array.isArray(spec.population) || spec.population.length !== spec.eventIds.length || new Set(spec.population.map(s=>s.eventId)).size !== spec.population.length || spec.population.some(s=>!spec.eventIds.includes(s.eventId) || !['HOME','AWAY'].includes(s.side) || !['NFL','CFB'].includes(s.sport) || !str(s.homeId) || !str(s.awayId) || s.homeId===s.awayId || timestamp(s.decisionAt) === null || timestamp(s.kickoff) === null || timestamp(s.decisionAt)<start || timestamp(s.decisionAt)>=end || timestamp(s.decisionAt)>=timestamp(s.kickoff))) throw new Error('INVALID_REGISTERED_EVENT_SLOTS');
  if (canonicalJson([...spec.patterns].sort()) !== canonicalJson([...PATTERNS].sort()) || spec.registryVersion !== REGISTRY_VERSION) throw new Error('REGISTRY_CONFLICT');
  if (canonicalJson(spec.sports) !== canonicalJson(['NFL','CFB']) || spec.market !== 'FULL_GAME_SPREAD' || spec.period !== 'FULL_GAME' || spec.selectionRule !== 'ONE_REGISTERED_SIDE_PER_EVENT') throw new Error('UNSUPPORTED_PROTOCOL_SCOPE');
  if (!Number.isSafeInteger(spec.minSample) || spec.minSample < 30 || !num(spec.alpha) || spec.alpha<=0 || spec.alpha>=1 || !str(spec.statisticalPlanRef) || spec.correction !== 'BONFERRONI_FULL_REGISTRY' || spec.pushTreatment !== 'SEPARATE_RETURN_STAKE' || spec.stoppingRule !== 'FIXED_END_NO_EARLY_STOP') throw new Error('INVALID_STATISTICAL_PLAN');
  for (const key of ['decisionSchedule','inclusionRules','exclusionRules','predictiveMetrics','economicMetrics','incumbentComparison','concentrationChecks','uncertaintyMethod']) if (!str(spec[key])) throw new Error('MISSING_PROTOCOL_FIELD:' + key);
  if (!num(spec.maxCaptureLagSeconds) || spec.maxCaptureLagSeconds < 0 || !spec.freshnessPolicies || !Object.keys(spec.freshnessPolicies).length) throw new Error('MISSING_FRESHNESS_CONTRACT');
  for (const [source,p] of Object.entries(spec.freshnessPolicies)) if (p.source !== source || !num(p.maxAgeSeconds) || p.maxAgeSeconds < 0 || !str(p.version) || !str(p.provenanceRef)) throw new Error('INVALID_FRESHNESS_CONTRACT');
  return seal('PROTOCOL', { ...clone(spec), recordedAt, registryVersion: REGISTRY_VERSION });
}

export function candidateSnapshot({ game, adapted, protocol, codeSha }, recordedAt = new Date().toISOString()) {
  if (!verifySeal(protocol) || protocol.kind !== 'PROTOCOL' || !/^[a-f0-9]{40}$/.test(codeSha || '')) throw new Error('INVALID_PROTOCOL_OR_CODE_SHA');
  assertAuthority(game);
  const spec = protocol.payload;
  if (!spec.eventIds.includes(game.eventId) || timestamp(game.decisionAt) === null || timestamp(game.decisionAt) < timestamp(spec.holdout.startAt) || timestamp(game.decisionAt) >= timestamp(spec.holdout.endAt)) throw new Error('OUTSIDE_REGISTERED_POPULATION');
  const q = adapted?.quote;
  const slot=spec.population.find(s=>s.eventId===game.eventId);
  if(!slot || slot.side !== game.side || slot.sport !== game.sport || timestamp(slot.decisionAt) !== timestamp(game.decisionAt) || timestamp(slot.kickoff) !== timestamp(game.kickoff) || game.identity?.verified !== true || !str(game.identity.provenanceRef) || slot.homeId !== game.identity.homeId || slot.awayId !== game.identity.awayId) throw new Error('REGISTERED_IDENTITY_SIDE_OR_DECISION_MISMATCH');
  if(!adapted?.input) throw new Error('MISSING_ADAPTER_INPUT');
  const reproduced=reproduceAdapter(adapted.input);
  if(canonicalJson(reproduced) !== canonicalJson(adapted)) throw new Error('CHANGED_ADAPTER_RESULT');
  if(q && (adapted.classification !== 'PIT_VERIFIED' || adapted.reasons?.length !== 0)) throw new Error('UNVERIFIED_ADAPTER_RESULT');
  if (q && (q.eventId !== game.eventId || q.side !== game.side || q.sport !== game.sport || q.homeId !== game.identity.homeId || q.awayId !== game.identity.awayId || timestamp(q.decisionAt) !== timestamp(game.decisionAt) || timestamp(q.kickoff) !== timestamp(game.kickoff) || canonicalJson(q.policy) !== canonicalJson(spec.freshnessPolicies[q.source]))) throw new Error('QUOTE_PROTOCOL_OR_GAME_MISMATCH');
  const packet = scanGame({ ...game, quote:q ?? null }, { maxQuoteAgeSeconds:q?.policy.maxAgeSeconds });
  const saved = timestamp(recordedAt), decision = timestamp(game.decisionAt), kickoff = timestamp(game.kickoff);
  if (saved === null || decision === null || saved < decision) throw new Error('INVALID_SNAPSHOT_CLOCK');
  const classification = saved < kickoff && saved - decision <= spec.maxCaptureLagSeconds * 1000 ? 'PROSPECTIVE_SHADOW' : 'RETROSPECTIVE_RECONSTRUCTION';
  return seal('CANDIDATE', { registryVersion:REGISTRY_VERSION, protocol:clone(protocol),protocolHash:protocol.sha256,adapterInput:clone(adapted.input),codeSha, game:clone(game),
    recordedAt, classification, packet, adapterDiagnostics:adapted?.reasons ?? [], quote:q ?? null,
    freshness:q ? { valid:packet.quote !== null, maxAgeSeconds:q.policy.maxAgeSeconds } : null,
    logicalKey:hash(canonicalJson([protocol.sha256,game.eventId,game.side,game.decisionAt])), outcomeLink:null, gradeStatus:'PENDING' });
}

export function researchGrade(candidate, outcome, { oppositeQuote = null, probabilityMass = null, incumbentMass = null, close = null } = {}) {
  if (!verifySeal(candidate) || candidate.kind !== 'CANDIDATE') throw new Error('INVALID_CANDIDATE_HASH');
  const p=candidate.payload, q=p.quote, game=p.game;
  const evaluation={oppositeQuote,probabilityMass,incumbentMass,close};
  const pending = reason => seal('GRADE', { candidate:clone(candidate),candidateHash:candidate.sha256, logicalKey:candidate.sha256, outcome:outcome ? clone(outcome):null,evaluation:clone(evaluation),status:'PENDING', reason, result:null, simulatedProfitUnits:null, expectedValueUnits:null, clv:null, brier:null, logLoss:null, incrementalBrier:null });
  if (!q || p.packet.quote === null) return pending('ENTRY_MARKET_UNAVAILABLE');
  if (!outcome || outcome.eventId !== game.eventId || outcome.status !== 'FINAL' || outcome.verified !== true || !str(outcome.source) || !str(outcome.provenanceRef) || timestamp(outcome.completedAt) === null || timestamp(outcome.completedAt) <= timestamp(game.kickoff) || timestamp(outcome.observedAt) === null || timestamp(outcome.observedAt) < timestamp(outcome.completedAt)) return pending('FINAL_OUTCOME_UNVERIFIED');
  const result=gradeSpread({side:game.side,line:q.line,homeScore:outcome.homeScore,awayScore:outcome.awayScore});
  if (!result) return pending('INVALID_FINAL_SCORES');
  const validMass=m => m && m.decisionAt === game.decisionAt && (Number.isInteger(q.line) || m.push === 0);
  const mass=validMass(probabilityMass) ? probabilityMass : null;
  let opposite=null;
  try { if(oppositeQuote?.input && canonicalJson(reproduceAdapter(oppositeQuote.input)) === canonicalJson(oppositeQuote)) opposite=oppositeQuote.quote; } catch { /* Unavailable, never substitute an asserted PIT flag. */ }
  const econ=economics(q,mass,opposite,{decisionAt:game.decisionAt,maxQuoteAgeSeconds:q.policy.maxAgeSeconds});
  const inc=economics(q,validMass(incumbentMass) ? incumbentMass : null,null,{decisionAt:game.decisionAt,maxQuoteAgeSeconds:q.policy.maxAgeSeconds});
  const lossFor=m => result.ats !== 'PUSH' && m && m.win+m.loss > 0 ? binaryCalibrationLosses(m.win/(m.win+m.loss),result.ats === 'WIN') : {brier:null,logLoss:null};
  const losses=lossFor(econ.expectedValueUnits !== null ? mass:null), incLoss=lossFor(inc.expectedValueUnits !== null ? incumbentMass:null);
  // CLV is intentionally unavailable without a verified same-book, same-line paired
  // closing artifact and terminal-quote attestation. This phase does not invent one.
  return seal('GRADE', { candidate:clone(candidate),candidateHash:candidate.sha256,logicalKey:candidate.sha256,evaluation:clone(evaluation),status:'RESEARCH_GRADED',
    economicBasis:p.classification === 'PROSPECTIVE_SHADOW' ? 'PROSPECTIVE_SIMULATED' : 'RETROSPECTIVE_SIMULATED',
    outcome:clone(outcome),result:result.ats,straightUp:result.straightUp,entry:clone(q),
    simulatedProfitUnits:profitUnitsFromAmerican(q.price,result.ats,1),stakeUnits:1,
    conditionalBreakeven:econ.conditionalBreakeven,noVigBaseline:econ.noVigBaseline,expectedValueUnits:econ.expectedValueUnits,
    clv:null,clvReason:close ? 'VERIFIED_CLOSING_CONTRACT_NOT_IMPLEMENTED' : 'NO_MATCHED_CLOSING_ARTIFACT',
    brier:losses.brier,logLoss:losses.logLoss,incrementalBrier:losses.brier !== null && incLoss.brier !== null ? incLoss.brier-losses.brier:null,
    probabilityMass:mass ? clone(mass):null,incumbentMass:incLoss.brier !== null ? clone(incumbentMass):null,
    limitations:['one-unit-simulation','no-executed-wagers','transaction-costs-not-deducted','independent-calibration-unproven'] });
}

export function summarizeGrades(protocol,candidates,grades) {
  if(!verifySeal(protocol) || protocol.kind !== 'PROTOCOL') throw new Error('INVALID_PROTOCOL');
  if(candidates.some(c=>!verifySeal(c) || c.kind !== 'CANDIDATE' || c.payload.protocolHash !== protocol.sha256)) throw new Error('INVALID_CANDIDATE_MANIFEST');
  if(new Set(candidates.map(c=>c.payload.game.eventId)).size !== candidates.length) throw new Error('DUPLICATE_EVENT_UNIT');
  const expected=protocol.payload.eventIds;
  if(candidates.length !== expected.length || candidates.some(c=>!expected.includes(c.payload.game.eventId))) return {status:'INCOMPLETE_COHORT',pending:expected.length-candidates.length,profitUnits:null,drawdown:null,authority:AUTHORITY};
  if (grades.some(g => !verifySeal(g) || g.kind !== 'GRADE')) throw new Error('INVALID_GRADE_ARTIFACT');
  if (new Set(grades.map(g=>g.payload.candidateHash)).size !== grades.length) throw new Error('DUPLICATE_GRADE_UNIT');
  if(grades.length !== candidates.length || candidates.some(c=>!grades.some(g=>g.payload.candidateHash === c.sha256))) return {status:'INCOMPLETE_COHORT',pending:candidates.length-grades.length,profitUnits:null,drawdown:null,authority:AUTHORITY};
  const pending=grades.filter(g=>g.payload.status !== 'RESEARCH_GRADED').length;
  if (pending) return { status:'INCOMPLETE_COHORT',pending,profitUnits:null,drawdown:null,authority:AUTHORITY };
  const ordered=grades.map(g=>g.payload).sort((a,b)=>timestamp(a.outcome.observedAt)-timestamp(b.outcome.observedAt)||a.candidateHash.localeCompare(b.candidateHash));
  const bases=[...new Set(ordered.map(g=>g.economicBasis))];
  if (bases.length > 1) throw new Error('MIXED_ECONOMIC_BASES');
  return {status:'RESEARCH_SIMULATION',economicBasis:bases[0] ?? null,events:ordered.length,
    wins:ordered.filter(g=>g.result==='WIN').length,losses:ordered.filter(g=>g.result==='LOSS').length,pushes:ordered.filter(g=>g.result==='PUSH').length,
    profitUnits:ordered.reduce((s,g)=>s+g.simulatedProfitUnits,0),drawdown:maximumDrawdown(ordered.map(g=>g.simulatedProfitUnits)),
    realizedProfit:null,clv:null,qualified:false,authority:AUTHORITY};
}
