import test from "node:test";
import assert from "node:assert/strict";
import { listNflResearchPublications, recordNflPublicationEvent } from "../functions/lib/nflPregamePublication.js";

function db(label) {
  const calls=[];
  return { calls, prepare(sql) {
    calls.push({label,sql});
    return {bind(){return this;}, async all(){return {results:[]};},async run(){return {meta:{changes:1}};}};
  }};
}
test("NFL research reads and event writes stay on PRIMARY in shadow mode", async()=>{
  const primary=db("primary"),sport=db("sport");
  const env={DB:primary,NFL_DB:sport,SPORT_DB_MODE_NFL:"shadow"};
  await listNflResearchPublications(env,{date:"2026-10-21"});
  await recordNflPublicationEvent(env,{eventId:"fixture"});
  assert.equal(primary.calls.length,2);
  assert.equal(sport.calls.length,0);
});
test("Unapproved NFL sport mode cannot divert research writes",async()=>{
  const primary=db("primary"),sport=db("sport");
  const env={DB:primary,NFL_DB:sport,SPORT_DB_MODE_NFL:"sport",SPORT_CUTOVER_RECEIPT_NFL:"unapproved"};
  await recordNflPublicationEvent(env,{eventId:"fixture"});
  assert.equal(primary.calls.length,1);
  assert.equal(sport.calls.length,0);
});
