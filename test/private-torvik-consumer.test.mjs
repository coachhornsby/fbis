import test from 'node:test';import assert from 'node:assert/strict';
import {privateTorvikSummary,torvikComparisonFor} from '../functions/lib/privateTorvikSummary.js';
import {loadPrivateTorvik} from '../src/lib/privateTorvikRead.js';
import {readFileSync} from 'node:fs';
const now=Date.parse('2026-11-08T14:00:00Z'),date='2026-11-08';
function fixture(){return {version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',season:2027,canAuthorizeWager:false,generatedAt:'2026-11-08T12:00:00Z',expiresAt:'2026-11-08T18:00:00Z',rawInputs:'DO_NOT_EXPOSE',torvikProvenance:{season:2027,usage:'PRIVATE_COMPARISON_ONLY',providerUpdatedAt:null,receipts:['team_results','fffinal'].map(path=>({url:`https://barttorvik.com/2027_${path}.csv`,httpStatus:200,sha256:'a'.repeat(64),retrievedAt:'2026-11-08T12:01:00Z'}))},events:[{eventId:'123',date,start:'2026-11-08T17:00:00Z',homeId:'cbb-1',awayId:'cbb-2',neutralSite:false,comparison:{generatedAt:'2026-11-08T12:02:00Z',home:75,away:70,margin:5,total:145,comparisonOnly:true,canAuthorizeWager:false,raw:'DO_NOT_EXPOSE'}}]};}
const game={id:'123',sport:'cbb',date,start:'2026-11-08T17:00:00Z',home:{espnId:'1'},away:{espnId:'2'},neutralSite:false,status:'scheduled'};
test('private summary strictly whitelists comparison and provenance labels',()=>{const r=privateTorvikSummary(fixture(),{date,now});assert.equal(r.events[0].comparison.total,145);assert.equal(r.providerUpdatedAt,null);assert.ok(!JSON.stringify(r).includes('DO_NOT_EXPOSE'));assert.equal(r.torvikProvenance,undefined);assert.equal(r.canAuthorizeWager,false);});
for(const [name,mutate] of [['wrong season',p=>p.season=2026],['public packet',p=>p.visibility='PUBLIC'],['missing receipts',p=>p.torvikProvenance.receipts=[]],['wrong source',p=>p.torvikProvenance.receipts[0].url='https://example.com/x'],['fake hash',p=>p.torvikProvenance.receipts[0].sha256='z'.repeat(64)],['future retrieval',p=>p.torvikProvenance.receipts[0].retrievedAt='2026-11-09T12:00Z'],['after-tip',p=>p.events[0].start='2026-11-08T12:00Z'],['duplicate',p=>p.events.push(p.events[0])],['wrong date',p=>p.events[0].date='2026-11-09'],['bad scores',p=>p.events[0].comparison.total=999],['wager authority',p=>p.events[0].comparison.canAuthorizeWager=true]])test(name+' rejected',()=>{const p=fixture();mutate(p);assert.throws(()=>privateTorvikSummary(p,{date,now}));});
test('exact match only; expired and started remain explicitly historical',()=>{const p=privateTorvikSummary(fixture(),{date,now});assert.equal(torvikComparisonFor(game,p,now).expired,false);assert.equal(torvikComparisonFor(game,p,Date.parse('2026-11-08T19:00Z')).expired,true);assert.equal(torvikComparisonFor({...game,status:'live'},p,now).started,true);for(const changed of [{date:'2026-11-09'},{start:'2026-11-08T18:00Z'},{home:{espnId:'99'}},{neutralSite:true},{sport:'nba'}])assert.equal(torvikComparisonFor({...game,...changed},p,now),null);});
test('loader uses existing owner read only and no credentials in URL',async()=>{let calls=0;const packet=privateTorvikSummary(fixture(),{date,now});const p=await loadPrivateTorvik(date,{fetchFn:async(url,opts)=>{calls++;assert.equal(url,'/api/private/cbb/2026-11-08?view=torvik');assert.equal(opts.credentials,'same-origin');assert.equal(opts.cache,'no-store');assert.equal(opts.redirect,'error');assert.equal(opts.method,undefined);return new Response(JSON.stringify({state:'PRIVATE_TORVIK_COMPARISONS',date,packet}));}});assert.equal(calls,1);assert.equal(p.events.length,1);});
for(const status of [401,403,404,500])test('read refusal'+status+' never retries',async()=>{let calls=0;await assert.rejects(loadPrivateTorvik(date,{fetchFn:async()=>{calls++;return new Response('',{status});}}));assert.equal(calls,1);});
test('UI private read is click-triggered and never persists private data',()=>{const s=readFileSync(new URL('../src/PublicationApp.jsx',import.meta.url),'utf8');assert.ok(s.includes('onClick={showPrivateTorvik}'));assert.ok(s.includes('loadPrivateTorvik(date,{signal:controller.signal})'));assert.ok(s.includes('PrivateTorvikComparison game={g} packet={torvikPacket}'));assert.ok(!s.includes('localStorage'));const reader=readFileSync(new URL('../src/lib/privateTorvikRead.js',import.meta.url),'utf8');assert.ok(!reader.includes('setInterval'));assert.ok(!reader.includes('method:\'POST\''));});

import {onRequestGet} from '../deploy/board/functions/api/private/cbb/[date].js';
import {generateKeyPairSync,sign} from 'node:crypto';
test('private view refuses anonymous request without reading storage',async()=>{let reads=0;const r=await onRequestGet({request:new Request('https://example.com/api/private/cbb/'+date+'?view=torvik'),params:{date},env:{FBIS_PRIVATE_CBB:{get:async()=>{reads++;return null;}}}});assert.equal(r.status,401);assert.equal(reads,0);});
test('authenticated Torvik view reads one projection object, not markets, and returns no raw data',async()=>{
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048}),kid='local-test',domain='test.cloudflareaccess.com',seconds=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const input=encode({alg:'RS256',kid})+'.'+encode({iss:'https://'+domain,aud:['test-audience'],email:'owner@example.com',iat:seconds-10,exp:seconds+600});
 const token=input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
 const savedFetch=globalThis.fetch;let certs=0,reads=[];
 globalThis.fetch=async url=>{certs++;assert.equal(url,'https://'+domain+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid}]}));};
 try{const raw=JSON.stringify(fixture());const r=await onRequestGet({request:new Request('https://example.com/api/private/cbb/'+date+'?view=torvik',{headers:{Cookie:'CF_Authorization='+token}}),params:{date},env:{FBIS_ACCESS_TEAM_DOMAIN:domain,FBIS_ACCESS_AUDIENCES:'test-audience',FBIS_PRIVATE_OWNER_EMAIL:'owner@example.com',FBIS_PRIVATE_CBB:{get:async key=>{reads.push(key);return {size:raw.length,text:async()=>raw};}}}});assert.equal(r.status,200);assert.deepEqual(reads,['private/cbb/projections/'+date+'.json']);assert.equal(certs,1);assert.match(r.headers.get('cache-control'),/private, no-store/);const body=await r.text();assert.ok(!body.includes('DO_NOT_EXPOSE'));assert.ok(!body.includes('sha256'));assert.equal(JSON.parse(body).packet.events.length,1);}finally{globalThis.fetch=savedFetch;}
});

