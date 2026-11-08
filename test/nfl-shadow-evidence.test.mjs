import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditNflShadow} from '../scripts/lib/nfl-shadow-evidence.mjs';
const now=Date.parse('2026-11-08T12:00:00Z');
function input(){const f={offenseEpa:.1,defenseEpa:-.1,qbEpa:.2};const snapshotText=JSON.stringify({season:2026,byTeam:{DAL:f,NYG:f},playersByTeam:{},meta:{builtAt:'2026-11-08T10:00:00Z'}});return {snapshotText,season:2026,now,evidence:{snapshotSha256:createHash('sha256').update(snapshotText).digest('hex'),source:'nflverse',observedAt:'2026-11-08T10:00:00Z',dataThrough:'2026-11-03T05:00:00Z',completedWeek:9},games:[{id:'1',home:'DAL',away:'NYG',start:'2026-11-08T18:00:00Z',requiredCompletedWeek:9}]};}
test('valid reviewed inputs yield diagnostic shadow without authority',()=>{const r=auditNflShadow(input());assert.deepEqual(r.rows[0].blocked,[]);assert.ok(r.rows[0].shadow);assert.equal(r.rows[0].shadow.canQualify,false);assert.equal(r.rows[0].edgeEligible,false);assert.equal(r.rows[0].opponentAdjusted,false);assert.equal(r.networkCalls,0);});
for(const [label,edit] of [
 ['missing receipt',x=>delete x.evidence],['wrong hash',x=>x.evidence.snapshotSha256='bad'],
 ['stale observation',x=>x.evidence.observedAt='2026-11-01T10:00:00Z'],['future data',x=>x.evidence.dataThrough='2026-11-09T10:00:00Z'],
 ['malformed date',x=>x.evidence.dataThrough='2026-11-31T10:00:00Z'],['missing week',x=>delete x.evidence.completedWeek],
 ['incomplete week',x=>x.evidence.completedWeek=8],['missing team',x=>x.games[0].home='XXX'],['started game',x=>x.games[0].start='2026-11-08T10:00:00Z'],
 ['timezone-free start',x=>x.games[0].start='2026-11-08T18:00:00'],['zero week',x=>x.games[0].requiredCompletedWeek=0],
 ['missing required week',x=>delete x.games[0].requiredCompletedWeek],
])test(label+' blocks shadow score',()=>{const x=input();edit(x);const r=auditNflShadow(x);assert.ok(r.rows[0].blocked.length);assert.equal(r.rows[0].shadow,null);});
test('no numeric string coercion',()=>{const x=input(),s=JSON.parse(x.snapshotText);s.byTeam.DAL.qbEpa='0.2';x.snapshotText=JSON.stringify(s);x.evidence.snapshotSha256=createHash('sha256').update(x.snapshotText).digest('hex');assert.equal(auditNflShadow(x).rows[0].shadow,null);});
test('bounded slate',()=>{const x=input();x.games=Array(33).fill(x.games[0]);assert.throws(()=>auditNflShadow(x),/SLATE_SIZE/);});

test('empty slate fails closed',()=>{const x=input();x.games=[];assert.throws(()=>auditNflShadow(x),/SLATE_SIZE/);});
test('duplicate identity blocks second game',()=>{const x=input();x.games.push({...x.games[0]});assert.ok(auditNflShadow(x).rows[1].blocked.includes('game-identity-invalid'));});

test('data cannot postdate snapshot build',()=>{const x=input();x.evidence.dataThrough='2026-11-08T10:30:00Z';x.evidence.observedAt='2026-11-08T11:00:00Z';assert.ok(auditNflShadow(x).rows[0].blocked.includes('source-data-through-invalid'));});
