import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read = name => readFile(new URL("../.github/workflows/"+name,import.meta.url),"utf8");
const files=["nba-team-profiles.yml","nba-prospective-shadow.yml","nba-official-availability.yml"];
test("NBA production workflows use the dedicated NBA D1 for sport-owned persistence",async()=>{
 for(const file of files){
  const yml=await read(file);
  assert.match(yml,/CLOUDFLARE_D1_DATABASE_ID:\s*ed992525-d2ed-4b1d-8a12-feeb2efa152c/,file);
  assert.match(yml,/d1-batched-sql\.mjs/,file);
  assert.doesNotMatch(yml,/wrangler d1 execute fbis --remote --file/,file);
  assert.doesNotMatch(yml,/FBIS_D1_TARGET:\s*fbis\s*$/m,file);
 }
 const profiles=await read(files[0]);
 assert.match(profiles,/FBIS_D1_TARGET:\s*fbis-nba/);
 assert.match(profiles,/wrangler d1 execute fbis-nba --remote --json --command/);
 const shadow=await read(files[1]);
 assert.match(shadow,/wrangler d1 execute fbis-nba --remote/);
 const availability=await read(files[2]);
 // Cross-sport availability observations are a shared PRIMARY dataset. Scoped reads are intentional.
 assert.match(availability,/CLOUDFLARE_D1_DATABASE_ID=b50c724c-903b-4241-8ce1-48d931e7a44c node scripts\/d1-batched-sql\.mjs artifacts\/nba-player-availability\.sql/);
});
test("retention gate never grants deletion based on key membership alone",async()=>{
 const cert=await readFile(new URL("../scripts/nba-source-key-certify.mjs",import.meta.url),"utf8");
 assert.match(cert,/retentionReleaseAuthorized:false/);
 assert.match(cert,/sourceRowsDeleted:0/);
 assert.match(cert,/deletionAuthorized:false/);
});
