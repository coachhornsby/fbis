import test from 'node:test';import assert from 'node:assert/strict';
import {summarizePropCalibration} from '../functions/lib/propCalibrationResearch.js';
const base={calibratedProbability:.7,outcome:1,official:true,prospective:true,identityVerified:true,frozenAt:'2026-10-20T10:00:00Z',eventStart:'2026-10-20T20:00:00Z',finalizedAt:'2026-10-21T00:00:00Z',modelVersion:'a',contractId:'b'};
test('calibration includes only official frozen prospective binary outcomes',()=>{
 const x=summarizePropCalibration([base,{...base,outcome:0},{...base,prospective:false},{...base,frozenAt:'2026-10-20T21:00:00Z'}],{minimumSample:2});
 assert.equal(x.n,2);assert.equal(x.excluded,2);assert.ok(Math.abs(x.brier-.29)<1e-10);assert.equal(x.prospectiveEdgeProven,false);assert.equal(x.canAuthorizeWager,false);
});
test('no data produces null metrics instead of synthetic zero',()=>{
 const x=summarizePropCalibration([]);assert.equal(x.brier,null);assert.equal(x.logLoss,null);assert.equal(x.status,'INSUFFICIENT_SAMPLE');
});
