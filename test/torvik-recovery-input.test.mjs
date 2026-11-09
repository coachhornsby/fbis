import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,stat,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {obtainTorvikRecoveryInput,validateTorvikRecoveryInput,torvikRecoveryAdmitted} from '../scripts/lib/torvikRecoveryInput.mjs';
import {captureTorvikRecovery} from '../scripts/lib/torvikRecovery.mjs';
import {createRecoverySourceBudget} from '../scripts/lib/recoveryEvidence.mjs';
import {listTeams} from '../functions/lib/teams.js';
const at=Date.parse('2026-11-09T12:20:00Z'),q=s=>'"'+s.replaceAll('"','""')+'"',names=listTeams('cbb').slice(0,330).map(t=>t.school);
const ratings='team,adjoe,adjde,adjt\n'+names.map(n=>`${q(n)},110,100,70`).join('\n');
const header='TeamName,eFG%,Rk,eFG% Def,Rk,FTR,Rk,FTR Def,Rk,OR%,Rk,DR%,Rk,TO%,Rk,TO% Def.,Rk,3P%,Rk,3pD%,Rk,2p%,Rk,2p%D,Rk';
const factors=header+'\n'+names.map(n=>q(n)+','+Array.from({length:24},(_,i)=>i%2?'100':'50').join(',')).join('\n');
async function fixture(){let n=0;const c=await captureTorvikRecovery({admitted:true,reserve:()=>{},now:()=>at,fetchFn:async()=>new Response(n++?factors:ratings,{headers:{'content-type':'text/csv'}})});return {version:1,...c};}
test('one two-request capture serves both date passes without changing receipts or expiry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'torvik-reuse-')),path=join(dir,'input.json'),b=createRecoverySourceBudget({Torvik:2});let calls=0,captures=0;
 try{
  const capture=()=>{captures++;return captureTorvikRecovery({admitted:true,reserve:k=>b.reserve(k),now:()=>at,fetchFn:async()=>new Response(calls++?factors:ratings,{headers:{'content-type':'text/csv'}})});};
  const today=await obtainTorvikRecoveryInput({outputPath:path,capture,now:()=>at+1000});
  const tomorrow=await obtainTorvikRecoveryInput({inputPath:path,capture:()=>{throw Error('NO_SECOND_CAPTURE');},now:()=>at+2000});
  assert.deepEqual(tomorrow,today);assert.equal(calls,2);assert.equal(captures,1);assert.equal(b.counts.Torvik,2);assert.equal((await stat(path)).mode&0o777,0o600);
  const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.index,undefined);assert.equal(saved.receipts[0].retrievedAt,new Date(at).toISOString());
  await assert.rejects(obtainTorvikRecoveryInput({inputPath:path,capture,now:()=>at+6*3600000}),/INVALID_TORVIK_REUSED_INPUT/);assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reuse rejects wrong season, source URL, hash, identity, stale/future receipts and bad factors',async()=>{
 const value=await fixture();
 for(const mutate of [v=>v.season=2026,v=>v.receipts[0].url='https://barttorvik.com/2026_team_results.csv',v=>v.receipts[0].sha256='x',v=>v.receipts[0].retrievedAt=new Date(at+1).toISOString(),v=>v.receipts[1].retrievedAt=new Date(at-6*3600000).toISOString(),v=>v.rows[0].team='UNKNOWN_TEAM',v=>v.rows[1]=v.rows[0],v=>v.rows[0].efgPct=2,v=>v.rows[0].adjOe=0,v=>v.providerUpdatedAt=new Date(at).toISOString(),v=>v.canAuthorizeWager=true]){const copy=structuredClone(value);mutate(copy);assert.throws(()=>validateTorvikRecoveryInput(copy,{now:at}),/INVALID_TORVIK_REUSED_INPUT/);}
});
test('missing and malformed explicit input never falls back to source access',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'torvik-bad-')),path=join(dir,'input.json');let calls=0;
 try{for(const raw of [null,'{}','not json']){if(raw!==null)await writeFile(path,raw);await assert.rejects(obtainTorvikRecoveryInput({inputPath:path,capture:()=>{calls++;}}));}assert.equal(calls,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('failed source capture does not create a reusable input',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'torvik-fail-')),path=join(dir,'input.json'),failure={ok:false,state:'UNAVAILABLE',error:'TORVIK_HTTP_403'};
 try{assert.equal(await obtainTorvikRecoveryInput({outputPath:path,capture:async()=>failure}),failure);await assert.rejects(stat(path),/ENOENT/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('workflow retains one daily slot and forbids Torvik acquisition on pushes, manual runs and retries',async()=>{
 const s=await readFile(new URL('../.github/workflows/fbis-four-sport-recovery-once.yml',import.meta.url),'utf8');
 assert.match(s,/FBIS_TORVIK_NOT_BEFORE_DATE: \"2026-11-10\"/);
 assert.equal((s.match(/cron:/g)||[]).length,1);assert.match(s,/cron: "20 12 \* \* \*"/);
 assert.equal((s.match(/FBIS_TORVIK_RECOVERY_ADMITTED: \$\{\{ github.event_name == 'schedule' && github.run_attempt == 1 && '1' \|\| '0' \}\}/g)||[]).length,2);
 const next=s.split('- name: Prepare next-day')[1].split('- name: Remove')[0];assert.match(next,/FBIS_TORVIK_INPUT_PATH:/);assert.doesNotMatch(next,/FBIS_TORVIK_OUTPUT_PATH:/);
 assert.match(s,/rm -f .*fbis-torvik-ratings\.json/);assert.doesNotMatch(s.split('uses: actions\/upload-artifact')[1],/fbis-torvik-ratings/);
 const runner=await readFile(new URL('../scripts/recover-four-sport-once.mjs',import.meta.url),'utf8');assert.match(runner,/torvikFetchAdmitted=torvikAdmitted&&!torvikInputPath/);assert.match(runner,/Torvik:torvikFetchAdmitted\?2:0/);assert.match(runner,/target\.cbb\.length\|\|torvikOutputPath/);
});


test('rollout hold prevents November9 captures without claiming a provider reset',()=>{
 assert.equal(torvikRecoveryAdmitted({enabled:'1',notBefore:'2026-11-10',now:Date.parse('2026-11-09T23:59:59.999Z')}),false);
 assert.equal(torvikRecoveryAdmitted({enabled:'1',notBefore:'2026-11-10',now:Date.parse('2026-11-10T12:20:00Z')}),true);
 for(const notBefore of ['2026-02-30','bad','2026-11-10T00:00:00Z'])assert.equal(torvikRecoveryAdmitted({enabled:'1',notBefore,now:Date.parse('2026-11-11T00:00Z')}),false);
 for(const enabled of [undefined,'0','true'])assert.equal(torvikRecoveryAdmitted({enabled,notBefore:'2026-11-10',now:Date.parse('2026-11-11T00:00Z')}),false);
});
