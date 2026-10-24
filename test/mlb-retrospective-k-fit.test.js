import test from 'node:test';
import assert from 'node:assert/strict';
import {fitRetrospectiveKCandidate,predictRetrospectiveK} from '../functions/lib/mlbRetrospectiveKFit.js';
const rows=Array.from({length:1800},(_,i)=>{const d=new Date(Date.parse('2024-04-01')+Math.floor(i/10)*86400000).toISOString().slice(0,10),signal=(i%5)-2;return {gameId:String(Math.floor(i/2)),playerId:String(i%2),date:d,scope:'regular',baseline:4,features:[signal,.3,.4,.32,94,.23],target:Math.round(4*Math.exp(signal*.15)),priorSourceDates:['2024-03-31'],classification:'RETROSPECTIVE'};});
test('fitted candidate improves known signal; final holdout labels cannot change coefficients',()=>{
 const first=fitRetrospectiveKCandidate(rows);assert.equal(first.status,'FITTED_RETROSPECTIVE_ONLY');assert.equal(first.canPromote,false);assert.ok(first.holdout.candidate.mae<first.holdout.baseline.mae);
 const changed=rows.map(r=>r.date>=first.folds.holdoutStart?{...r,target:r.target+20}:r),second=fitRetrospectiveKCandidate(changed);assert.equal(first.modelHash,second.modelHash);assert.notEqual(first.holdout.candidate.mae,second.holdout.candidate.mae);
 assert.ok(predictRetrospectiveK(first.model,rows[0])>0);
});
test('same-day features, duplicate starts and small samples cannot qualify',()=>{
 assert.throws(()=>fitRetrospectiveKCandidate([{...rows[0],priorSourceDates:[rows[0].date]}]));assert.throws(()=>fitRetrospectiveKCandidate([rows[0],rows[0]]));assert.equal(fitRetrospectiveKCandidate(rows.slice(0,10)).status,'INSUFFICIENT_HISTORY');
});

test('hitter models use prior opportunities and prior Statcast; same-game outcomes change labels only',async()=>{
 const {buildRetrospectiveHitterRows}=await import('../functions/lib/mlbRetrospectiveKFit.js');
 const metrics=Object.fromEntries(['xwobacon','hardHit','barrel','contact','chase','strikeout'].map(k=>[k,{numerator:3,denominator:10}]));
 const days=Array.from({length:20},(_,i)=>({date:new Date(Date.parse('2026-06-01')+i*86400000).toISOString().slice(0,10),pitcherDays:[{playerId:'2',pitches:20,metrics}],batterDays:[{playerId:'1',pitches:20,metrics}],games:[{gameId:String(i),gameType:'R',sourceHash:'hash',players:[{playerId:'1',teamId:'A',opponentId:'B',group:'batting',starter:true,stats:{plateAppearances:4,hits:1,totalBases:2,homeRuns:0}},{playerId:'2',teamId:'B',group:'pitching',starter:true,stats:{}}]}]}));
 const first=buildRetrospectiveHitterRows(days);assert.ok(first.hits.length>0);assert.ok(first.total_bases.length>0);assert.ok(first.home_runs.length>0);
 days.at(-1).games[0].players[0].stats.hits=4;const second=buildRetrospectiveHitterRows(days);assert.deepEqual(first.hits.at(-1).features,second.hits.at(-1).features);assert.equal(first.hits.at(-1).baseline,second.hits.at(-1).baseline);assert.notEqual(first.hits.at(-1).target,second.hits.at(-1).target);
});

test('count calibration preserves actual zero outcomes and returns proper fixed-threshold scores',async()=>{
 const {countCalibration}=await import('../functions/lib/mlbRetrospectiveKFit.js');
 const [score]=countCalibration([{target:0},{target:1}],()=>Math.log(2),[.5]);assert.equal(score.n,2);assert.ok(Math.abs(score.brier-.25)<1e-12);assert.ok(score.ece<1e-12);
});
