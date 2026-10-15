import {matchPolymarketUsEvent} from "./polymarketUs.js";
import {loadSoccerMarketFixtures} from "./soccerMarketFixtures.js";
import {normalizePinnoddsMarkets} from './pinnoddsMarkets.js';
import {persistNormalizedMarketBatch} from './marketObservationLedger.js';
import {loadVerifiedTennisCandidates} from './polymarketTennisIdentity.js';
const root='market-sources/pinnodds',valid=id=>/^[a-z0-9-]{1,180}$/i.test(id||''),batchSize=100;
async function source(env,snapshotId){
 if(!valid(snapshotId))throw Error('INVALID_SNAPSHOT_ID');
 const object=await env.ARCHIVE.get(`${root}/receipts/${snapshotId}.json`);if(!object)throw Error('PROVIDER_RECEIPT_NOT_FOUND');
 const receipt=await object.json();if(receipt.ok!==true)throw Error('PROVIDER_CAPTURE_INCOMPLETE');return receipt;
}
async function normalizeFromArchivedRaw(env,receipt,{snapshotId,fixtureAsOf=null,includeCompleted=false}={}){
 const object=await env.ARCHIVE.get(receipt.rawKey);if(!object)throw Error('RAW_SNAPSHOT_NOT_FOUND');
 const body=await object.json();let result={rows:[],reasons:{},inputEvents:0,normalizedRows:0,matchedRows:0};
 if(receipt.kind==='board'){
  const starts=body.events.map(e=>Date.parse(e.starts||'')).filter(Number.isFinite);
  const games=starts.length?(await env.DB.prepare(`SELECT id,sport,start,home_name,away_name,home_abbr,away_abbr FROM games WHERE julianday(start) BETWEEN julianday(?) AND julianday(?)`)
    .bind(new Date(Math.min(...starts)-7200000).toISOString(),new Date(Math.max(...starts)+7200000).toISOString()).all())?.results||[]:[];
  // Tennis is not in the generic games table. Verified independent fixtures are
  // display-only; snapshot source and raw acquisition times remain immutable.
  if(receipt.sportId===2){
   games.length=0;
   const asOf=fixtureAsOf||receipt.collectedAt;
   games.push(...await loadVerifiedTennisCandidates(env.DB,body.events.map(e=>e.starts),{asOf,includeCompleted}));
  }
  if(receipt.sportId===1)games.push(...(await loadSoccerMarketFixtures(env)).fixtures.filter(g=>!games.some(x=>String(x.id)===g.id)));
  let scopeDiagnostics={};
  if(receipt.sportId===1&&receipt.feed==='prematch'){
   const soccer=games.filter(g=>g.sport==='soccer');
   if(!soccer.length)throw Error('SOCCER_FIXTURE_DIRECTORY_UNAVAILABLE');
   const providerInputEvents=body.events.length;
   const selected=new Set(body.events.filter(e=>!e.special&&!e.special_category&&matchPolymarketUsEvent({startTime:e.starts,homeTeam:{name:e.home},awayTeam:{name:e.away}},soccer,'soccer').id).map(e=>String(e.event_id)));
   body.events=body.events.filter(e=>selected.has(String(e.event_id))||selected.has(String(e.parent_id)));
   scopeDiagnostics={ingestionScope:'VERIFIED_SOCCER_FIXTURES_ALL_MARKETS',providerInputEvents,selectedParentEvents:selected.size,excludedUnmatchedProviderEvents:providerInputEvents-body.events.length,unmatchedEvidence:'IMMUTABLE_RAW_ARCHIVE_RETAINED'};
  }
  result=normalizePinnoddsMarkets(body,{sportId:receipt.sportId,feed:receipt.feed,capturedAt:receipt.collectedAt,games,snapshotId,rawKey:receipt.rawKey});
  Object.assign(result,scopeDiagnostics);
  if(fixtureAsOf)for(const row of result.rows)Object.assign(row.raw,{postCaptureIdentityLink:true,identityLinkedAt:fixtureAsOf});
 }
 return result;
}

export async function preparePinnoddsSnapshot(env,{snapshotId,force=false,postCaptureFixtures=false}={}){
 const receipt=await source(env,snapshotId),normalizedKey=`${root}/normalized/${snapshotId}.json`;
 const prior=force?null:await env.ARCHIVE.get(normalizedKey);
 if(prior){const {rows,...result}=await prior.json();return{ok:true,...result};}
 // postCaptureFixtures: research-only rematch may use fixtures observed after the
 // paid capture clock. Never rewrites collectedAt / sourceObservedAt; never executable.
 const fixtureAsOf=postCaptureFixtures?new Date().toISOString():null;
 const result=await normalizeFromArchivedRaw(env,receipt,{snapshotId,fixtureAsOf,includeCompleted:postCaptureFixtures===true});
 const prepared={
  ...receipt,...result,batchSize,batches:Math.ceil(result.rows.length/batchSize),
  rematchedAt:force?new Date().toISOString():undefined,
  postCaptureFixtures:postCaptureFixtures===true,
  fixtureAsOf:fixtureAsOf||receipt.collectedAt,
  prospectiveEvidenceEligible:false,
  canAuthorizeWager:false,
 };
 await env.ARCHIVE.put(normalizedKey,JSON.stringify(prepared),{httpMetadata:{contentType:'application/json'}});
 const {rows,...publicResult}=prepared;return{ok:true,...publicResult};
}

