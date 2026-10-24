import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveD1ImportTarget } from "../scripts/d1-import-lock-retry.mjs";

const workflows=[
 "nba-official-availability.yml",
 "nba-team-profiles.yml",
 "nba-prospective-shadow.yml",
 "nba-deep-v2-grade.yml",
 "nba-player-impact-shadow-grade.yml",
 "nba-market-evaluator.yml",
];
const file=name=>readFileSync(new URL("../.github/workflows/"+name,import.meta.url),"utf8");
test("scheduled sport-owned NBA imports never default to PRIMARY",()=>{
 assert.equal(resolveD1ImportTarget({FBIS_D1_TARGET:"fbis-nba"}),"fbis-nba");
 assert.equal(resolveD1ImportTarget({}),"fbis");
 assert.throws(()=>resolveD1ImportTarget({FBIS_D1_TARGET:"other"}),/NOT_ALLOWLISTED/);
 const source=readFileSync(new URL("../scripts/d1-import-lock-retry.mjs",import.meta.url),"utf8");
 assert.match(source,/resolveD1ImportTarget\(\),"--remote"/);
 const team=file("nba-team-profiles.yml");
 const prospective=file("nba-prospective-shadow.yml");
 assert.match(team,/FBIS_D1_TARGET: fbis-nba/);
 assert.match(team,/CLOUDFLARE_D1_DATABASE_ID: ed992525-d2ed-4b1d-8a12-feeb2efa152c/);
 assert.match(prospective,/FBIS_D1_TARGET: fbis-nba/);
 const evaluator=file("nba-market-evaluator.yml");
 assert.match(evaluator,/CLOUDFLARE_D1_DATABASE_ID: ed992525-d2ed-4b1d-8a12-feeb2efa152c/);
});
test("direct old PRIMARY D1 lines in NBA workflows read only independently owned shared-market inputs",()=>{
 let allowed=0,isolated=0;
 for(const name of workflows){
  const content=file(name);
  for(const line of content.split("\n")){
   if(line.includes("npx wrangler d1 execute fbis --remote")){
    assert.match(line,/player_availability_observations|prizepicks_prop_lines|action_market_book_observations/,
      name+" must not send NBA sport-owned data to PRIMARY");
    allowed++;
   }
   if(line.includes("npx wrangler d1 execute fbis-nba --remote"))isolated++;
  }
 }
 assert.ok(allowed>=3,"shared provider/availability observations must remain separately sourced");
 assert.ok(isolated>=24,"sport-owned NBA SQL reads and writes must resolve to NBA_DB");
});
test("profile recovery fails over to NBA_DB and not stale PRIMARY",()=>{
 const s=readFileSync(new URL("../scripts/nba-profile-persistence-verify.mjs",import.meta.url),"utf8");
 assert.match(s,/resolveD1ImportTarget\(\),"--remote","--json"/);
});

test("all production NBA scheduled import jobs share exclusive D1 writer concurrency",()=>{
 for(const name of [
  "nba-team-profiles.yml","nba-prospective-shadow.yml",
  "nba-official-availability.yml","nba-player-impact-shadow-grade.yml",
  "nba-deep-v2-grade.yml","nba-market-evaluator.yml"
 ]){
  const content=file(name);
  assert.match(content,/nba-d1-profile-shadow-main/,name);
  assert.match(content,/cancel-in-progress: false/,name);
 }
});
