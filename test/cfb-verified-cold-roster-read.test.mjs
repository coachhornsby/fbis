import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {loadVerifiedCfbColdRosterManifest,readVerifiedCfbColdRosterPage} from "../functions/lib/cfbColdRosterArchive.js";

const sha=s=>createHash("sha256").update(s).digest("hex");
const prefix="research/storage-recovery/cfb-roster-cold-pilot/2004/";
const db="b50c724c-903b-4241-8ce1-48d931e7a44c";
const records=[{__archive_rowid:"1",id:"obs1",season:2004,content_hash:"a".repeat(64),payload_json:'{"name":"O\'Brien"}',can_influence_projection:0},
  {__archive_rowid:"3",id:"obs2",season:2004,content_hash:"b".repeat(64),payload_json:'{"text":"🏈"}',can_influence_projection:0},
  {__archive_rowid:"9",id:"obs3",season:2004,content_hash:"c".repeat(64),payload_json:'{"tier":"historical"}',can_influence_projection:0}];
function fixture({alter,alterSegment,missing,manifestKey}={}){
  const objects=new Map();
  const segments=[];
  for(const [i,segmentRows] of [[0,records.slice(0,2)],[1,records.slice(2)]]){
    const first=segmentRows[0].__archive_rowid,last=segmentRows.at(-1).__archive_rowid;
    let document={format:"fbis-cold-roster-pilot-v1",sourceDb:db,table:"cfb_roster_observations",season:2004,frozenUpperRowid:"9",
      firstRowid:first,lastRowid:last,count:segmentRows.length,rows:segmentRows};
    if(alterSegment && i===0)document=alterSegment(document);
    const body=JSON.stringify(document)+"\n",digest=sha(body),key=prefix+"part-"+first+"-"+last+"-"+digest+".json";
    objects.set(key,body);
    segments.push({key,sha256:digest,bytes:Buffer.byteLength(body),count:segmentRows.length,firstRowid:first,lastRowid:last});
  }
  let manifest={format:"fbis-cfb-roster-full-season-v1",sourceDatabaseId:db,sourceTable:"cfb_roster_observations",season:2004,sourceSeasonTotal:3,
    sourceFirstRowid:"1",sourceUpperRowid:"9",archivedRows:3,segments,readbackSha256Verified:true,
    independentD1RecordParity:true,stableSourceBounds:true,modelAuthority:false,canInfluenceProjection:false,
    canQualify:false,canAuthorizeWager:false,sourceRowsDeleted:0,retentionReleaseAuthorized:false};
  if(alter)manifest=alter(manifest);
  const body=JSON.stringify(manifest)+"\n",key=manifestKey||prefix+"full-season-manifest-"+sha(body)+".json";
  objects.set(key,body);
  if(missing)objects.delete(missing==="segment"?segments[0].key:key);
  let writes=0, reads=0;
  const env={ARCHIVE:{
    async get(k){reads++;const value=objects.get(k);return value===undefined?null:{size:Buffer.byteLength(value),async text(){return value}};},
    async put(){writes++;throw Error("ARCHIVE_WRITES_DISALLOWED")},
    async delete(){writes++;throw Error("ARCHIVE_DELETES_DISALLOWED")},
  }};
  return {env,key,segments,objects,stats(){return {reads,writes}}};
}
test("exact reconstructed archived rows and source-only permissions", async()=>{
  const {env,key,stats}=fixture();
  const manifest=await loadVerifiedCfbColdRosterManifest(env,2004,key);
  assert.equal(manifest.sourceSeasonTotal,3);
  const a=await readVerifiedCfbColdRosterPage(env,{season:2004,manifestKey:key,limit:2});
  assert.deepEqual(a.rows,records.slice(0,2));
  assert.equal(a.nextRowid,"3");
  assert.equal(a.hasMore,true);
  assert.equal(a.researchOnly,true);
  assert.equal(a.canAuthorizeWager,false);
  assert.equal(a.canInfluenceProjection,false);
  assert.equal(a.productionD1Reads,0);
  const b=await readVerifiedCfbColdRosterPage(env,{season:2004,manifestKey:key,afterRowid:3,limit:2});
  assert.deepEqual(b.rows,records.slice(2));
  assert.equal(b.hasMore,false);
  assert.equal(stats().writes,0);
});
test("R2 omission fails closed, not fake empty roster",async()=>{
  const f=fixture({missing:"segment"});
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key}),/OBJECT_NOT_FOUND/);
});
test("corrupted R2 segment never silently supplies records",async()=>{
  const f=fixture();
  f.objects.set(f.segments[0].key,f.objects.get(f.segments[0].key).replace("obs1","fake"));
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key}),/SHA256_MISMATCH/);
});
test("manifest cannot claim full season if its count disagrees",async()=>{
  const f=fixture({alter:m=>({...m,sourceSeasonTotal:4})});
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key}),/SEASON_COUNT_MISMATCH/);
});
test("manifest cannot omit its independent D1 record parity proof",async()=>{
  const f=fixture({alter:m=>({...m,independentD1RecordParity:false})});
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key}),/MANIFEST_NOT_QUALIFIED/);
});
test("manifest cannot admit overlapping rowid ranges",async()=>{
  const f=fixture({alter:m=>({...m,segments:[m.segments[0],{...m.segments[1],firstRowid:"3"}]})});
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key}),/SEGMENT_OVERLAP_OR_REORDER/);
});
test("manifest and segment sources cannot become decision authoritative",async()=>{
  const f=fixture({alter:m=>({...m,canInfluenceProjection:true})});
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key}),/MANIFEST_NOT_QUALIFIED/);
  const p=fixture({alterSegment:s=>({...s,season:2026})});
  await assert.rejects(readVerifiedCfbColdRosterPage(p.env,{manifestKey:p.key}),/SEGMENT_CONTENT_SCOPE/);
});
test("reader refuses fabricated seasons, invalid page limits and untrusted key prefixes",async()=>{
  const f=fixture();
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{season:2026,manifestKey:f.key}),/INVALID_NUMBER/);
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:f.key,limit:300}),/INVALID_NUMBER/);
  await assert.rejects(readVerifiedCfbColdRosterPage(f.env,{manifestKey:"private/users/"+sha("bad")+".json"}),/MANIFEST_KEY_OUT_OF_SCOPE/);
});
