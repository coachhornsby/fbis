import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveNbaResearchOwnerDb } from "../functions/lib/nbaResearchOwnerDb.js";
import { onRequestGet as gate } from "../functions/api/nba-prospective-gate.js";
import { onRequestGet as props } from "../functions/api/nba-shadow-props.js";

const primary = { prepare() { throw new Error("PRIMARY_RESEARCH_READ_FORBIDDEN_IN_SPORT_MODE"); } };
const shard = { prepare() { return { all: async () => ({ results: [] }), first: async () => null }; } };
function core(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /fbis_sport_cutover_approvals/);
      return {
        bind(sport) {
          assert.equal(sport, "nba");
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  };
}
const base = {
  DB: primary,
  NBA_DB: shard,
  CORE_DB: core([]),
  SPORT_DB_MODE_NBA: "sport",
  SPORT_DB_STRICT_NBA: "1",
  SPORT_DB_LEDGER_READY_NBA: "1",
};

test("shadow mode retains PRIMARY as canonical NBA research owner", async () => {
  const result = await resolveNbaResearchOwnerDb({ ...base, SPORT_DB_MODE_NBA: "shadow" });
  assert.equal(result.ok, true);
  assert.equal(result.db, primary);
  assert.equal(result.binding, "DB");
  assert.equal(result.canAuthorizeWager, false);
});

test("strict sport mode requires matching CORE approval rather than accepting env receipts", async () => {
  const noReceipt = await resolveNbaResearchOwnerDb(base);
  assert.equal(noReceipt.ok, false);
  assert.equal(noReceipt.db, null);
  const noApproval = await resolveNbaResearchOwnerDb({ ...base, SPORT_CUTOVER_RECEIPT_NBA: "nba-approval-1" });
  assert.equal(noApproval.ok, false);
  assert.equal(noApproval.db, null);
});

test("CORE-approved NBA receipt routes exclusively to NBA_DB; a revoked grant blocks PRIMARY fallback", async () => {
  const approved = { receipt_id: "nba-approval-1", sport: "nba", status: "APPROVED", approved_at: "2026-10-23T12:00:00Z", expires_at: null, revoked_at: null };
  const env = { ...base, CORE_DB: core([approved]), SPORT_CUTOVER_RECEIPT_NBA: approved.receipt_id };
  const result = await resolveNbaResearchOwnerDb(env);
  assert.equal(result.ok, true);
  assert.equal(result.db, shard);
  assert.equal(result.binding, "NBA_DB");
  assert.equal(result.canAuthorizeWager, false);
  assert.notEqual(result.env, env);
  const revoked = await resolveNbaResearchOwnerDb({ ...env, CORE_DB: core([]),
    __fbisCutoverApprovals: new Map([["nba:nba-approval-1", approved]]) });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.db, null);
  const missingBinding = await resolveNbaResearchOwnerDb({ ...env, NBA_DB: null });
  assert.equal(missingBinding.ok, false);
  for (const overrides of [{ SPORT_DB_STRICT_NBA: null }, { SPORT_DB_LEDGER_READY_NBA: null }]) {
    const unauthorized = await resolveNbaResearchOwnerDb({ ...env, ...overrides });
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.db, null);
    assert.equal(unauthorized.reason, "NBA_STRICT_LEDGER_READINESS_REQUIRED");
  }
});

test("NBA routes return 503 without approval, never query PRIMARY after attempted sport activation", async () => {
  for (const endpoint of [gate, props]) {
    const response = await endpoint({ env: { ...base, SPORT_CUTOVER_RECEIPT_NBA: "not-approved" } });
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.ok, false);
  }
});

test("all core NBA public readers hydrate owner before querying research", () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../functions/lib/slateEngine.js"), /await resolveNbaResearchOwnerDb\(env\)/);
  assert.match(source("../functions/lib/slateEngine.js"), /owner\.mode === "sport"/);
  assert.match(source("../functions/lib/nbaSdvHistoryShadow.js"), /owner\.db\.prepare/);
  assert.match(source("../functions/api/nba-prospective-gate.js"), /resolveNbaProspectiveGate\(owner\.db\)/);
  assert.match(source("../functions/api/nba-shadow-props.js"), /owner\.db\.prepare/);
});
