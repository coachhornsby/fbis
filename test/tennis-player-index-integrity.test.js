import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildObservedColdStartProfile,resolveWithColdStart} from '../tennis/tennisColdStart.mjs';

const observed=(i)=>({date:`2026-09-${String(i+1).padStart(2,'0')}`,surface:'Hard',aces:5+i%2,doubleFaults:2,
  acesFaced:4,svGms:10,retGms:10,servePtsWonPct:.63+i*.002,returnPtsWonPct:.37-i*.001});

test('cold start fails closed with no observations',()=>{
  const r=buildObservedColdStartProfile('Off Index',[],{surface:'Hard'});
  assert.equal(r.insufficient,true); assert.equal(r.player,null);
});

test('cold start requires enough observed dimensions',()=>{
  const r=buildObservedColdStartProfile('Thin Player',Array.from({length:5},(_,i)=>({date:`2026-09-0${i+1}`,svGms:10,servePtsWonPct:.62,aces:4})),{surface:'Hard'});
  assert.equal(r.insufficient,true); assert.equal(r.player,null);
});

test('cold start produces explicit observation-backed thin profile when adequate',()=>{
  const rows=Array.from({length:6},(_,i)=>observed(i));
  const r=buildObservedColdStartProfile('Observed Player',rows,{surface:'Hard',rank:240,liveSource:'fixture'});
  assert.equal(r.insufficient,false); assert.equal(r.coldStart,true);
  assert.equal(r.player._coldStart,true); assert.equal(r.player._sampleMatches,6);
  assert.equal(r.player._liveSource,'fixture'); assert.equal(r.player.surfaces.Hard.n,6);
  assert.ok(r.player.surfaces.Hard.servePtsWonPct>.63);
});

test('resolver returns insufficient rather than neutral defaults',async()=>{
  const source={fetchRecentMatches:async()=>[]};
  const r=await resolveWithColdStart(source,null,'Missing Player',{surface:'Hard'});
  assert.equal(r.insufficient,true); assert.equal(r.player,null);
});

const header=['tourney_id','tourney_name','surface','draw_size','tourney_level','tourney_date','match_num','winner_id','winner_seed','winner_entry','winner_name','winner_hand','winner_ht','winner_ioc','winner_age','loser_id','loser_seed','loser_entry','loser_name','loser_hand','loser_ht','loser_ioc','loser_age','score','best_of','round','minutes','w_ace','w_df','w_svpt','w_1stIn','w_1stWon','w_2ndWon','w_SvGms','w_bpSaved','w_bpFaced','l_ace','l_df','l_svpt','l_1stIn','l_1stWon','l_2ndWon','l_SvGms','l_bpSaved','l_bpFaced','winner_rank','winner_rank_points','loser_rank','loser_rank_points'];
const row=(level='C')=>['2026-test','Test','Hard','32',level,'20260105','1','1','','','A','R','','USA','22','2','','','B','R','','USA','23','6-4 6-4','3','R32','90','5','2','60','35','25','14','10','3','4','4','3','58','34','22','13','10','2','4','200','','250',''].join(',');

function audit(csv,kind='challenger'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tennis-audit-')); const file=path.join(dir,'x.csv'); fs.writeFileSync(file,csv);
  const p=spawnSync(process.execPath,['tennis/tennisSourceAudit.mjs','--file',file,'--kind',kind,'--year','2026'],{encoding:'utf8'});
  return {status:p.status,out:p.stdout?JSON.parse(p.stdout):null};
}

test('source audit rejects header-only challenger file',()=>{
  const r=audit(header.join(',')+'\n'); assert.notEqual(r.status,0); assert.equal(r.out.valid,false);
  assert.ok(r.out.errors.includes('header_only_or_zero_rows'));
});

test('source audit accepts valid challenger row with serve stats',()=>{
  const r=audit(header.join(',')+'\n'+row('C')+'\n'); assert.equal(r.status,0); assert.equal(r.out.valid,true); assert.equal(r.out.rows,1);
});
