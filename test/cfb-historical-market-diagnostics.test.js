import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCfbHistoricalMarketGrades as summarize} from '../functions/lib/cfbHistoricalMarketDiagnostics.js';
test('historical line outcomes without prices cannot generate economic evidence',()=>{
 const r=summarize([{win:true,loss:false,push:false,edge:3},{win:false,loss:true,push:false,edge:-5},{win:false,loss:false,push:true,edge:2},null]);
 assert.equal(r.n,3);assert.equal(r.decisions,2);assert.equal(r.hitRate,.5);assert.equal(r.avgAbsEdge,10/3);
 for(const key of ['units','roi','clv'])assert.equal(r[key],null);
 assert.equal(r.economicObservations,0);
});
test('empty and push-only cohorts retain unavailable economics and decision rate',()=>{
 for(const input of [[],[{win:false,loss:false,push:true,edge:1}]]){
  const r=summarize(input);assert.equal(r.hitRate,null);assert.equal(r.roi,null);assert.equal(r.units,null);assert.equal(r.clv,null);
 }
});
