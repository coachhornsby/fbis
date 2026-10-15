import test from 'node:test';import assert from 'node:assert/strict';
import {preparePinnoddsSnapshot,consumePinnoddsSnapshot,reconcilePinnoddsSnapshot,rematchPinnoddsSnapshot} from '../functions/lib/pinnoddsIngestion.js';

function archiveEnv({receipt,rawKey,rawBody,games=[],tennisFixtures=[]}={}){
  const values=new Map(),writes=new Map();
  values.set(`market-sources/pinnodds/receipts/${receipt.snapshotId}.json`,JSON.stringify(receipt));
  values.set(rawKey,JSON.stringify(rawBody));
  const env={
    ARCHIVE:{
      async get(key){return values.has(key)?{async json(){return JSON.parse(values.get(key))}}:null},
      async put(key,value){values.set(key,typeof value==='string'?value:JSON.stringify(value));},
    },
    DB:{prepare(sql){
      if(/tennis_external_fixtures|tennis_official_matches/.test(sql)){
        return{bind(){return{async all(){return{results:tennisFixtures}}}}};
      }
      if(/FROM games/.test(sql)){
        return{bind(){return{async all(){return{results:games}}}}};
      }
      if(/COUNT\(\*\)/.test(sql)){
        return{bind(){return{async first(){return{n:writes.size}}}}};
      }
      return{bind(...args){return{async run(){
        const inserted=!writes.has(args[0]);
        writes.set(args[0],args);
        return{meta:{changes:inserted?1:0}};
      }}}};
    }},
    _values:values,
    _writes:writes,
  };
  return env;
}

test('archived provider capture is consumed without upstream calls, replays idempotently and reconciles',async()=>{
 const snapshotId='run-1-board-6-prematch',at='2026-10-13T17:00:00Z';
 const receipt={ok:true,snapshotId,sportId:6,feed:'prematch',kind:'board',collectedAt:at,rawKey:'raw'};
 const env=archiveEnv({
  receipt,rawKey:'raw',
  rawBody:{events:[{event_id:1,league_name:'MLB',starts:'2026-10-14T00:00:00Z',home:'Home',away:'Away',periods:{num_0:{money_line:{home:1.8,away:2.1}}}}]},
  games:[{id:'mlb-1',sport:'mlb',start:'2026-10-14T00:00:00Z',home_name:'Home',away_name:'Away',home_abbr:'HOM',away_abbr:'AWY'}],
 });
 const prepared=await preparePinnoddsSnapshot(env,{snapshotId});assert.equal(prepared.normalizedRows,2);assert.equal(prepared.batches,1);assert.equal(env._writes.size,0);
 assert.equal((await consumePinnoddsSnapshot(env,{snapshotId,batchIndex:0})).inserted,2);assert.equal((await consumePinnoddsSnapshot(env,{snapshotId,batchIndex:0})).inserted,0);
 const result=await reconcilePinnoddsSnapshot(env,{snapshotId});assert.equal(result.reconciled,true);assert.equal(result.persistedRows,2);
 for(const row of env._writes.values()){assert.equal(row[29],null);assert.equal(row[30],at);assert.equal(row[31],'RESEARCH');assert.ok(row[21]>1);}
});

test('rematch reuses archived raw tennis snapshot without paid provider calls',async()=>{
 const snapshotId='tennis-stale-board-2-prematch',at='2026-10-13T18:43:05.613Z';
 const fixture={id:'tennis:espn:wta:381-2026:185348',start:'2026-10-14T06:00:00.000Z',tour:'wta',
  away_name:'Jessica Pegula',home_name:'Jelena Ostapenko',sport:'tennis',fixture_source:'ESPN_PUBLIC'};
 const receipt={ok:true,snapshotId,sportId:2,feed:'prematch',kind:'board',collectedAt:at,rawKey:'raw-tennis'};
 const env=archiveEnv({
  receipt,rawKey:'raw-tennis',
  rawBody:{events:[{event_id:99,league_name:'WTA Singles',starts:fixture.start,
   home:'Jessica Pegula',away:'Jelena Ostapenko',periods:{num_0:{number:0,money_line:{home:1.8,away:2.05}}}}]},
  tennisFixtures:[fixture],
 });
 // Prior prepare short-circuit with zero matches (pre-#1097 behavior).
 env._values.set(`market-sources/pinnodds/normalized/${snapshotId}.json`,JSON.stringify({
  ...receipt,rows:[],reasons:{},inputEvents:1,normalizedRows:0,matchedRows:0,batchSize:100,batches:0}));
 const rematch=await rematchPinnoddsSnapshot(env,{snapshotId});
 assert.equal(rematch.paidProviderCall,false);
 assert.equal(rematch.matchedRows,2);
 assert.equal(rematch.normalizedRows,2);
 assert.equal(rematch.ok,true);
 assert.equal(rematch.reconciled,true);
 assert.ok(rematch.inserted>=1);
 const renorm=JSON.parse(env._values.get(`market-sources/pinnodds/normalized/${snapshotId}.json`));
 assert.equal(renorm.matchedRows,2);
 assert.ok(renorm.rematchedAt);
 const latest=JSON.parse(env._values.get('market-sources/pinnodds/latest/board-2-prematch.json'));
 assert.equal(latest.matchedRows,2);
 assert.equal(latest.rematched,true);
 assert.equal(latest.paidProviderCall,false);
});

