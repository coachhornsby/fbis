import test from 'node:test';import assert from 'node:assert/strict';
import {exchangeCardRows} from '../src/lib/exchangeCardRows.js';
const now=Date.parse('2026-11-06T16:00:00Z'),start='2026-11-07T01:00:00Z';
const quote=(family,side,line,ask=.52)=>({venue:'Polymarket',marketFamily:family,side,line,ask,transport:'WebSocket',receivedAt:new Date(now-1000).toISOString(),eventStart:start});
test('renders exact signed spreads and over/under thresholds with observed cents',()=>{
 const rows=exchangeCardRows({start,exchangeReferenceQuotes:[quote('spread','away',-3.5),quote('spread','home',3.5,.49),quote('total','over',147.5),quote('total','under',147.5,.5)]},now);
 assert.equal(rows.length,8);assert.deepEqual(rows[5].cells.map(c=>c.line),['-3.5','+3.5']);assert.deepEqual(rows[6].cells.map(c=>c.line),['O 147.5','U 147.5']);assert.equal(rows[5].cells[0].price,'52.0¢');
});
test('missing feeds, mismatched thresholds, stale or wrong-event quotes stay empty',()=>{
 const game={start,exchangeReferenceQuotes:[quote('spread','away',-3.5),quote('spread','home',4.5),{...quote('total','over',147.5),receivedAt:new Date(now-121000).toISOString()},quote('total','under',null),{...quote('moneyline','home',null),eventStart:'2026-11-08T01:00:00Z'}]};
 const rows=exchangeCardRows(game,now);assert.equal(rows[5].cells[1].price,'—');assert.ok(rows[6].cells.every(c=>c.price==='—'));assert.ok(rows[4].cells.every(c=>c.price==='—'));assert.equal(exchangeCardRows({start},now).length,8);
});

test('team totals show separate current over/under offers for the correct team only',()=>{
 const sample=(side,line,ask)=>quote('team_total',side,line,ask);
 const rows=exchangeCardRows({start,exchangeReferenceQuotes:[
  sample('away_over',108.5,.56),sample('away_under',108.5,.47),
  sample('home_over',112.5,.52),sample('home_under',112.5,.49),
  sample('away_over',120.5,.03)
 ]},now);
 assert.equal(rows.length,8);
 assert.equal(rows[7].label,'Team totals');
 assert.deepEqual(rows[7].cells[0].lines.map(x=>x.line),['O 108.5','U 108.5']);
 assert.deepEqual(rows[7].cells[0].lines.map(x=>x.price),['56.0¢','47.0¢']);
 assert.deepEqual(rows[7].cells[1].lines.map(x=>x.line),['O 112.5','U 112.5']);
});
test('alternate totals and spreads are never paired across different thresholds',()=>{
 const rows=exchangeCardRows({start,exchangeReferenceQuotes:[
  quote('spread','away',-4.5,.52),quote('spread','home',3.5,.49),
  quote('total','over',142.5,.51),quote('total','under',145.5,.50)
 ]},now);
 const spread=rows[5].cells;
 assert.equal(spread.filter(x=>x.price!=='—').length,1);
 const total=rows[6].cells;
 assert.equal(total.filter(x=>x.price!=='—').length,1);
});
