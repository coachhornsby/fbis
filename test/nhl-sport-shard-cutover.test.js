import test from "node:test";
import assert from "node:assert/strict";
import { snapshotProjectionParity, cutoverGate, nhlDurableDatabase } from "../functions/lib/nhlSportShard.js";
import { loadDurableTodayGames } from "../functions/lib/todayDurableFallback.js";

const row = (id, extra = {}) => ({
  id,
  checkpoint: "CLOSE",
  date: "2026-10-18",
  engine: "NHL-PRO-v2",
  proj_home: 3.4,
  proj_away: 2.8,
  proj_total: 6.2,
  p_home_final: 0.5531,
  actual_home: 2,
  actual_away: 1,
  ...extra,
});

test("projection parity requires every snapshot and refuses a rewritten projection", () => {
  const primary = [row("a"), row("b")];
  assert.equal(snapshotProjectionParity(primary, [row("a"), row("b")]).ok, true);
  const rewritten = snapshotProjectionParity(primary, [row("a"), row("b", { proj_home: 9 })]);
  assert.equal(rewritten.ok, false);
  assert.equal(rewritten.diverged[0].fields.includes("proj_home"), true);
  assert.equal(snapshotProjectionParity(primary, [row("a")]).ok, false);
});

test("the cutover stays on primary unless parity passed and permissions were not touched", () => {
  const ready = { status: "CUTOVER_READY", permissionsChanged: false, projectionFieldsRewritten: false };
  assert.equal(cutoverGate({ bindingPresent: false, receipt: ready, projectionParity: { ok: true } }).database, "PRIMARY");
  assert.equal(cutoverGate({ bindingPresent: true, receipt: ready, projectionParity: { ok: false } }).reason, "PROJECTION_PARITY_FAILED");
  assert.equal(cutoverGate({ bindingPresent: true, receipt: { ...ready, permissionsChanged: true }, projectionParity: { ok: true } }).reason, "PERMISSION_CHANGE_BLOCKED");
  assert.equal(cutoverGate({ bindingPresent: true, receipt: { ...ready, projectionFieldsRewritten: true }, projectionParity: { ok: true } }).reason, "PROJECTION_REWRITE_BLOCKED");
  const armed = cutoverGate({ bindingPresent: true, receipt: ready, projectionParity: { ok: true } });
  assert.equal(armed.database, "NHL_DB");
  assert.equal(armed.canQualify, false);
  assert.equal(armed.canAuthorizeWager, false);
});

function db(rows, { receipt = null, fail = false } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          return receipt;
        },
        async all() {
          if (fail) throw Error("SHARD_UNAVAILABLE");
          return { results: rows };
        },
      };
    },
  };
}

const gameRow = {
  id: "401892533", sport: "nhl", date: "2026-10-18", start: "2026-10-18T23:00:00Z",
  home_name: "Minnesota Wild", away_name: "Columbus Blue Jackets", home_abbr: "MIN", away_abbr: "CBJ",
  frozen_at: "2026-10-18T18:00:00Z", proj_home: 3.4, proj_away: 3.2, engine: "NHL-PRO-v2",
  model_version: "research-v2.0-event-chain-gbdt", rn: 1,
};

test("an NHL durable read uses the shard only with an armed receipt and never authorizes a wager", async () => {
  const primary = db([{ ...gameRow, proj_home: 1 }]);
  const receipt = {
    status: "CUTOVER_READY",
    detail_json: JSON.stringify({ projectionParityOk: true, permissionsChanged: false, projectionFieldsRewritten: false }),
  };
  const shard = db([gameRow], { receipt });
  const out = await loadDurableTodayGames({ DB: primary, NHL_DB: shard }, "2026-10-18", "nhl", { now: Date.parse("2026-10-18T20:00:00Z") });
  assert.equal(out.source, "NHL_DB_DURABLE_CUTOVER");
  assert.equal(out.canQualify, false);
  assert.equal(out.canAuthorizeWager, false);
  assert.equal(out.games[0].canAuthorizeWager, false);
  assert.equal(out.games[0].model.projHome, 3.4);
});

test("a shard failure and an all-sports request both stay on primary", async () => {
  const primary = db([gameRow]);
  const receipt = { status: "CUTOVER_READY", detail_json: JSON.stringify({ projectionParityOk: true, permissionsChanged: false }) };
  const shard = db([], { receipt, fail: true });
  const fallen = await loadDurableTodayGames({ DB: primary, NHL_DB: shard }, "2026-10-18", "nhl", { now: Date.parse("2026-10-18T20:00:00Z") });
  assert.equal(fallen.source, "D1_SCHEDULE_PRESTART_SNAPSHOT");
  assert.equal(fallen.games[0].model.projHome, 3.4);
  const all = await loadDurableTodayGames({ DB: primary, NHL_DB: shard }, "2026-10-18", "all", { now: Date.parse("2026-10-18T20:00:00Z") });
  assert.equal(all.source, "D1_SCHEDULE_PRESTART_SNAPSHOT");
});

test("the receipt reader refuses a shard that has not proven projection parity", async () => {
  const env = { DB: db([]), NHL_DB: db([], { receipt: { status: "CUTOVER_READY", detail_json: "{}" } }) };
  const decision = await nhlDurableDatabase(env);
  assert.equal(decision.database, "PRIMARY");
  assert.equal(decision.reason, "PROJECTION_PARITY_FAILED");
});
