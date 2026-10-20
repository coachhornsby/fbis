import test from "node:test";
import assert from "node:assert/strict";
import { buildCapacityOpsDashboard, CAPACITY_OPS_DASHBOARD_CONTRACT } from "../functions/lib/capacityOpsDashboard.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

test("capacity ops dashboard contract is read-only and never authorizes deletes", async () => {
  const env = {
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() { return { n: 0 }; },
          async all() { return { meta: { size_after: 8_120_000_000 }, results: [] }; },
        };
      },
    },
    MARKET_HISTORY_2026Q4_DB: {
      prepare(sql) {
        const s = String(sql);
        return {
          bind() { return this; },
          async first() {
            if (s.includes("fbis_market_history_archive_checkpoint")) {
              return {
                last_collected_at: "2026-10-20T10:00:00.000Z",
                last_id: "x",
                archived_total: 27525,
                last_batch_at: "2026-10-20T11:00:00.000Z",
                last_backlog: 350000,
              };
            }
            return { n: 100 };
          },
          async all() {
            return {
              meta: { size_after: 1_600_000_000 },
              results: [{ hour: "2026-10-20T15", n: 80000 }],
            };
          },
        };
      },
    },
  };

  const dash = await buildCapacityOpsDashboard(env, { now: new Date("2026-10-20T15:30:00Z") });
  assert.equal(dash.contract, CAPACITY_OPS_DASHBOARD_CONTRACT);
  assert.equal(dash.canAuthorizeWager, false);
  assert.equal(dash.storage.q4.archive.deletionAuthorized, false);
  assert.equal(dash.storage.q4.archive.storageReclaimedBytes, 0);
  assert.equal(dash.storage.q4.archive.archivedTotal, 27525);
  assert.ok(Array.isArray(dash.migration.sports));
  assert.ok(dash.migration.sports.length >= 3);
  assert.match(dash.migration.authorityPolicy, /PRIMARY/);
});

test("capacity ops dashboard API route exists", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const api = readFileSync(join(root, "functions/api/capacity-ops-dashboard.js"), "utf8");
  assert.match(api, /buildCapacityOpsDashboard/);
  assert.match(api, /UNAUTHORIZED/);
  assert.doesNotMatch(api, /sourceRowsDeleted:\s*[1-9]/);
});
