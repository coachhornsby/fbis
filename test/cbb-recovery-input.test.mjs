import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {obtainCbbRecoveryInput,validateCbbRecoveryInput} from '../scripts/lib/cbbRecoveryInput.mjs';
const rows=Array.from({length:365},()=>({Season:2027}));
test('today and tomorrow share exactly one licensed capture and its original timestamp',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cbb-input-')),path=join(dir,'input.json');let calls=0;
 try{
  const a=await obtainCbbRecoveryInput({outputPath:path,fetchRatings:async()=>{calls++;return rows;}});
  const b=await obtainCbbRecoveryInput({inputPath:path,fetchRatings:async()=>{calls++;throw Error('must not fetch');}});
  assert.deepEqual(a,b);assert.equal(calls,1);assert.equal((await stat(path)).mode&0o777,0o600);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('expired, future, wrong-season and incomplete inputs fail closed',()=>{
 const now=Date.now(),good={version:1,season:2027,capturedAt:new Date(now-1000).toISOString(),rows};
 assert.equal(validateCbbRecoveryInput(good,{now}),good);
 for(const patch of [{capturedAt:new Date(now-6*3600000).toISOString()},{capturedAt:new Date(now+1).toISOString()},{season:2026},{rows:rows.slice(0,299)},{rows:rows.map(r=>({...r,Season:2026}))}])assert.throws(()=>validateCbbRecoveryInput({...good,...patch},{now}));
});
test('missing explicit input never triggers paid fallback',async()=>{
 let calls=0;await assert.rejects(obtainCbbRecoveryInput({inputPath:'/nonexistent/cbb-input.json',fetchRatings:async()=>{calls++;return rows;}}));assert.equal(calls,0);
});
