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
  assert.match(persistBody, /env\.DB\.batch\(\[insert, audit\]\)/);
  assert.match(persistBody, /replayRecovered: true/);
  assert.match(persistBody, /partial: true/);
  assert.match(updateBody, /env\.DB\.batch\(\[update, audit\]\)/);
  assert.match(updateBody, /audit-write-failed/);
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
