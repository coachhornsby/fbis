import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadFbsTeamDirectory } from "../functions/api/cfb-teams.js";

function db() {
 const queries=[];
 return {queries,prepare(sql) {
  return {bind(){return this;},async all(){queries.push(sql);return {results:[]};},
    async first(){queries.push(sql);return null}};
 }};
}
test("CFB team list reads canonical directory from CFB_DB, not PRIMARY",async()=>{
 const primary=db(),sport=db();
 const res=await loadFbsTeamDirectory(primary,null,{sportDb:sport});
 assert.equal(res.status,200);
 assert.equal(primary.queries.length,0);
 assert.equal(sport.queries.length,1);
 assert.match(sport.queries[0],/cfb_canonical_teams/);
});
test("CFB sport D1 unavailable causes team page to fail closed",async()=>{
 const res=await loadFbsTeamDirectory(db(),null,{sportDb:{prepare:null}});
 assert.equal(res.status,503);
});
test("Shared team-stat snapshots stay on PRIMARY while roster and schedule are sport-owned",()=>{
 const api=readFileSync(new URL("../functions/api/cfb-teams.js",import.meta.url),"utf8");
 const evidence=readFileSync(new URL("../functions/lib/cfbTeamSeasonEvidence.js",import.meta.url),"utf8");
 assert.match(api,/optionalTeamFeatures\(db,/);
 assert.match(api,/optionalTeamForm\(sportDb,/);
 assert.match(api,/loadFbsTeamSeasonEvidence\(db,team,season,playerId,\{sportDb\}\)/);
 assert.match(evidence,/optionally\(sportDb,"SELECT m\.player_id/);
 assert.match(evidence,/optionally\(db,"SELECT metrics_json/);
});
