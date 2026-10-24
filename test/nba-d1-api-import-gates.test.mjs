import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const names=[
 "nba-official-availability.yml","nba-player-impact-shadow-grade.yml",
 "nba-deep-v2-grade.yml","nba-team-profiles.yml","nba-prospective-shadow.yml",
 "nba-market-evaluator.yml"];
test("NBA scheduled imports use bounded D1 query API against NBA_DB, not Wrangler bulk import",()=>{
 let count=0;
 for(const name of names){
  const s=readFileSync(new URL("../.github/workflows/"+name,import.meta.url),"utf8");
  assert.match(s,/CLOUDFLARE_D1_DATABASE_ID: ed992525-d2ed-4b1d-8a12-feeb2efa152c/,name);
  assert.match(s,/D1_SQL_ATTEMPTS: "1"/,name);
  assert.match(s,/nba-d1-profile-shadow-main/,name);
  assert.doesNotMatch(s,/wrangler d1 execute fbis-nba --remote --file=/,name);
  assert.doesNotMatch(s,/node scripts\/d1-import-lock-retry.mjs /,name);
  const local=(s.match(/node scripts\/d1-batched-sql.mjs /g)||[]).length;
  assert.ok(local>=2,name+" missing API import writes");
  count+=local;
 }
 assert.ok(count>=29,"expected NBA import replacements");
});
test("provider feeds remain in shared PRIMARY where intended",()=>{
 const s=readFileSync(new URL("../.github/workflows/nba-market-evaluator.yml",import.meta.url),"utf8");
 assert.match(s,/wrangler d1 execute fbis --remote --json --command[\s\S]*action_market_book_observations/);
});
