import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNflFeatureSnapshot,loadNflVerseFeatures} from '../functions/lib/nflVerseFeed.js';
const now=Date.parse('2026-11-08T17:00:00Z');
const valid=()=>({season:2026,byTeam:{DAL:{offenseEpa:.1}},playersByTeam:{DAL:[]},meta:{builtAt:'2026-11-08T16:00:00Z'}});
for(const [name,edit,reason] of [
 ['missing time',s=>delete s.meta.builtAt,'snapshot-time-missing'],
 ['timezone missing',s=>s.meta.builtAt='2026-11-08T16:00:00','snapshot-time-missing'],
 ['numeric timestamp',s=>s.meta.builtAt=2026,'snapshot-time-missing'],
 ['malformed time',s=>s.meta.builtAt='bad','snapshot-time-missing'],
 ['future time',s=>s.meta.builtAt='2026-11-08T18:00:00Z','snapshot-time-future'],
 ['wrong season',s=>s.season=2025,'snapshot-season-mismatch'],
 ['exact expiry',s=>s.meta.builtAt=new Date(now-36*3600000).toISOString(),'snapshot-expired'],
]) test(name+' fails closed without live fallback',async()=>{
 const s=valid();edit(s);assert.equal(validateNflFeatureSnapshot(s,2026,now).reason,reason);
 let fetches=0;const out=await loadNflVerseFeatures({ARCHIVE:{get:async()=>({text:async()=>JSON.stringify(s)})}},{now,fetchFn:async()=>{fetches++;throw Error('forbidden');}});
 assert.deepEqual(out.byTeam,{});assert.equal(fetches,0);
});
test('valid build time permits snapshot but does not assert data-through freshness',()=>{
 assert.equal(validateNflFeatureSnapshot(valid(),2026,now).ok,true);
 assert.equal(valid().meta.dataThrough,undefined);
});

test('expired cached payload cannot bypass archive validation', async()=>{
 const {writeCache,resetCacheMem}=await import('../functions/lib/cache.js');
 resetCacheMem();const s=valid();s.meta.builtAt=new Date(now-37*3600000).toISOString();
 s.byTeam=Object.fromEntries(Array.from({length:32},(_,i)=>['T'+i,{}]));
 s.playersByTeam=Object.fromEntries(Array.from({length:32},(_,i)=>['T'+i,[]]));
 await writeCache('nflverse-features-v5-2026',s,null,10800000);
 let reads=0;const out=await loadNflVerseFeatures({ARCHIVE:{get:async()=>{reads++;return null;}}},{now,fetchFn:async()=>{throw Error('forbidden');}});
 assert.equal(reads,1);assert.deepEqual(out.byTeam,{});resetCacheMem();
});
test('createdAt fallback and just-before expiry remain compatible',()=>{
 const s=valid();s.meta.createdAt=new Date(now-36*3600000+1).toISOString();delete s.meta.builtAt;
 assert.equal(validateNflFeatureSnapshot(s,2026,now).ok,true);
});
test('cached age is recomputed rather than preserved from initial read',async()=>{
 const {writeCache,resetCacheMem}=await import('../functions/lib/cache.js');resetCacheMem();
 const s=valid();s.meta.snapshotAgeHours=0;
 s.byTeam=Object.fromEntries(Array.from({length:32},(_,i)=>['T'+i,{}]));s.playersByTeam=Object.fromEntries(Array.from({length:32},(_,i)=>['T'+i,[]]));
 await writeCache('nflverse-features-v5-2026',s,null,10800000);
 const out=await loadNflVerseFeatures({}, {now,fetchFn:async()=>{throw Error('forbidden');}});
 assert.equal(out.meta.snapshotAgeHours,1);resetCacheMem();
});

test('impossible calendar dates cannot normalize into valid freshness',()=>{
 const s=valid();s.meta.builtAt='2026-11-31T16:00:00Z';
 assert.equal(validateNflFeatureSnapshot(s,2026,Date.parse('2026-12-01T17:00:00Z')).ok,false);
});
