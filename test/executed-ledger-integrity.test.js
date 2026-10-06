import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("executed-bet writes couple financial mutation and audit in D1 batch", async () => {
  const store = await readFile(new URL("../functions/lib/store.js", import.meta.url), "utf8");
  const start = store.indexOf("export async function persistExecutedBet");
  const update = store.indexOf("export async function updateExecutedBet");
  const query = store.indexOf("export async function queryExecutedBets");
  const append = store.indexOf("export async function appendExecutedBetAudit");
  const persistBody = store.slice(start, query);
  const updateBody = store.slice(update, append);
  assert.match(persistBody, /atomic-batch-required/);
  assert.match(persistBody, /env\.DB\.batch\(\[insert, audit\]\)/);
  assert.match(persistBody, /replayRecovered: true/);
  assert.doesNotMatch(persistBody, /partial: true/);
  assert.match(updateBody, /atomic-batch-required/);
  assert.match(updateBody, /env\.DB\.batch\(\[update, audit\]\)/);
  assert.match(updateBody, /state-precondition-failed/);
  assert.match(updateBody, /WHERE changes\(\) > 0/);
  assert.doesNotMatch(updateBody, /partial: true/);
});

test("executed-bet schema has deterministic execution identity", async () => {
  const migration = await readFile(new URL("../migrations/0007_executed_bets.sql", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE\s*\(execution_book,\s*external_ticket_id\)/i);
});


test("future-grade cleanup uses audited executed-bet mutation path", async () => {
  const track = await readFile(new URL("../functions/api/track.js", import.meta.url), "utf8");
  const start = track.indexOf("async function cleanupFutureGrades");
  const end = track.indexOf("async function cleanupCrossDateStrategy", start);
  const body = track.slice(start, end);
  assert.match(body, /updateExecutedBet\(/);
  assert.match(body, /future-grade-cleanup/);
  assert.doesNotMatch(body, /UPDATE executed_bets/);
});


test("historical audit backfill is idempotent and does not mutate wagers", async () => {
  const migration = await readFile(new URL("../migrations/0087_executed_bet_audit_backfill.sql", import.meta.url), "utf8");
  assert.match(migration, /historical-audit-backfill/);
  assert.match(migration, /NOT EXISTS/);
  assert.match(migration, /0087_executed_bet_audit_backfill/);
  assert.doesNotMatch(migration, /UPDATE\s+executed_bets/i);
  assert.doesNotMatch(migration, /DELETE\s+FROM\s+executed_bets/i);
});


test("tracker sync compares structured metadata by value, not object identity", async () => {
  const bets = await readFile(new URL("../functions/api/bets.js", import.meta.url), "utf8");
  assert.match(bets, /function trackerFieldEqual/);
  assert.match(bets, /JSON\.stringify\(left\) === JSON\.stringify\(right\)/);
  assert.match(bets, /!trackerFieldEqual\(existing\?\.\[k\]/);
  assert.doesNotMatch(bets, /Object\.entries\(patch\)\.some\(\(\[k,v\]\) => \(existing\?\.\[k\] \?\? null\) !== \(v \?\? null\)\)/);
});


test("settlement callers use OPEN compare-and-set and tracker cannot reopen settled wagers", async () => {
  const bets = await readFile(new URL("../functions/api/bets.js", import.meta.url), "utf8");
  const track = await readFile(new URL("../functions/api/track.js", import.meta.url), "utf8");
  const ledger = await readFile(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8");
  assert.match(bets, /settledExisting \? existing\.result/);
  assert.match(bets, /expectedResult: existing\.result \|\| "OPEN"/);
  assert.match(bets, /manual-player-prop-stat", \{ expectedResult: "OPEN" \}/);
  assert.match(track, /"manual-final-score",[\s\S]*expectedResult: "OPEN"/);
  assert.match(ledger, /alreadySettled && changed\) continue/);
  assert.match(ledger, /expectedResult: alreadySettled \? t\.result : "OPEN"/);
});


test("tracker replay preserves ledgered executedAt while still checking financial execution fields", async () => {
  const bets = await readFile(new URL("../functions/api/bets.js", import.meta.url), "utf8");
  assert.match(bets, /function trackerImmutableConflictFields/);
  assert.match(bets, /executionLine/);
  assert.match(bets, /executionPrice/);
  assert.match(bets, /riskAmount/);
  assert.match(bets, /trackerReplayPreservedExecutedAt:true/);
  const helperStart = bets.indexOf("function trackerImmutableConflictFields");
  const helperEnd = bets.indexOf("export async function syncTrackerBets", helperStart);
  const helper = bets.slice(helperStart, helperEnd);
  assert.doesNotMatch(helper, /executedAt/);
});

test("tracker workflow fails once on deterministic D1 conflict instead of retrying to token expiry", async () => {
  const workflow = await readFile(new URL("../.github/workflows/bet-tracker-reconcile.yml", import.meta.url), "utf8");
  assert.match(workflow, /Deterministic tracker conflict; failing once without retry/);
  assert.match(workflow, /contains\("http=409"\)/);
});
