import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveMarketHistoryWriteDb,
  marketHistoryRetentionDecision,
  MARKET_HISTORY_HOT_WINDOW_MS,
} from "../functions/lib/databaseTopology.js";
import { archiveColdMarketHistoryObservations } from "../functions/lib/marketHistoryArchive.js";
import { evaluateRetentionRelease } from "../functions/lib/retentionGate.js";

function historyDb(bytes, ready = true) {
  return {
    prepare(sql) {
      if (String(sql).includes("sqlite_master")) {
        return { bind() { return { async first() { return ready ? { ok: 1 } : null; } }; } };
      }
      if (String(sql).includes("FROM normalized_market_observations")) {
        return {
          bind() {
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      }
      return { async all() { return { meta: { size_after: bytes } }; } };
    },
  };
}

test("Q4 partition is preferred for new writes when under capacity", async () => {
  const target = await resolveMarketHistoryWriteDb({
    MARKET_HISTORY_2026Q4_DB: historyDb(100_000),
    MARKET_HISTORY_DB: historyDb(9_200_000_000),
  });
  assert.equal(target.store, "MARKET_HISTORY_2026Q4");
  assert.equal(target.binding, "MARKET_HISTORY_2026Q4_DB");
});

test("archive scan never deletes and retention gate blocks deletion without verified R2", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS - 3600000).toISOString();
  const env = {
    MARKET_HISTORY_DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [{
                    id: "old-1",
                    observation_key: "k",
                    source: "Polymarket US",
                    sport: "nfl",
                    canonical_event_id: "e1",
                    market_family: "moneyline",
                    side: "home",
                    line: null,
                    period: "full_game",
                    contract_price: 0.5,
                    decimal_odds: null,
                    american_odds: null,
                    source_market_id: "m",
                    source_outcome_id: "o",
                    source_observed_at: coldAt,
                    collected_at: coldAt,
                    snapshot_type: "HISTORICAL",
                    raw_payload_json: "{}",
                    execution_eligible: 0,
                    can_qualify: 0,
                    can_authorize_wager: 0,
                  }],
                };
              },
            };
          },
        };
      },
    },
    ARCHIVE: { async put() {}, async get() { return null; } },
  };
  const scan = await archiveColdMarketHistoryObservations(env, { now, archiveWrites: false });
  assert.equal(scan.deletion, "NOT_PERFORMED_REQUIRES_RETENTION_GATE");
  assert.equal(scan.archived, 1);

  const decision = marketHistoryRetentionDecision({ collectedAt: coldAt, now });
  assert.equal(decision.retainInD1, false);
  assert.equal(decision.action, "ARCHIVE_TO_R2_THEN_RETENTION_GATE");

  const blocked = evaluateRetentionRelease({
    r2ArchiveVerified: false,
    independentRestoreVerified: false,
    consumerAuditComplete: false,
    retentionReleaseAuthorized: false,
    sourceRowsDeleted: 0,
  });
  assert.equal(blocked.authorized, false);
  assert.equal(blocked.canDeleteSourceRows, false);
});
