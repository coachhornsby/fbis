import test from 'node:test';import assert from 'node:assert/strict';
import {captureTorvikRecovery,torvikRecoveryUrls,parseRecoveryFactors,torvikRecoveryComparison} from '../scripts/lib/torvikRecovery.mjs';
const response=(body,status=200,type='text/csv')=>new Response(body,{status,headers:{'content-type':type}});
test('2026–27 uses ending-year2027 filenames',()=>assert.deepEqual(torvikRecoveryUrls(2027),['https://barttorvik.com/2027_team_results.csv','https://barttorvik.com/2027_fffinal.csv']));
test('off means no fetch or reservation',async()=>{const no=()=>{throw Error('called')};assert.equal((await captureTorvikRecovery({fetchFn:no,reserve:no})).state,'NOT_ADMITTED');});
test('budget required before any call',async()=>{await assert.rejects(captureTorvikRecovery({admitted:true}),/BUDGET_REQUIRED/);});
for(const status of [301,302,401,403,429,500])test(`stop on${status} without second request`,async()=>{let n=0,b=0;const r=await captureTorvikRecovery({admitted:true,reserve:()=>b++,fetchFn:async(u,o)=>{n++;assert.equal(o.redirect,'manual');return response('',status);}});assert.equal(r.ok,false);assert.equal(n,1);assert.equal(b,1);});
test('HTML blocks before factors',async()=>{const r=await captureTorvikRecovery({admitted:true,reserve:()=>{},fetchFn:async()=>response('<html>challenge</html>')});assert.equal(r.error,'TORVIK_HTML');});
test('unsupported content type blocks',async()=>{const r=await captureTorvikRecovery({admitted:true,reserve:()=>{},fetchFn:async()=>response('x',200,'application/json')});assert.equal(r.error,'TORVIK_NOT_CSV');});
test('budget denial happens before network',async()=>{let calls=0;const r=await captureTorvikRecovery({admitted:true,reserve:()=>{throw Error('budget')},fetchFn:async()=>calls++});assert.equal(calls,0);assert.equal(r.error,'budget');});
test('bad coverage cannot trigger second read',async()=>{let calls=0;const r=await captureTorvikRecovery({admitted:true,reserve:()=>{},fetchFn:async()=>{calls++;return response('team,adjoe,adjde,adjt\nDuke,120,90,70')}});assert.equal(calls,1);assert.equal(r.error,'TORVIK_RATINGS_COVERAGE_INVALID');});
test('invalid season fails before network',async()=>{await assert.rejects(captureTorvikRecovery({admitted:true,season:NaN,reserve:()=>{}}),/INVALID_ENDING_SEASON/);});
import {parseCsvLine} from '../functions/lib/torvikCbb.js';
import {listTeams} from '../functions/lib/teams.js';
import {createRecoverySourceBudget} from '../scripts/lib/recoveryEvidence.mjs';
const names=listTeams('cbb').slice(0,330).map(t=>t.school),q=s=>'"'+s.replaceAll('"','""')+'"';
const ratings='team,adjoe,adjde,adjt\n'+names.map(n=>`${q(n)},110,100,70`).join('\n');
const factors=['TeamName','eFG%','Rk','eFG% Def','Rk','FTR','Rk','FTR Def','Rk','OR%','Rk','DR%','Rk','TO%','Rk','TO% Def.','Rk','3P%','Rk','3pD%','Rk','2p%','Rk','2p%D','Rk'].join(',')+'\n'+names.map(n=>q(n)+','+Array.from({length:24},(_,i)=>i%2?'100':'50').join(',')).join('\n');
test('two successful budgeted CSVs yield private rows and honest retrieval receipts',async()=>{let n=0;const b=createRecoverySourceBudget({Torvik:2});const r=await captureTorvikRecovery({admitted:true,reserve:k=>b.reserve(k),now:()=>Date.parse('2026-11-08T12:00:00Z'),fetchFn:async()=>response(n++?factors:ratings)});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.rows.length,330);assert.equal(b.counts.Torvik,2);assert.equal(r.providerUpdatedAt,null);assert.equal(r.canAuthorizeWager,false);assert.equal(r.receipts[0].retrievedAt,'2026-11-08T12:00:00.000Z');assert.equal(r.receipts[0].sha256.length,64);assert.equal(r.rows[0].efgPct,.5);});
test('second-source refusal discards incomplete new snapshot without retry',async()=>{let n=0;const r=await captureTorvikRecovery({admitted:true,reserve:()=>{},fetchFn:async()=>n++?response('',403):response(ratings)});assert.equal(n,2);assert.equal(r.ok,false);assert.equal(r.error,'TORVIK_HTTP_403');assert.equal(r.rows,undefined);});
test('default recovery budget cannot admit Torvik',()=>{const b=createRecoverySourceBudget();assert.throws(()=>b.reserve('Torvik'),/NOT_ALLOWED/);});

test('four-factor schema rejects swapped headers',()=>assert.throws(()=>parseRecoveryFactors(factors.replace('eFG% Def','TO% Def.')),/SCHEMA_UNVERIFIED/));
test('four-factor percentages cannot exceed100 and small values stay percentages',()=>{const lines=factors.split('\n');for(const pos of [1,9,13]){const cells=lines[1].split(',');cells[pos]='101';assert.throws(()=>parseRecoveryFactors(lines[0]+'\n'+cells.join(',')),/SCALE_INVALID/);}const cells=lines[1].split(',');cells[1]='1.2';assert.equal(parseRecoveryFactors(lines[0]+'\n'+cells.join(','))[0].efgPct,.012);});

