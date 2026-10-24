import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const script=readFileSync(new URL("../scripts/nba-primary-source-key-coverage.mjs",import.meta.url),"utf8");
const cert=readFileSync(new URL("../scripts/nba-source-key-certify.mjs",import.meta.url),"utf8");
const workflow=readFileSync(new URL("../.github/workflows/nba-primary-key-coverage.yml",import.meta.url),"utf8");
test("source membership audit has source-D1 read-only query contract",()=>{
 assert.match(script,/const primary="b50c724c-903b-4241-8ce1-48d931e7a44c"/);
 assert.match(script,/const nba="ed992525-d2ed-4b1d-8a12-feeb2efa152c"/);
 assert.match(script,/SELECT .*source_key FROM/);
 assert.match(script,/sourceCoverageVerified/);
 assert.match(script,/LIMIT 40/);
 assert.match(script,/sourceRowsDeleted:0/);
 assert.match(script,/sourceDbMutations:0/);
 assert.doesNotMatch(script,/(DELETE FROM|DROP TABLE|INSERT INTO|UPDATE .* SET)/i);
});
test("six audit shards require 31 fully covered prefixed tables",()=>{
 assert.match(workflow,/shard: \[0,1,2,3,4,5\]/);
 assert.match(workflow,/node scripts\/nba-primary-source-key-coverage.mjs/);
 assert.match(workflow,/node scripts\/nba-source-key-certify.mjs/);
 assert.match(cert,/seen.size!==31/);
 assert.match(cert,/row.missingSourceKeys!==0/);
 assert.match(cert,/retentionReleaseAuthorized:false/);
});
