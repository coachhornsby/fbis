import test from 'node:test';
import assert from 'node:assert/strict';
import {tierOf,ingestCrossLevelRows,runCrossLevelEvaluation,sourceFiles} from '../scripts/lib/tennis-crosslevel-walkforward.mjs';
const row=(year=2024,code='C')=>({
 tourney_id:String(year)+'-test',tourney_date:String(year)+'0801',
 tourney_level:code,match_num:'20',surface:'Hard',
 winner_id:'314159',loser_id:'271828',winner_name:'Alfa',loser_name:'Beta',
 w_ace:'5',w_df:'2',w_svpt:'70',w_1stIn:'43',w_1stWon:'32',w_2ndWon:'13',
 w_SvGms:'11',w_bpSaved:'3',w_bpFaced:'6',
 l_ace:'2',l_df:'4',l_svpt:'68',l_1stIn:'41',l_1stWon:'26',l_2ndWon:'12',
 l_SvGms:'10',l_bpSaved:'2',l_bpFaced:'5'
});
test('2024-26 files include separate main-tour, Challenger/Futures and WTA ITF',()=>{
 assert.equal(sourceFiles.length,15);
 assert.equal(sourceFiles.filter(x=>x.sourceTier==='MAIN_TOUR').length,6);
 assert.equal(sourceFiles.filter(x=>x.tour==='wta'&&x.sourceTier!=='MAIN_TOUR').length,3);
 assert.equal(tierOf({sourceTier:'ATP_QUAL_CHALL'},row()),'ATP_QUAL_CHALL:C');
 assert.equal(tierOf({sourceTier:'MAIN_TOUR'},row()),'MAIN_TOUR');
});
test('rejects missing stats and embargoed rows, deduplicates exact records',()=>{
 const store={groups:new Map(),seen:new Set()};
 const meta={tour:'atp',sourceTier:'ATP_QUAL_CHALL',path:'test'};
 const x=ingestCrossLevelRows(store,meta,[
 row(),row(),{...row(),match_num:'21',w_svpt:''},
 {...row(),match_num:'22',tourney_date:'20261022'}
 ],{cutoffExclusive:'20261001'});
 assert.equal(x.accepted,1);
 assert.equal(x.duplicate,1);
 assert.equal(x.invalidStats,1);
 assert.equal(x.afterCutoff,1);
});
test('2026 holdout is strictly out of training and never authorizes production',()=>{
 const store={groups:new Map(),seen:new Set()};
 const main={tour:'atp',sourceTier:'MAIN_TOUR',path:'main.csv'};
 const lower={tour:'atp',sourceTier:'ATP_QUAL_CHALL',path:'lower.csv'};
 const batches=[2024,2025,2026];
 for(const year of batches){
  for(let i=0;i<3;i++){
   const match={...row(year),match_num:String(i),tourney_id:String(year)+'-'+i};
   if(year===2024||year===2025)
    ingestCrossLevelRows(store,lower,[match],{cutoffExclusive:'20270101'});
   ingestCrossLevelRows(store,main,[{...match,w_1stWon:'35'}],{cutoffExclusive:'20270101'});
  }
 }
 const policy={minOverlapPlayers:1,minOverlapPoints:50,minHoldoutPlayers:1,minHoldoutPoints:40};
 const report=runCrossLevelEvaluation(store,policy);
 const fold=report.findings.find(f=>f.holdoutYear===2026&&f.metric==='serve');
 assert.equal(report.sourceFiles,undefined);
 assert.equal(fold.trainingYears,'2024-2025');
 assert.equal(fold.calibration.eligible,true);
 assert.equal(fold.holdout.evaluable,true);
 assert.equal(report.canAuthorizeWager,false);
 const before=fold.calibration.delta;
 for(let i=0;i<3;i++)ingestCrossLevelRows(store,main,[{
  ...row(2026),tourney_id:'extra-2026-'+i,match_num:String(i),w_1stWon:'23'
 }],{cutoffExclusive:'20270101'});
 const next=runCrossLevelEvaluation(store,policy).findings.find(f=>f.holdoutYear===2026&&f.metric==='serve');
 assert.equal(next.calibration.delta,before);
 assert.notEqual(next.holdout.rawBrier,fold.holdout.rawBrier);
 assert.equal(next.canQualify,false);
});
