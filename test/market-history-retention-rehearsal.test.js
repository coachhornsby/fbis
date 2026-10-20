import test from "node:test";
import assert from "node:assert/strict";
import { rehearseMarketHistoryRetirement } from "../functions/lib/marketHistoryRetentionRehearsal.js";
import { MARKET_HISTORY_HOT_WINDOW_MS } from "../functions/lib/databaseTopology.js";
import { NORMALIZED_MARKET_OBSERVATION_COLUMNS } from "../functions/lib/marketHistoryVerifiedArchive.js";

function fullRow(overrides = {}) {
  const row = {};
  for (const col of NORMALIZED_MARKET_OBSERVATION_COLUMNS) row[col] = null;
  return Object.assign(row, {
    id: "retire-1",
    observation_key: "k",
    source: "Polymarket US WebSocket",
    source_type: "websocket",
    sport: "nhl",
    market_family: "moneyline",
    snapshot_type: "CURRENT",
    decision_eligible: 0,
    can_qualify: 0,
    can_authorize_wager: 0,
    created_at: "2026-10-18T10:00:00.000Z",
    ...overrides,
  });
}

test("retention rehearsal never deletes and fails gate without explicit auth", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS - 3600000).toISOString();
  const env = {
    MARKET_HISTORY_2026Q4_DB: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("fbis_market_history_archive_checkpoint")) {
          return {
            bind() {
              return {
                async first() {
                  return {
                    last_collected_at: coldAt,
                    last_id: "retire-2",
                    archived_total: 100,
                    last_object_key: "obj",
                    last_content_sha256: "a".repeat(64),
                    last_batch_at: coldAt,
                  };
                },
              };
            },
          };
        }
        if (s.includes("FROM normalized_market_observations")) {
          return {
            bind() {
              return {
                async all() {
                  return {
                    results: [
                      fullRow({ id: "retire-1", collected_at: coldAt, created_at: coldAt }),
                      fullRow({
                        id: "retire-protected",
                        collected_at: coldAt,
                        created_at: coldAt,
                        decision_eligible: 1,
                      }),
                    ],
                  };
                },
              };
            },
          };
        }
        return { bind() { return { async first() { return null; }, async all() { return { results: [] }; } }; } };
      },
    },
    ARCHIVE: { async get() { return null; }, async put() {} },
  };

  const result = await rehearseMarketHistoryRetirement(env, { now, limit: 50 });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.match(result.deletion, /NOT_PERFORMED/);
  assert.equal(result.gate.authorized, false);
  assert.ok(result.gate.failedChecks.includes("consumer_audit_complete"));
  assert.ok(result.gate.failedChecks.includes("retention_release_authorized"));
  assert.equal(result.eligibleForRetirementConsideration, 1);
  assert.equal(result.protectedSkipped, 1);
  assert.equal(result.canAuthorizeWager, false);
});
