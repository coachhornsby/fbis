import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActionMispriceRows} from '../functions/lib/actionMarketIntelligence.js';
import {onRequestGet as misprices} from '../functions/api/misprices.js';
import {onRequestGet as tennisHistory,currentTennisQuotes} from '../functions/api/tennis-v2-snapshot.js';
import {researchPacketTemporalView} from '../functions/lib/researchPacketTemporalView.js';
import {normalizeTennisMarketQuotes} from '../functions/lib/tennisMarketV2.js';
import {listPublishedProjections} from '../functions/lib/publishedProjectionStore.js';
const now=Date.parse('2026-10-08T12:00:00Z');
const at=age=>new Date(now-age*1000).toISOString();
const fixture={sport:'nfl',eventId:'event',projMargin:7,consensus:{spreadHome:-3,spreadHomeOdds:-110},now};
for(const [label,age,kind] of [['fresh',60,'CURRENT_RESEARCH'],['current boundary',600,'CURRENT_RESEARCH'],['historical',601,'HISTORICAL_RESEARCH'],['research boundary',21600,'HISTORICAL_RESEARCH']])test(`misprices ${label} retains explicit use contract`,()=>{
 const rows=buildActionMispriceRows({...fixture,collectedAt:at(age),marketTimestamp:at(age)});
 assert.equal(rows.length,1);assert.equal(rows[0].temporalUse,kind);
 assert.equal(rows[0].currentMarketComparisonAvailable,age<=600);
 assert.equal(rows[0].canQualify,false);assert.equal(rows[0].canAuthorizeWager,false);
 assert.equal(rows[0].marketLine,-3);assert.equal(rows[0].expectedValue,null);
});
for(const [label,changes] of [['missing acquisition',{}],['missing despite source',{marketTimestamp:at(60)}],['malformed acquisition',{collectedAt:'bad'}],['future capture',{collectedAt:at(-1)}],['stale research',{collectedAt:at(21601)}],['malformed source',{collectedAt:at(60),marketTimestamp:'bad'}],['future source',{collectedAt:at(0),marketTimestamp:at(-1)}],['source after capture',{collectedAt:at(60),marketTimestamp:at(30)}]])test(`misprices rejects ${label} before calculating or ranking`,()=>assert.deepEqual(buildActionMispriceRows({...fixture,...changes}),[]));
test('timezone-normalized evidence remains accepted and no line is fabricated',()=>{
 const r=buildActionMispriceRows({...fixture,collectedAt:'2026-10-08 12:00:00',marketTimestamp:'2026-10-08T07:00:00-05:00',consensus:{}})[0];
 assert.equal(r.temporalUse,'CURRENT_RESEARCH');assert.equal(r.marketLine,null);assert.equal(r.disagreementUnits,null);
});
test('stored snapshot fallback cannot masquerade as a current comparison',async()=>{
 const original={id:'stored',sport:'nfl',state:'AUTHORIZED',can_show_ev:1,market_timestamp:at(0),market_line:-3,expected_value:1};
 const DB={prepare(sql){return {bind(){return this},async all(){return {results:sql.includes('canonical_misprice_snapshots')?[original]:[]}}}}};
 const payload=await (await misprices({request:new Request('https://test/api/misprices'),env:{DB}})).json();
 assert.equal(payload.misprices.some(r=>r.id==='stored'),false);
 assert.equal(payload.historicalSnapshots[0].currentUse,false);
 assert.equal(payload.historicalSnapshots[0].provenanceStatus,'UNVERIFIED_SOURCE_AND_ACQUISITION');
 assert.deepEqual(payload.historicalSnapshots[0].evidence,original);
});
test('saved packet JSON reload drops stale derived ACTION, preserves independent execution and immutable original',()=>{
 const independent={book:'Heritage',spread:-2.5};
 const saved={generatedAt:at(0),games:[{actionIntel:{collectedAt:at(601),consensus:{spreadHome:-3}},nflWagerDecision:{wagerIntelligence:{current:{spread:-3},edgeTrajectory:{spreadCurrent:2}},executionMarket:independent,independentProjection:{margin:7},confidenceScore:80,candidates:[{americanPrice:-110,probability:.6,expectedValuePerUnitRisk:.145,marketIntelligence:{confirmation:"CONFIRMS"},confidenceScore:80}],bestWager:{marketIntelligence:{confirmation:"CONFIRMS"},confidenceScore:80,canAuthorizeWager:false}}}]};
 const serialized=JSON.stringify(saved);
 const view=researchPacketTemporalView(JSON.parse(serialized),{now});
 assert.equal(view.currentUse,false);assert.equal(view.games[0].actionIntel,null);assert.equal(view.games[0].nflWagerDecision.wagerIntelligence,null);
 assert.deepEqual(view.games[0].nflWagerDecision.executionMarket,independent);
 assert.equal(view.games[0].nflWagerDecision.candidates[0].marketIntelligence,null);
 assert.equal(view.games[0].nflWagerDecision.candidates[0].confidenceScore,null);
 assert.equal(view.games[0].nflWagerDecision.candidates[0].probability,.6);
 assert.equal(view.games[0].nflWagerDecision.candidates[0].expectedValuePerUnitRisk,.145);
 assert.equal(view.games[0].nflWagerDecision.bestWager.marketIntelligence,null);
 assert.equal(view.games[0].nflWagerDecision.bestWager.canAuthorizeWager,false);
 assert.deepEqual(view.games[0].nflWagerDecision.independentProjection,{margin:7});
 assert.equal(JSON.stringify(saved),serialized);
 const rawless=researchPacketTemporalView({games:[{nflWagerDecision:saved.games[0].nflWagerDecision}]},{now});
 assert.equal(rawless.games[0].nflWagerDecision.wagerIntelligence,null);
});
test('fresh packet retains ACTION comparison but remains a historical export',()=>{
 const intelligence={current:{spread:-3}};
 const view=researchPacketTemporalView({games:[{actionIntel:{collectedAt:at(60),consensus:{spreadHome:-3}},nflWagerDecision:{wagerIntelligence:{current:{spread:99}},independentProjection:{margin:7,total:45}}}]},{now});
 assert.equal(view.games[0].nflWagerDecision.wagerIntelligence.current.spread,-3);assert.equal(view.currentUse,false);
});
test('Tennis saved ACTION quotes revalidate on reload; independent sportsbook untouched; timestamps preserved',()=>{
 const action={book:'pinnacle',source:'ACTION_APIFY',p1Price:-110,p2Price:-110,collectedAt:at(60),observedAt:at(60)};
 const owned={book:'Heritage',source:'HERITAGE',p1Price:-110,p2Price:-110};
 const normalized=normalizeTennisMarketQuotes(currentTennisQuotes([action,owned],now));
 assert.equal(normalized[0].collectedAt,action.collectedAt);assert.equal(normalized[0].observedAt,action.observedAt);
 assert.deepEqual(currentTennisQuotes(JSON.parse(JSON.stringify([action,owned])),now+601000),[owned]);
});
test('Tennis saved history is explicitly historical and preserves raw derived fields',async()=>{
 const row={id:'old',market_v2_p1:.64,action_json:'{"stale":true}',decision_timestamp:at(10000)};
 const DB={prepare(){return {bind(){return this},async all(){return {results:[row]}}}}};
 const p=await (await tennisHistory({request:new Request('https://test/api/tennis-v2-snapshot'),env:{DB}})).json();
 assert.equal(p.decisions[0].currentUse,false);assert.equal(p.decisions[0].temporalUse,'HISTORICAL_RESEARCH');assert.equal(p.decisions[0].market_v2_p1,.64);assert.equal(p.decisions[0].action_json,row.action_json);
});
test('published immutable packets stay historical on reload; original payload/hash unchanged',async()=>{
 const packet={marketSnapshot:{book:'Heritage',total:45},independentProjection:{margin:7}};
 const raw=JSON.stringify(packet);const DB={prepare(){return {bind(){return this},async all(){return {results:[{payload_json:raw,payload_hash:'original',published_at:at(0)}]}}}}};
 const [row]=await listPublishedProjections({DB});assert.equal(row.currentUse,false);assert.equal(row.temporalUse,'HISTORICAL_PUBLICATION');assert.deepEqual(row.projection,packet);assert.equal(row.payloadHash,'original');
});