test('stale schedule before tip is unverified, not started',()=>{const p=privateTorvikSummary(fixture(),{date,now});const row=torvikComparisonFor({...game,status:'unverified'},p,now);assert.equal(row.started,false);assert.equal(row.statusUnverified,true);});

test('new packet cannot re-label stale retrieval or extend six-hour lifetime',()=>{const p=fixture();p.torvikProvenance.receipts[0].retrievedAt='2026-11-07T12:00Z';assert.throws(()=>privateTorvikSummary(p,{date,now}));const q=fixture();q.expiresAt='2026-11-10T12:00Z';assert.throws(()=>privateTorvikSummary(q,{date,now}));});


test('new packet cannot refresh either source beyond six hours from retrieval',()=>{
 const p=fixture();
 p.torvikProvenance.receipts[0].retrievedAt='2026-11-08T06:03:00Z';
 const result=privateTorvikSummary(p,{date,now});
 assert.equal(result.expiresAt,'2026-11-08T12:03:00.000Z');
 assert.equal(result.events.length,1); // Retained as a saved comparison, not fresh inputs.
 assert.equal(torvikComparisonFor(game,result,now).expired,true);
 assert.equal(torvikComparisonFor(game,result,Date.parse(result.expiresAt)).expired,true);
 p.torvikProvenance.receipts[0].retrievedAt='2026-11-08T12:01:00Z';
 p.torvikProvenance.receipts[1].retrievedAt='2026-11-08T07:00:00Z';
 assert.equal(privateTorvikSummary(p,{date,now}).expiresAt,'2026-11-08T13:00:00.000Z');
});
test('source freshness never extends an earlier packet expiry',()=>{
 const p=fixture();p.expiresAt='2026-11-08T15:00:00Z';
 assert.equal(privateTorvikSummary(p,{date,now}).expiresAt,'2026-11-08T15:00:00.000Z');
});

test('comparison computation must follow receipts and precede tip and source expiry',()=>{for(const generatedAt of [undefined,'2026-11-08T11:59:00Z','2026-11-08T12:00:00Z','2026-11-08T17:00:00Z','2026-11-09T12:00:00Z']){const p=fixture();p.events[0].comparison.generatedAt=generatedAt;assert.throws(()=>privateTorvikSummary(p,{date,now}));}});