test('only matched scheduled pre-tip receipts attach comparison',async()=>{let n=0;const capture=await captureTorvikRecovery({admitted:true,reserve:()=>{},now:()=>Date.parse('2026-11-08T12:00Z'),fetchFn:async()=>response(n++?factors:ratings)});const ids=Object.keys(capture.index.byCanonicalId);const game={status:'scheduled',neutralSite:true,start:'2026-11-08T15:00Z',home:{canonicalId:ids[0]},away:{canonicalId:ids[1]}};assert.ok(torvikRecoveryComparison(game,capture,{now:Date.parse('2026-11-08T13:00Z')}));assert.equal(torvikRecoveryComparison({...game,start:'2026-11-08T12:00Z'},capture),null);assert.equal(torvikRecoveryComparison({...game,status:'live'},capture),null);assert.equal(torvikRecoveryComparison({...game,neutralSite:null},capture),null);assert.equal(torvikRecoveryComparison({...game,away:{canonicalId:'cbb-999999'}},capture),null);});

import {privateTorvikSummary,torvikComparisonFor} from '../functions/lib/privateTorvikSummary.js';
test('offline source capture to private comparison preserves computation time and rejects stale or started recomputation',async()=>{
 let n=0;const retrieved=Date.parse('2026-11-08T12:00Z'),computed=retrieved+3600000;
 const capture=await captureTorvikRecovery({admitted:true,reserve:()=>{},now:()=>retrieved,fetchFn:async()=>response(n++?factors:ratings)});
 const ids=Object.keys(capture.index.byCanonicalId),date='2026-11-08';
 const game={id:'123',sport:'cbb',date,status:'scheduled',neutralSite:false,start:'2026-11-08T16:00Z',home:{canonicalId:ids[0],espnId:ids[0].replace('cbb-','')},away:{canonicalId:ids[1],espnId:ids[1].replace('cbb-','')}};
 const comparison=torvikRecoveryComparison(game,capture,{now:computed});assert.ok(comparison);
 const packet={version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',season:2027,canAuthorizeWager:false,generatedAt:new Date(computed+1000).toISOString(),expiresAt:'2026-11-08T17:59:00Z',torvikProvenance:{season:2027,usage:'PRIVATE_COMPARISON_ONLY',providerUpdatedAt:null,receipts:capture.receipts},events:[{eventId:game.id,date,start:game.start,homeId:ids[0],awayId:ids[1],neutralSite:false,comparison}]};
 assert.ok(Date.parse(packet.generatedAt)>Date.parse(comparison.generatedAt));
 const view=privateTorvikSummary(packet,{date,now:computed+2000});assert.equal(torvikComparisonFor(game,view,computed+2000).comparison.generatedAt,new Date(computed).toISOString());assert.equal(n,2);
 for(const at of [retrieved-1,Date.parse(game.start),retrieved+7*3600000])assert.equal(torvikRecoveryComparison(game,capture,{now:at}),null);
 assert.equal(torvikRecoveryComparison({...game,start:'2026-11-09T16:00Z'},capture,{now:retrieved+6*3600000}),null);
});


// Structural fixture matches the observed 2027 header, not provider team values.
const extendedHeader=',ft%,rk,ft%D,rk,3P rate,rk,3P rate D,rk,arate,rk,arateD,rk';
const extendedFactors=factors.split('\n').map((line,i)=>i?line+','+Array.from({length:16},(_,j)=>j%2?'100':'50').join(','):line+extendedHeader).join('\n');
test('2027 extended bulk shape preserves known factors and ignores unlabelled extras',()=>{
 const core=parseRecoveryFactors(factors),current=parseRecoveryFactors(extendedFactors);
 assert.deepEqual(current,core);
 // Extra cells cannot silently become ratings, four factors, or weights.
 const lines=extendedFactors.split('\n'),cells=parseCsvLine(lines[1]);
 cells.splice(25,16,...Array.from({length:16},(_,i)=>'UNUSED_'+i));
 assert.deepEqual(parseRecoveryFactors(lines[0]+'\n'+cells.map(q).join(','))[0],core[0]);
});
test('extended bulk schema rejects renamed, reordered and unexpected-width inputs',()=>{
 for(const text of [extendedFactors.replace('ft%D','unknown'),extendedFactors.replace('arateD','arate'),extendedFactors.replace('eFG% Def','TO% Def.')])assert.throws(()=>parseRecoveryFactors(text),/SCHEMA_UNVERIFIED/);
 const [header,line]=extendedFactors.split('\n');
 for(const n of [25,37,40,42]){const cells=parseCsvLine(line);cells.length=n;assert.throws(()=>parseRecoveryFactors(header+'\n'+cells.map(x=>q(x||'0')).join(',')),/SCHEMA_UNVERIFIED/);}
});
test('extended 2027 factors complete the same two-request source capture',async()=>{
 let calls=0;const capture=await captureTorvikRecovery({admitted:true,reserve:()=>{},fetchFn:async()=>response(calls++?extendedFactors:ratings)});
 assert.equal(calls,2);assert.equal(capture.ok,true,capture.error);assert.equal(capture.rows.length,330);assert.equal(capture.rows[0].efgPct,.5);assert.equal(capture.providerUpdatedAt,null);assert.equal(capture.canAuthorizeWager,false);
});