test('post-capture fixture rematch can link tennis after ESPN fixtures arrive',async()=>{
 const snapshotId='tennis-postcapture-board-2-prematch',at='2026-10-13T18:43:05.613Z';
 const fixture={id:'tennis:espn:wta:381-2026:185348',start:'2026-10-14T06:00:00.000Z',tour:'wta',
  away_name:'Jessica Pegula',home_name:'Jelena Ostapenko',sport:'tennis',fixture_source:'ESPN_PUBLIC'};
 const receipt={ok:true,snapshotId,sportId:2,feed:'prematch',kind:'board',collectedAt:at,rawKey:'raw-tennis'};
 let asOfSeen=null,includeCompletedSeen=false;
 const env=archiveEnv({
  receipt,rawKey:'raw-tennis',
  rawBody:{events:[{event_id:99,league_name:'WTA Singles',starts:fixture.start,
   home:'Jessica Pegula',away:'Jelena Ostapenko',periods:{num_0:{number:0,money_line:{home:1.8,away:2.05}}}}]},
  tennisFixtures:[fixture],
 });
 // Intercept tennis candidate load args via SQL bind on external fixtures path.
 const orig=env.DB.prepare;
 env.DB.prepare=function(sql){
  if(/tennis_external_fixtures|tennis_official_matches/.test(sql)){
   includeCompletedSeen=/FINAL|COMPLETED/.test(sql);
   return{bind(...args){asOfSeen=args[3];return{async all(){return{results:[fixture]}}}}};
  }
  return orig.call(env.DB,sql);
 };
 const prepared=await rematchPinnoddsSnapshot(env,{snapshotId,phase:'prepare',postCaptureFixtures:true});
 assert.equal(prepared.matchedRows,2);
 assert.equal(prepared.postCaptureFixtures,true);
 assert.equal(prepared.prospectiveEvidenceEligible,false);
 assert.notEqual(asOfSeen,at);
 assert.equal(includeCompletedSeen,true);
 assert.ok(Date.parse(asOfSeen)>Date.parse(at));
});

test('phased rematch prepare/consume/finalize avoids single-request board timeouts',async()=>{
 const snapshotId='tennis-phased-board-2-prematch',at='2026-10-13T18:43:05.613Z';
 const fixture={id:'tennis:espn:wta:381-2026:185348',start:'2026-10-14T06:00:00.000Z',tour:'wta',
  away_name:'Jessica Pegula',home_name:'Jelena Ostapenko',sport:'tennis',fixture_source:'ESPN_PUBLIC'};
 const receipt={ok:true,snapshotId,sportId:2,feed:'prematch',kind:'board',collectedAt:at,rawKey:'raw-tennis'};
 const env=archiveEnv({
  receipt,rawKey:'raw-tennis',
  rawBody:{events:[{event_id:99,league_name:'WTA Singles',starts:fixture.start,
   home:'Jessica Pegula',away:'Jelena Ostapenko',periods:{num_0:{number:0,money_line:{home:1.8,away:2.05}}}}]},
  tennisFixtures:[fixture],
 });
 const prepared=await rematchPinnoddsSnapshot(env,{snapshotId,phase:'prepare'});
 assert.equal(prepared.phase,'prepare');
 assert.equal(prepared.matchedRows,2);
 assert.equal(prepared.batches,1);
 assert.equal(env._writes.size,0);
 const consumed=await rematchPinnoddsSnapshot(env,{snapshotId,phase:'consume',batchIndex:0});
 assert.equal(consumed.phase,'consume');
 assert.ok(consumed.inserted>=1);
 const finalized=await rematchPinnoddsSnapshot(env,{snapshotId,phase:'finalize'});
 assert.equal(finalized.phase,'finalize');
 assert.equal(finalized.matchedRows,2);
 assert.equal(finalized.rematched===true||JSON.parse(env._values.get('market-sources/pinnodds/latest/board-2-prematch.json')).rematched,true);
});

test('soccer prematch normalizes every market inside the verified fixture universe and retains excluded events in raw',async()=>{
 const snapshotId='soccer-source-prematch',now=new Date(),at=now.toISOString(),start=new Date(now.getTime()+3600000).toISOString();
 const event=(id,home,away)=>({event_id:id,league_name:'Premier League',starts:start,home,away,periods:{num_0:{money_line:{home:2,draw:3,away:4}}},specials:[{event_id:id+10,special:'Both Teams To Score?',special_category:'team',special_markets:{num_0:[{prices:[{name:'yes',price:1.9},{name:'no',price:1.9}]}]}}]});
 const raw={events:[event(1,'Home','Away'),event(2,'Outside','Universe')]};
 const env=archiveEnv({receipt:{ok:true,snapshotId,sportId:1,feed:'prematch',kind:'board',collectedAt:at,rawKey:'raw'},rawKey:'raw',rawBody:raw});
 env._values.set(`soccer/market-fixtures/${at.slice(0,10)}.json`,JSON.stringify({observedAt:at,fixtures:[{id:'g',sport:'soccer',start,home_name:'Home',away_name:'Away'}],errors:[],complete:true}));
 const prepared=await preparePinnoddsSnapshot(env,{snapshotId});
 assert.equal(prepared.normalizedRows,5);assert.equal(prepared.matchedRows,5);assert.equal(prepared.selectedParentEvents,1);assert.equal(prepared.excludedUnmatchedProviderEvents,1);
 assert.equal(JSON.parse(env._values.get('raw')).events.length,2);
 await consumePinnoddsSnapshot(env,{snapshotId,batchIndex:0});assert.equal(env._writes.size,5);
 for(const r of env._writes.values()){assert.equal(r[30],at);assert.equal(r[29],null);}
});
