import test from "node:test";
import assert from "node:assert/strict";
import { tennisPortraitUrl, verifiedTennisPortrait, approvedTennisPortraits } from "../functions/lib/tennisPortraits.js";
import { onRequestGet as portraitGet } from "../functions/api/tennis-portrait.js";
import { onRequestGet as profileGet } from "../functions/api/tennis-player-profile.js";

const id="tennis:wta:12345";
const photo={
  fbis_player_id:id, asset_key:`tennis/portraits/${id}/licensed.webp`,
  content_type:"image/webp", source_name:"Rights-cleared test",
  source_reference:"test-asset-1", display_scope:"PUBLIC_WEB",
  approval_status:"APPROVED", public_display_allowed:1,
  rights_evidence_ref:"test-license-approval", approved_at:"2026-01-01T00:00:00Z",
  attribution_text:"Approved portrait credit", expires_at:null,
};
const player={fbis_player_id:id,tour:"wta",canonical_name:"Test Player",normalized_name:"test player",country_code:"US"};
const db=(row=photo)=>({prepare(sql){return{bind(...args){return{
  async first(){if(sql.includes("FROM tennis_players"))return player;return null},
  async all(){if(sql.includes("FROM tennis_player_portraits"))return {results:row?[row]:[]};return {results:[]}}
}}}}});
test("portraits require exact canonical identity, R2 path, public display grant and unexpired evidence",()=>{
  assert.equal(tennisPortraitUrl(id),`/api/tennis-portrait?id=tennis%3Awta%3A12345`);
  assert.equal(verifiedTennisPortrait(photo)?.url,tennisPortraitUrl(id));
  for (const bad of [
    {approval_status:"PENDING"},{approval_status:"REVOKED"},
    {public_display_allowed:0},{display_scope:"PRIVATE_ONLY"},
    {rights_evidence_ref:null},{approved_at:null},
    {expires_at:"2026-02-01T00:00:00Z"},
    {asset_key:"tennis/portraits/tennis:wta:wrong/licensed.webp"},
    {asset_key:"https://www.atptour.com/unlicensed.webp"},
    {asset_key:`tennis/portraits/${id}/vector.svg`},
    {content_type:"image/svg+xml"},
  ])assert.equal(verifiedTennisPortrait({...photo,...bad}),null,JSON.stringify(bad));
});
test("approved lookup exposes no image without verified license or when migration unavailable",async()=>{
  assert.equal((await approvedTennisPortraits(db(),[id])).get(id).url,tennisPortraitUrl(id));
  assert.equal((await approvedTennisPortraits(db({...photo,display_scope:"PRIVATE_ONLY"}),[id])).size,0);
  const missing={prepare(){throw new Error("no such table: tennis_player_portraits")}};
  assert.equal((await approvedTennisPortraits(missing,[id])).size,0);
});
test("same-origin endpoint serves only approved R2 imagery with safe media headers",async()=>{
  let key;
  const archive={get:async k=>{key=k;return{body:new Uint8Array([1,2,3]),size:3,httpMetadata:{contentType:"image/webp"},httpEtag:'"abc"'}}};
  const request=new Request("https://fbis.test/api/tennis-portrait?id="+encodeURIComponent(id));
  const ok=await portraitGet({request,env:{DB:db(),ARCHIVE:archive}});
  assert.equal(ok.status,200);
  assert.equal(key,photo.asset_key);
  assert.equal(ok.headers.get("content-type"),"image/webp");
  assert.equal(ok.headers.get("cross-origin-resource-policy"),"same-origin");
  assert.equal(ok.headers.get("x-content-type-options"),"nosniff");
  const denied=await portraitGet({request,env:{DB:db({...photo,approval_status:"PENDING"}),ARCHIVE:archive}});
  assert.equal(denied.status,404);
  const expired=await portraitGet({request,env:{DB:db({...photo,expires_at:"2026-02-01T00:00:00Z"}),ARCHIVE:archive}});
  assert.equal(expired.status,404);
  assert.equal((await portraitGet({request:new Request("https://fbis.test/api/tennis-portrait?id=%3Cbad%3E"),env:{DB:db(),ARCHIVE:archive}})).status,400);
  const wrongType=await portraitGet({request,env:{DB:db(),ARCHIVE:{get:async()=>({body:new Uint8Array([1]),size:1,httpMetadata:{contentType:"text/html"}})}}});
  assert.equal(wrongType.status,404);
});
test("canonical player research shares the licensed portrait endpoint without remote image URLs",async()=>{
  const res=await profileGet({request:new Request("https://fbis.test/api/tennis-player-profile?id="+encodeURIComponent(id)),env:{DB:db()}});
  assert.equal(res.status,200);
  const html=await res.text();
  assert.match(html,/approved player portrait/);
  assert.match(html,/\/api\/tennis-portrait\?id=tennis%3Awta%3A12345/);
  assert.match(html,/Approved portrait credit/);
  assert.match(res.headers.get("content-security-policy"),/img-src 'self'/);
  const denied=await profileGet({request:new Request("https://fbis.test/api/tennis-player-profile?id="+encodeURIComponent(id)),env:{DB:db({...photo,public_display_allowed:0})}});
  assert.doesNotMatch(await denied.text(),/<img/);
});
