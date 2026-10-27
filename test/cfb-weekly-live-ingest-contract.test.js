import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const workflow=readFileSync(".github/workflows/cfb-weekly-live-ingest.yml","utf8");
test("licensed pregame CSV goes through canonical private Tier 3 and is read back",()=>{
 assert.match(workflow,/\/api\/college-tier3/);
 assert.match(workflow,/fbis-cfb-tier3-research/);
 assert.match(workflow,/CANONICAL_TIER3_RECEIPT_MISMATCH/);
 assert.match(workflow,/PRIVATE_TIER3_CANONICAL_READBACK_MISMATCH/);
 assert.match(workflow,/x-harvest-secret/);
 assert.match(workflow,/sourceSha256/);
});
test("proprietary rows and generated feature SQL are excluded from GitHub artifacts",()=>{
 const final=workflow.slice(workflow.indexOf("name: Publish acceptance evidence"));
 assert.match(final,/path: \|\n/);
 assert.doesNotMatch(final,/path: artifacts\/cfb-incoming\/\s*(\n|$)/);
 assert.doesNotMatch(final,/artifacts\/cfb-incoming\/source\.csv/);
 assert.doesNotMatch(final,/artifacts\/cfb-incoming\/shadow-research\.sql/);
});
test("intake remains fail-closed on missing original or post-kickoff source",()=>{
 assert.match(workflow,/SOURCE_NOT_YET_PRESENT/);
 assert.match(workflow,/cfb-weekly-source-ingest\.mjs/);
 assert.match(workflow,/--observed-at/);
 assert.match(workflow,/CFB_SHADOW_SOURCE_ROW_COUNT_MISMATCH/);
});
