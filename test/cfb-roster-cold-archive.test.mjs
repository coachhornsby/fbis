import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveScope,archiveSegment,archiveManifest,sha256} from '../scripts/lib/cfb-roster-cold-archive.mjs';
const row=(id,n,season=2004)=>({
  __archive_rowid:String(n),
  id,
  season,
  content_hash:'a'.repeat(64),
  payload_json:JSON.stringify({id,year:season,'last name':'O\'Brien'}),
  observed_at:'2026-10-06T12:18:21.253918+00:00',
  research_only:1,
  can_influence_projection:0,
});
test('pilot scope is bounded to old rosters and small readback batches',()=>{
  assert.deepEqual(archiveScope({season:'2004'}),{season:2004,startRowid:0,maxRows:500,batchRows:100});
  for(const bad of [{season:2026},{season:2004,maxRows:2001},{season:2004,batchRows:101},{season:2004,startRowid:-1},{season:'2004.5'}])
    assert.throws(()=>archiveScope(bad),/INVALID/);
});
test('serialized CFB roster segment keeps exact provenance, fields and a content-addressed SHA256',()=>{
  const original=[row('p1',10),row('p2',11)];
  const segment=archiveSegment(original,{season:2004,upperRowid:500});
  assert.equal(segment.count,2);
  assert.equal(segment.sha256,sha256(segment.body));
  assert.ok(segment.key.includes(segment.sha256));
  assert.deepEqual(JSON.parse(segment.body).rows,original);
  assert.equal(archiveSegment(original,{season:2004,upperRowid:500}).sha256,segment.sha256);
});
test('pilot refuses out-of-scope, reordered or suspicious records',()=>{
  const okay=row('p1',10);
  for(const rows of [[row('p1',11),row('p2',10)],[row('p1',10,2005)],[{...okay,content_hash:'bad'}],[{...okay,__archive_rowid:'900'}],[{...okay,id:''}]])
    assert.throws(()=>archiveSegment(rows,{season:2004,upperRowid:500}),/MISMATCH|INVALID/);
});
test('manifest records only verified R2 readbacks and explicitly prohibits source deletion',()=>{
  const s=archiveSegment([row('p1',10)],{season:2004,upperRowid:500});
  const scope=archiveScope({season:2004,maxRows:10});
  assert.throws(()=>archiveManifest({scope,upperRowid:500,totalInSeason:123,segments:[{...s,verified:false}],exportedAt:'2026-10-15T00:00:00Z'}),/UNVERIFIED/);
  const m=archiveManifest({scope,upperRowid:500,totalInSeason:123,segments:[{...s,verified:true}],exportedAt:'2026-10-15T00:00:00Z'});
  assert.equal(m.sha256,sha256(m.body));
  const parsed=JSON.parse(m.body);
  assert.equal(parsed.deletionAuthorized,false);
  assert.equal(parsed.nonDestructive,true);
  assert.equal(parsed.copiedRows,1);
  assert.equal(parsed.segments[0].sha256,s.sha256);
});
