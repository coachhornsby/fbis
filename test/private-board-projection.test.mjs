import {test} from 'node:test';import assert from 'node:assert/strict';import {validatePrivatePacket,privateProjectionFor,readPrivatePacketText} from '../src/lib/privateBoardProjection.js';
const event={eventId:'123',date:'2026-11-02',start:'2026-11-02T22:00Z',homeId:'cbb-1',awayId:'cbb-2',neutralSite:false,primary:{home:75,away:70,margin:5,total:145}};
const packet=()=>({version:1,visibility:'PRIVATE_PERSONAL_ANALYSIS',expiresAt:'2026-11-02T23:00Z',events:[structuredClone(event)]});
const game=()=>({id:'123',sport:'cbb',date:event.date,start:event.start,home:{espnId:'1'},away:{espnId:'2'},neutralSite:false,status:'scheduled'});
test('matches exact fixture and retains unconfirmed numbers',()=>{const p=validatePrivatePacket(packet());assert.equal(privateProjectionFor(game(),p,Date.parse('2026-11-02T20:00Z')).primary.total,145);});
test('rejects changed teams, date, start or venue',()=>{for(const diff of [{home:{espnId:'3'}},{date:'2026-11-03'},{start:'2026-11-02T21:00Z'},{neutralSite:true},{sport:'nba'}])assert.equal(privateProjectionFor({...game(),...diff},packet()),null);});
test('expired and started snapshots stay labeled historical',()=>{assert.equal(privateProjectionFor(game(),packet(),Date.parse('2026-11-03')).expired,true);assert.equal(privateProjectionFor({...game(),status:'live'},packet(),Date.parse('2026-11-02T20:00Z')).historical,true);});
test('rejects malformed scores and duplicate event bindings',()=>{const p=packet();p.events.push(p.events[0]);assert.throws(()=>validatePrivatePacket(p));const q=packet();q.events[0].primary.total='145';assert.throws(()=>validatePrivatePacket(q));});

test('imports the owner-only offline HTML report without executing its scripts',()=>{
 const p=packet(),html='<!doctype html><html><title>FBIS Private CBB Projections</title><script>const packet='+JSON.stringify(p)+';const run=()=>{throw Error("HTML must not execute")};</script></html>';
 assert.deepEqual(readPrivatePacketText(html),p);
 assert.deepEqual(readPrivatePacketText(JSON.stringify(p)),p);
});
test('rejects deceptive, malformed, oversized and non-private HTML sources',()=>{
 const p=packet(),body=JSON.stringify(p);
 for(const html of ['<html><script>const packet='+body+';</script></html>',
 '<!doctype html><title>FBIS Private CBB Projections</title><script>const packet={};</script>',
 '<!doctype html><title>FBIS Private CBB Projections</title><script>const packet='+body.slice(0,-2)+';</script>',
 '<!doctype html><title>FBIS Private CBB Projections</title><script>const packet='+body+';const packet='+body+';</script>'])
  assert.throws(()=>readPrivatePacketText(html));
 assert.throws(()=>readPrivatePacketText('x'.repeat(2000001)));
});