/**
 * Re-normalize an already-archived PinnOdds raw snapshot with current identity
 * matchers. Does NOT call the paid provider API.
 *
 * Large boards must be rematched as prepare → consume batches → finalize so a
 * single Pages invocation never times out on thousands of inserts. Prior
 * unmatched D1 rows remain immutable; newly linked rows insert under a distinct
 * observation_key (eventId is part of the natural key).
 */
export async function rematchPinnoddsSnapshot(env,{snapshotId,phase='all',batchIndex,postCaptureFixtures=false}={}){
 if(phase==='prepare'||phase==='all'){
  const prepared=await preparePinnoddsSnapshot(env,{snapshotId,force:true,postCaptureFixtures});
  if(phase==='prepare'){
   return{ok:true,operation:'rematch',phase:'prepare',snapshotId,paidProviderCall:false,
    matchedRows:prepared.matchedRows||0,normalizedRows:prepared.normalizedRows||0,
    batches:prepared.batches||0,postCaptureFixtures:prepared.postCaptureFixtures===true,
    fixtureAsOf:prepared.fixtureAsOf||null,prospectiveEvidenceEligible:false,canAuthorizeWager:false};
  }
 }
 if(phase==='consume'){
  const consumed=await consumePinnoddsSnapshot(env,{snapshotId,batchIndex});
  return{ok:true,operation:'rematch',phase:'consume',paidProviderCall:false,...consumed};
 }
 if(phase==='finalize'||phase==='all'){
  if(phase==='all'){
   const prepared=await preparePinnoddsSnapshot(env,{snapshotId,force:false});
   const consumes=[];
   for(let i=0;i<(prepared.batches||0);i++)consumes.push(await consumePinnoddsSnapshot(env,{snapshotId,batchIndex:i}));
   const inserted=consumes.reduce((n,c)=>n+(Number(c.inserted)||0),0);
   return finalizePinnoddsRematch(env,{snapshotId,inserted,batches:consumes.length});
  }
  return finalizePinnoddsRematch(env,{snapshotId});
 }
 throw Error('INVALID_REMATCH_PHASE');
}

export async function finalizePinnoddsRematch(env,{snapshotId,inserted=null,batches=null}={}){
 if(!valid(snapshotId))throw Error('INVALID_SNAPSHOT_ID');
 const object=await env.ARCHIVE.get(`${root}/normalized/${snapshotId}.json`);
 if(!object)throw Error('SNAPSHOT_NOT_PREPARED');
 const prepared=await object.json();
 const counted=await env.DB.prepare(`SELECT COUNT(*) n FROM normalized_market_observations WHERE source='PinnOdds' AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.snapshotId')=?`).bind(snapshotId).first().catch(()=>({n:0}));
 const persistedRows=Number(counted?.n||0);
 const {rows,...receipt}=prepared;
 const status={...receipt,ok:true,persistedRows,reconciled:true,rematched:true,paidProviderCall:false,
  inserted:inserted==null?undefined:inserted,batches:batches==null?undefined:batches};
 await env.ARCHIVE.put(`${root}/status/${snapshotId}.json`,JSON.stringify(status));
 await env.ARCHIVE.put(`${root}/latest/${receipt.kind}-${receipt.sportId||'all'}-${receipt.feed||'all'}.json`,JSON.stringify(status));
 return{
  ok:true,
  operation:'rematch',
  phase:'finalize',
  snapshotId,
  paidProviderCall:false,
  matchedRows:receipt.matchedRows||0,
  normalizedRows:receipt.normalizedRows||0,
  inserted:status.inserted??null,
  batches:status.batches??(receipt.batches||0),
  persistedRows,
  reconciled:true,
  canAuthorizeWager:false,
 };
}
export async function consumePinnoddsSnapshot(env,{snapshotId,batchIndex}={}){
 if(!valid(snapshotId)||!Number.isSafeInteger(batchIndex)||batchIndex<0)throw Error('INVALID_BATCH_IDENTITY');
 const object=await env.ARCHIVE.get(`${root}/normalized/${snapshotId}.json`);if(!object)throw Error('SNAPSHOT_NOT_PREPARED');const prepared=await object.json();
 if(batchIndex>=prepared.batches)throw Error('BATCH_OUT_OF_RANGE');
 const rows=prepared.rows.slice(batchIndex*batchSize,(batchIndex+1)*batchSize),saved=await persistNormalizedMarketBatch(env.DB,rows,{snapshotType:'RESEARCH',collectedAt:prepared.collectedAt,modelProbability:null});
 return{ok:true,snapshotId,batchIndex,expectedRows:rows.length,inserted:saved.inserted,canAuthorizeWager:false};
}
export async function reconcilePinnoddsSnapshot(env,{snapshotId}={}){
 if(!valid(snapshotId))throw Error('INVALID_SNAPSHOT_ID');const object=await env.ARCHIVE.get(`${root}/normalized/${snapshotId}.json`);if(!object)throw Error('SNAPSHOT_NOT_PREPARED');const {rows,...receipt}=await object.json();
 const result=await env.DB.prepare(`SELECT COUNT(*) n FROM normalized_market_observations WHERE source='PinnOdds' AND json_valid(raw_payload_json) AND json_extract(raw_payload_json,'$.snapshotId')=?`).bind(snapshotId).first();
 const persistedRows=Number(result?.n||0),ok=persistedRows===receipt.normalizedRows,status={...receipt,ok,persistedRows,reconciled:ok};
 await env.ARCHIVE.put(`${root}/status/${snapshotId}.json`,JSON.stringify(status));
 if(ok)await env.ARCHIVE.put(`${root}/latest/${receipt.kind}-${receipt.sportId||'all'}-${receipt.feed||'all'}.json`,JSON.stringify(status));
 return status;
}
