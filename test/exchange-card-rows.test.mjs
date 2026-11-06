import test from 'node:test';import assert from 'node:assert/strict';
import {exchangeCardRows} from '../src/lib/exchangeCardRows.js';
const now=Date.parse('2026-11-06T16:00:00Z'),start='2026-11-07T01:00:00Z';
const quote=(family,side,line,ask=.52)=>({venue:'Polymarket',marketFamily:family,side,line,ask,transport:'WebSocket',receivedAt:new Date(now-1000).toISOString(),eventStart:start});
test('renders exact signed spreads and over/under thresholds with observed cents',()=>{
 const rows=exchangeCardRows({start,exchangeReferenceQuotes:[quote('spread','away',-3.5),quote('spread','home',3.5,.49),quote('total','over',147.5),quote('total','under',147.5,.5)]},now);
 assert.equal(rows.length,6);assert.deepEqual(rows[4].cells.map(c=>c.line),['-3.5','+3.5']);assert.deepEqual(rows[5].cells.map(c=>c.line),['O 147.5','U 147.5']);assert.equal(rows[4].cells[0].price,'52.0¢');
});
test('missing feeds, mismatched thresholds, stale or wrong-event quotes stay empty',()=>{
 const game={start,exchangeReferenceQuotes:[quote('spread','away',-3.5),quote('spread','home',4.5),{...quote('total','over',147.5),receivedAt:new Date(now-121000).toISOString()},quote('total','under',null),{...quote('moneyline','home',null),eventStart:'2026-11-08T01:00:00Z'}]};
 const rows=exchangeCardRows(game,now);assert.equal(rows[4].cells[1].price,'—');assert.ok(rows[5].cells.every(c=>c.price==='—'));assert.ok(rows[3].cells.every(c=>c.price==='—'));assert.equal(exchangeCardRows({start},now).length,6);
});
