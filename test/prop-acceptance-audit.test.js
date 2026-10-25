import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mapKalshiPlayerContract} from '../functions/lib/propProviderAdapters.js';
import {captureKalshiPlayerProps} from '../functions/lib/kalshiPlayerPropCollector.js';
import {assessPropModel,buildPropAcceptance} from '../functions/lib/propAcceptance.js';
import {freezePropForecasts,readFrozenPropForecast} from '../functions/lib/propForecastArchive.js';
import {independentPropRows,loadPropFixturesAndPlayers} from '../functions/lib/propResearchData.js';
import {relaySignedPages} from '../services/kalshi-public-collector/index.js';
import {persistPropEvidence} from '../functions/lib/propEvidenceStore.js';
import {loadPropResearchResult,summarizePropForecastErrors} from '../functions/lib/propResearchResults.js';
const now=new Date('2026-10-23T18:00:00Z');
const game={id:'mlb-1',sport:'mlb',away_abbr:'TB',away_name:'Tampa Bay Rays',home_abbr:'MIL',home_name:'Milwaukee Brewers',start:'2026-10-24T00:00:00Z'};
const players=[{sport:'mlb',player_id:'1',player_name:'Taylor Walls',team_key:'TB'},{sport:'mlb',player_id:'2',player_name:'Nick Martinez',team_key:'TB'}];
const raw=(series,name,verb,stat,trigger=3)=>({ticker:series+'-26OCT232000TBMIL-PLAYER-3',strike_type:'greater',floor_strike:trigger-.5,custom_strike:{baseball_player:'provider-id'},rules_primary:`If ${name} ${verb} ${trigger}+ ${stat} in the Tampa Bay vs Milwaukee professional baseball game originally scheduled for Oct 23, 2026 at 8:00 PM EDT, then the market resolves to Yes.`,rules_secondary:`If ${name} is scratched or not included in the starting lineup, the market will resolve to the fair market price.`});
test('current MLB rule formats map hits, home runs and pitcher outs to exact scheduled event',()=>{
 for(const [series,name,verb,stat]of [['KXMLBHIT','Taylor Walls','records','hits'],['KXMLBHR','Taylor Walls','records','home runs'],['KXMLBOUTS','Nick Martinez','has','outs recorded']]){
  const m=raw(series,name,verb,stat),context={seriesTicker:series,games:[game,{...game,id:'doubleheader',start:'2026-10-23T18:00Z'}],players,capturedAt:now.toISOString()};
  const p=mapKalshiPlayerContract(m,context);assert.equal(p.canonicalEventId,'mlb-1');assert.equal(p.line,2.5);assert.equal(p.dnpSettlement,'STARTER_PARTICIPATION_FAIR_PRICE');assert.equal(p.marketAvailable,false);
  assert.equal(mapKalshiPlayerContract({...m,rules_primary:m.rules_primary.replace('8:00 PM','9:00 PM')},context).rejected,true);
  assert.equal(mapKalshiPlayerContract({...m,rules_primary:m.rules_primary.replace(stat,'fantasy score')},context).reason,'STAT_DEFINITION_MISMATCH');
 }
});
function bucket(){const files=new Map();return {files,get:async k=>files.has(k)?{text:async()=>files.get(k),json:async()=>JSON.parse(files.get(k))}:null,put:async(k,v)=>files.set(k,String(v)),list:async({prefix})=>({objects:[...files.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false})};}
test('Kalshi collection follows cursor, deduplicates overlap, and retains partial truth at page bound',async()=>{
 const keys=await webcrypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
 const der=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey));
 const archive=bucket();archive.files.set('kalshi/public-shadow/v1/series-catalog.json',JSON.stringify({ok:true,records:[{ticker:'KXNFLRECYDS'}]}));
 const env={ARCHIVE:archive,KALSHI_API_KEY_ID:'test',KALSHI_PRIVATE_KEY_PEM1:'-----BEGIN PRIVATE KEY-----\n'+der.toString('base64')+'\n-----END PRIVATE KEY-----'};
 const seen=[];const fetchImpl=async url=>{const c=new URL(url).searchParams.get('cursor');seen.push(c);return Response.json(c?{markets:[{ticker:'KXNFLRECYDS-B'},{ticker:'KXNFLRECYDS-A'}],cursor:''}:{markets:[{ticker:'KXNFLRECYDS-A'}],cursor:'next-page'});};
 const result=await captureKalshiPlayerProps(env,{now,webCrypto:webcrypto,fetchImpl});assert.equal(result.ok,true);assert.deepEqual(seen,[null,'next-page']);
 const saved=JSON.parse(archive.files.get('player-props/kalshi/v1/KXNFLRECYDS.json'));assert.equal(saved.records.length,2);assert.equal(saved.paginationComplete,true);
 archive.files.delete('player-props/kalshi/v1/status.json');await captureKalshiPlayerProps(env,{now,webCrypto:webcrypto,fetchImpl,maxPages:1});
 assert.equal(JSON.parse(archive.files.get('player-props/kalshi/v1/KXNFLRECYDS.json')).paginationComplete,true); assert.equal(JSON.parse(archive.files.get('player-props/kalshi/v1/progress/KXNFLRECYDS.json')).cursor,'next-page');
});
const model={id:'m',sport:'nba',canonicalEventId:'g',canonicalPlayerId:'nba:espn:1',player_name:'Player',team:'CHI',opponent:'MIL',canonical_market:'points',period:'full_game',identityVerified:true,independent:true,fbis_projection:20,sigma:5,modelId:'MODEL',modelVersion:'v1',modelAsOf:'2026-10-23T15:00Z',start_time:'2026-10-24T00:00Z',availabilityStatus:'AVAILABLE',researchInputs:{projectedMinutes:30}};
test('acceptance distinguishes complete model metadata, missing history, duplicate models and missing source reads',()=>{
 assert.equal(assessPropModel(model,{now:+now}).displayReady,true);
 const report=buildPropAcceptance({models:[model],contracts:[],now:+now});assert.equal(report.counts.displayReady,1);assert.equal(report.counts.historyChecked,0);assert.equal(report.rows[0].history.state,'NOT_CHECKED');
 assert.equal(buildPropAcceptance({models:[model,model],now:+now}).counts.displayReady,0);
 assert.equal(buildPropAcceptance({models:[model],sourceDiagnostics:['STORE_FAILED'],now:+now}).status,'INCOMPLETE_SOURCE_COVERAGE');
 for(const change of [{modelAsOf:null},{modelAsOf:'2026-10-24T01:00Z'},{modelVersion:null},{independent:false},{availabilityStatus:'OUT'}])assert.equal(assessPropModel({...model,...change},{now:+now}).displayReady,false);
});
test('event snapshots freeze all 150 forecasts without the former first-32-row truncation; changed content fails integrity',async()=>{
 const archive=bucket(),env={ARCHIVE:archive};const rows=Array.from({length:150},(_,i)=>({...model,canonicalPlayerId:'nba:espn:'+i}));
 const r=await freezePropForecasts(env,rows,{now,webCrypto:webcrypto});assert.equal(r.captured,150);
 const args={sport:'nba',eventId:'g',playerId:'nba:espn:149',market:'points',eventStart:model.start_time,webCrypto:webcrypto};
 assert.equal((await readFrozenPropForecast(env,args)).projection,20);
 const key=r.receipts[0].key;archive.files.set(key,archive.files.get(key).replace('"projection":20','"projection":99'));assert.equal(await readFrozenPropForecast(env,args),null);
 assert.equal((await freezePropForecasts(env,[model],{now:new Date('2026-10-24T01:00Z'),webCrypto:webcrypto})).captured,0);
});
test('source feature timestamps and per-row model versions survive normalization; unavailable players are excluded',()=>{
 const g={id:'g',sport:'mlb',start:model.start_time,home:{abbr:'MIL'},away:{abbr:'TB'},playerProjectionStatus:{model:'GAME',version:'old'},playerProjectionRows:[{playerId:'1',playerName:'Player',team:'TB',market:'hits',fbisProjection:1,fbisSigma:.5,independent:true,modelVersion:'player-v2',stateAsOf:model.modelAsOf}]};
 const p=independentPropRows({games:[g]},{now:+now})[0];assert.equal(p.modelAsOf,model.modelAsOf);assert.equal(p.modelVersion,'player-v2');assert.equal(p.opponent,'MIL');
 assert.equal(independentPropRows({games:[{...g,playerProjectionRows:[{...g.playerProjectionRows[0],availabilityStatus:'OUT'}]}]},{now:+now}).length,0);
});
test('NBA combined means require matching input cutoffs and never invent joint uncertainty',()=>{
 const rows=['points','rebounds','assists'].map((market,i)=>({playerId:'1',playerName:'Player',team:'CHI',market,fbisProjection:[20,8,5][i],fbisSigma:4,independent:true,modelVersion:'v1',featureCutoff:model.modelAsOf}));
 const g={id:'g',sport:'nba',start:model.start_time,home:{abbr:'MIL'},away:{abbr:'CHI'},playerProjectionStatus:{model:'NBA',version:'v1'},playerProjectionRows:rows};
 const combined=independentPropRows({games:[g]},{now:+now}).find(r=>r.canonical_market==='points_rebounds');assert.equal(combined.fbis_projection,28);assert.equal(combined.sigma,null);
 const mixed=independentPropRows({games:[{...g,playerProjectionRows:rows.map(r=>r.market==='rebounds'?{...r,featureCutoff:'2026-10-22T15:00Z'}:r)}]},{now:+now});assert.equal(mixed.some(r=>r.canonical_market==='points_rebounds'),false);
});
test('all-sport fixture reads use the approved NBA owner, not a stale primary NBA copy',async()=>{
 const calls=[];const db=label=>({prepare(sql){return {bind(){return this},all:async()=>{calls.push({label,sql});return {results:[]};}};}});
 const receipt={sport:'nba',receipt_id:'receipt',status:'APPROVED'};const env={DB:db('primary'),NBA_DB:db('nba'),SPORT_DB_MODE_NBA:'sport',SPORT_DB_STRICT_NBA:'1',SPORT_DB_LEDGER_READY_NBA:'1',SPORT_CUTOVER_RECEIPT_NBA:'receipt',CORE_DB:{prepare(){return {bind(){return this},all:async()=>({results:[receipt]})}}}};
 const context=await loadPropFixturesAndPlayers(env,{sport:'all',start:'2026-10-23T05:00Z',end:'2026-10-24T05:00Z'});assert.equal(context.owners.find(o=>o.sport==='nba').binding,'NBA_DB');assert.ok(calls.some(c=>c.label==='nba'&&c.sql.includes('FROM games')));
});
test('intended forecast and grade scopes reach only the signed internal relay, with unrelated scopes still blocked',async()=>{
 const env={FBIS_KALSHI_RELAY_TOKEN:'t'.repeat(40)};let calls=0;
 for(const scope of ['prop-model-freeze','prop-grade-reconcile'])assert.equal((await relaySignedPages(env,{scope,fetchImpl:async(url,opts)=>{calls++;assert.equal(opts.method,'POST');return Response.json({ok:true});}})).ok,true);
 assert.equal((await relaySignedPages(env,{scope:'orders'})).code,'SIGNED_RELAY_SCOPE_NOT_ALLOWED');assert.equal(calls,2);
});
test('official results join only an immutable prospective forecast and produce error without invented profit',async()=>{
 const archive=bucket(),env={ARCHIVE:archive},forecast={...model,sport:'nhl',canonicalPlayerId:'nhl:nhl:1',canonical_market:'points'};
 await freezePropForecasts(env,[forecast],{now,webCrypto:webcrypto});
 const result={canonicalEventId:'g',canonicalPlayerId:'nhl:nhl:1',canonical_market:'points',period:'full_game',status:'FINAL',playerStatus:'PLAYED',official:true,actual:2,finalizedAt:'2026-10-24T03:00Z',source:'NHL_GAMECENTER_BOXSCORE',sourceRecordId:'official:1'};
 const saved=await persistPropEvidence(env,{schemaVersion:1,kind:'OFFICIAL_RESULT',canonicalEventId:'g',canonicalPlayerId:'nhl:nhl:1',observedAt:result.finalizedAt,sourceId:'official',result},{webCrypto:webcrypto});
 archive.files.set('player-props/official/v1/nhl-outcome-index.json',JSON.stringify({'g|nhl:nhl:1|points':{id:saved.id}}));
 const joined=await loadPropResearchResult(env,{sport:'nhl',eventId:'g',playerId:'nhl:nhl:1',market:'points',eventStart:forecast.start_time,now:Date.parse('2026-10-24T04:00Z')});
 assert.equal(joined.status,'OFFICIAL_RESULT_JOINED');assert.equal(joined.forecastError,18);assert.equal(joined.recordedWager,false);
 const cohort=summarizePropForecastErrors([{...joined,sport:'nhl',eventId:'g',playerId:'nhl:nhl:1',market:'points',eventStart:forecast.start_time}]);assert.equal(cohort.cohorts[0].n,1);assert.equal(cohort.profit,null);assert.equal(cohort.calibrationProbability,null);
 archive.files.delete([...archive.files.keys()].find(k=>k.startsWith('player-props/forecasts/')));
 assert.equal((await loadPropResearchResult(env,{sport:'nhl',eventId:'g',playerId:'nhl:nhl:1',market:'points',eventStart:forecast.start_time,now:Date.parse('2026-10-24T04:00Z')})).status,'FROZEN_PREGAME_FORECAST_MISSING');
});
