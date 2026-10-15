import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/tennis-portrait-import.js";
import { TENNIS_COMMONS_PORTRAIT_BATCH } from "../functions/lib/tennisCommonsPortraitBatch.js";
import { verifiedTennisPortrait } from "../functions/lib/tennisPortraits.js";

const secret="test-private-harvest-key-valid-1234567890";
const choice=TENNIS_COMMONS_PORTRAIT_BATCH.find(c=>c.playerName==="Iga Swiatek");
const request=(id,token=secret)=>new Request("https://fbis.example/api/tennis-portrait-import",{
  method:"POST",headers:{"x-harvest-secret":token,"content-type":"application/json"},
  body:JSON.stringify({playerId:id})
});
const fixture=(license="CC BY-SA 4.0")=>({
  query:{pages:[{title:"File:"+choice.fileTitle,imageinfo:[{mime:"image/jpeg",thumburl:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/mock/720px-mock.jpg",extmetadata:{
    LicenseShortName:{value:license}, LicenseUrl:{value:choice.licenseUrl},
    Artist:{value:"<a>Hameltion</a>"}
  }}]}]}
});
const fbis=()=>{const saved={};let writes=0;return{
  saved,
  DB:{prepare(sql){return{bind(...args){return{
    async first(){if(sql.includes("FROM tennis_players"))return {fbis_player_id:choice.playerId,canonical_name:choice.playerName};if(sql.includes("FROM tennis_player_portraits"))return null;throw Error("unexpected first")},
    async run(){writes++;saved.args=args;return {meta:{changes:1}}}
  }}}}},
  ARCHIVE:{async put(key,bytes,opts){saved.key=key;saved.bytes=bytes.byteLength;saved.contentType=opts.httpMetadata.contentType}},
  get writes(){return writes}
}};
};
test("curated manifest never duplicates player IDs or permits unreviewed external URL inputs",()=>{
  assert.equal(TENNIS_COMMONS_PORTRAIT_BATCH.length,11);
  assert.equal(new Set(TENNIS_COMMONS_PORTRAIT_BATCH.map(c=>c.playerId)).size,11);
  for (const c of TENNIS_COMMONS_PORTRAIT_BATCH){
    assert.match(c.playerId,/^tennis:wta:\d+$/);
    assert.match(c.sourceUrl,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    assert.match(c.licenseUrl,/^https:\/\/creativecommons\.org\//);
  }
});
test("import is private; exact player and manually curated image are required",async()=>{
  const env=fbis();env.HARVEST_SECRET=secret;
  assert.equal((await onRequestPost({request:request(choice.playerId,"wrong"),env})).status,403);
  assert.equal((await onRequestPost({request:request("tennis:wta:impostor"),env})).status,404);
  const badDb={...env,DB:{prepare:()=>({bind:()=>({first:async()=>({fbis_player_id:choice.playerId,canonical_name:"Other Player"})})})}};
  assert.equal((await onRequestPost({request:request(choice.playerId),env:badDb})).status,409);
  assert.equal(env.writes,0);
});
test("Commons file/license/author verification must pass before R2 and D1 publication",async()=>{
  const realFetch=globalThis.fetch;
  try{
    const env=fbis();env.HARVEST_SECRET=secret;
    let calls=0;
    globalThis.fetch=async url=>{
      calls++;
      if(String(url).includes("api.php"))return new Response(JSON.stringify(fixture("CC BY-SA 3.0")),{status:200,headers:{"content-type":"application/json"}});
      throw Error("image should never download if license does not match");
    };
    const blocked=await onRequestPost({request:request(choice.playerId),env});
    assert.equal(blocked.status,409);
    assert.equal((await blocked.json()).reason,"COMMONS_LICENSE_MISMATCH");
    assert.equal(env.saved.key,undefined);
    assert.equal(env.writes,0);
    assert.equal(calls,1);
  }finally{globalThis.fetch=realFetch;}
});
test("legitimate Commons JPEG imports into one canonical R2 path and approved rights record",async()=>{
  const realFetch=globalThis.fetch;
  try{
    const env=fbis();env.HARVEST_SECRET=secret;
    const bytes=new Uint8Array(1024);bytes.set([255,216,255,224]);
    globalThis.fetch=async url=>String(url).includes("api.php")
      ?new Response(JSON.stringify(fixture()),{status:200,headers:{"content-type":"application/json"}})
      :new Response(bytes,{status:200,headers:{"content-type":"image/jpeg"}});
    const res=await onRequestPost({request:request(choice.playerId),env});
    assert.equal(res.status,200,await res.clone().text());
    assert.equal((await res.json()).status,"IMPORTED");
    assert.equal(env.saved.key,`tennis/portraits/${choice.playerId}/commons-curated-20261015.jpg`);
    assert.equal(env.saved.contentType,"image/jpeg");
    assert.equal(env.saved.bytes,1024);
    assert.equal(env.writes,1);
    assert.equal(env.saved.args[0],choice.playerId);
    assert.equal(env.saved.args[3],choice.sourceUrl);
    assert.equal(env.saved.args[4],`Photo: ${choice.author} · ${choice.license} · resized for FBIS`);
  }finally{globalThis.fetch=realFetch;}
});
test("real imported rights record satisfies display gate",()=>{
  const row={fbis_player_id:choice.playerId,asset_key:`tennis/portraits/${choice.playerId}/commons-curated-20261015.jpg`,
    content_type:"image/jpeg",approval_status:"APPROVED",public_display_allowed:1,display_scope:"PUBLIC_WEB",
    rights_evidence_ref:choice.licenseUrl,source_reference:choice.sourceUrl,
    approved_at:"2026-10-14T00:00:00Z",attribution_text:`Photo: ${choice.author} · ${choice.license} · resized for FBIS`};
  const approved=verifiedTennisPortrait(row);
  assert.equal(approved?.url,`/api/tennis-portrait?id=tennis%3Awta%3A326408`);
  assert.equal(approved?.sourceUrl,choice.sourceUrl);
  assert.equal(approved?.licenseUrl,choice.licenseUrl);
});
