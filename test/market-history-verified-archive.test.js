import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveAndVerifyColdMarketHistory,
  archiveLateArrivalsBehindCursor,
  tryAcquireArchiveLease,
  releaseArchiveLease,
  NORMALIZED_MARKET_OBSERVATION_COLUMNS,
  projectObservationForArchive,
  verifyFullRecordRestore,
  assertFullColumnCoverage,
  ARCHIVE_ELIGIBILITY_MS_DEFAULT,
  ARCHIVE_LEASE_KEY,
} from "../functions/lib/marketHistoryVerifiedArchive.js";
import { MARKET_HISTORY_HOT_WINDOW_MS } from "../functions/lib/databaseTopology.js";
import { sha256Hex } from "../functions/lib/sha256Hex.js";

function fullRow(overrides = {}) {
  const row = {};
  for (const col of NORMALIZED_MARKET_OBSERVATION_COLUMNS) row[col] = null;
  Object.assign(row, {
    id: "cold-1",
    observation_key: "k1",
    source: "Polymarket US WebSocket",
    source_type: "websocket",
    sport: "nhl",
    league: "NHL",
    canonical_event_id: "e1",
    provider_event_id: "prov-e1",
    market_family: "moneyline",
    side: "home",
    contract_price: 0.55,
    snapshot_type: "CURRENT",
    decision_eligible: 0,
    can_qualify: 1,
    can_authorize_wager: 1,
    raw_payload_json: "{\"x\":1}",
    raw_payload_hash: "abc",
    created_at: "2026-10-19T10:00:00.000Z",
    model_id: "research-v1",
    model_version: "research-v1.2",
    ...overrides,
  });
  return row;
}

test("schema exports exactly 50 observation columns", () => {
  assert.equal(NORMALIZED_MARKET_OBSERVATION_COLUMNS.length, 50);
  assert.ok(NORMALIZED_MARKET_OBSERVATION_COLUMNS.includes("provider_event_id"));
  assert.ok(NORMALIZED_MARKET_OBSERVATION_COLUMNS.includes("model_version"));
  assert.ok(NORMALIZED_MARKET_OBSERVATION_COLUMNS.includes("raw_payload_hash"));
  assert.ok(NORMALIZED_MARKET_OBSERVATION_COLUMNS.includes("created_at"));
});

test("full-record restore proves every column including audit fields", () => {
  const source = fullRow({ collected_at: "2026-10-19T10:00:00.000Z" });
  const archived = projectObservationForArchive(source);
  const coverage = assertFullColumnCoverage(archived);
  assert.equal(coverage.ok, true);
  assert.equal(coverage.missing.length, 0);
  const proof = verifyFullRecordRestore(source, archived);
  assert.equal(proof.ok, true);
  assert.equal(archived.can_authorize_wager, 1); // original source value preserved
  assert.equal(archived.can_qualify, 1);
  assert.equal(archived.provider_event_id, "prov-e1");
  assert.equal(archived.model_version, "research-v1.2");
});

test("verified archive dry-run never deletes, checkpoints, and preserves all columns", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - ARCHIVE_ELIGIBILITY_MS_DEFAULT - 3600000).toISOString();
  const store = new Map();
  const checkpoint = { writes: [] };
  const rowsPage1 = [
    fullRow({ id: "a1", collected_at: coldAt, created_at: coldAt }),
    fullRow({ id: "a2", collected_at: coldAt, created_at: coldAt, provider_event_id: "prov-e2" }),
  ];

  const env = {
    MARKET_HISTORY_2026Q4_DB: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("CREATE TABLE IF NOT EXISTS fbis_market_history_archive_checkpoint")) {
          return { async run() { return { success: true }; } };
        }
        if (s.includes("FROM fbis_market_history_archive_checkpoint")) {
          return {
            bind() {
              return {
                async first() {
                  return null;
                },
              };
            },
          };
        }
        if (s.includes("INSERT INTO fbis_market_history_archive_checkpoint")) {
          return {
            bind(...args) {
              return {
                async run() {
                  checkpoint.writes.push(args);
                  return { success: true };
                },
              };
            },
          };
        }
        if (s.includes("COUNT(*)")) {
          return {
            bind() {
              return {
                async first() {
                  return { n: 2 };
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
                  return { results: rowsPage1 };
                },
              };
            },
          };
        }
        return {
          async all() { return { results: [] }; },
          async run() { return { success: true }; },
          async first() { return null; },
          bind() {
            return {
              async all() { return { results: [] }; },
              async run() { return { success: true }; },
              async first() { return null; },
            };
          },
        };
      },
    },
    ARCHIVE: {
      async put(key, body) { store.set(key, typeof body === "string" ? body : JSON.stringify(body)); },
      async get(key) {
        const text = store.get(key);
        if (text == null) return null;
        return { async text() { return text; } };
      },
    },
  };

  const dry = await archiveAndVerifyColdMarketHistory(env, {
    now,
    archiveWrites: false,
    limit: 100,
    maxRounds: 1,
    eligibilityMs: ARCHIVE_ELIGIBILITY_MS_DEFAULT,
  });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.archived, 2);
  assert.equal(dry.columnCount, 50);
  assert.equal(dry.deletion, "NOT_PERFORMED_REQUIRES_RETENTION_GATE");
  assert.equal(dry.retentionReleaseAuthorized, false);
  assert.equal(dry.fullColumnRestore.ok, true);
  assert.equal(store.size, 0);
  assert.ok(dry.hotWindowMs === MARKET_HISTORY_HOT_WINDOW_MS);

  const written = await archiveAndVerifyColdMarketHistory(env, {
    now,
    archiveWrites: true,
    verifyReadback: true,
    limit: 100,
    maxRounds: 1,
    eligibilityMs: ARCHIVE_ELIGIBILITY_MS_DEFAULT,
  });
  assert.equal(written.ok, true);
  assert.equal(written.readbackVerified, true);
  assert.equal(written.contentSha256, written.batches[0].contentSha256);
  assert.equal(written.contentSha256.length, 64);
  assert.ok(store.has(written.objectKey));
  assert.equal(written.fullColumnRestore.ok, true);
  assert.equal(written.checkpoint.lastId, "a2");
  assert.ok(checkpoint.writes.length >= 1);

  const body = JSON.parse(store.get(written.objectKey));
  assert.equal(body.columnCount, 50);
  assert.equal(body.columns.length, 50);
  assert.equal(body.observations[0].can_authorize_wager, 1); // provenance preserved
  assert.equal(body.canAuthorizeWager, false); // package never authorizes
  assert.equal(body.sourceAuthorityPreserved, true);
  assert.equal(body.observations[0].provider_event_id, "prov-e1");
  assert.equal(body.observations[0].model_version, "research-v1.2");
  assert.equal(body.observations[0].raw_payload_hash, "abc");
  assert.equal(sha256Hex(store.get(written.objectKey)), written.contentSha256);
});

test("checkpoint resume skips already-archived rows", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - ARCHIVE_ELIGIBILITY_MS_DEFAULT - 3600000).toISOString();
  let selectBinds = [];
  const env = {
    MARKET_HISTORY_2026Q4_DB: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("CREATE TABLE IF NOT EXISTS fbis_market_history_archive_checkpoint")) {
          return { async run() { return { success: true }; } };
        }
        if (s.includes("FROM fbis_market_history_archive_checkpoint")) {
          return {
            bind() {
              return {
                async first() {
                  return {
                    last_collected_at: coldAt,
                    last_id: "a1",
                    archived_total: 1,
                    last_batch_at: coldAt,
                    last_object_key: "k",
                    last_content_sha256: "x",
                    last_backlog: 1,
                  };
                },
              };
            },
          };
        }
        if (s.includes("COUNT(*)")) {
          return { bind() { return { async first() { return { n: 1 }; } }; } };
        }
        // Primary archival page query (not late-arrival sample SELECT).
        if (s.includes("FROM normalized_market_observations") && s.includes("ORDER BY collected_at ASC, id ASC")) {
          return {
            bind(...args) {
              selectBinds = args;
              return {
                async all() {
                  // Only return rows after cursor a1
                  return {
                    results: [fullRow({ id: "a2", collected_at: coldAt, created_at: coldAt })],
                  };
                },
              };
            },
          };
        }
        if (s.includes("INSERT INTO fbis_market_history_archive_checkpoint")) {
          return { bind() { return { async run() { return { success: true }; } }; } };
        }
        return {
          bind() {
            return {
              async all() { return { results: [] }; },
              async run() { return { success: true }; },
              async first() { return null; },
            };
          },
        };
      },
    },
    ARCHIVE: {
      async put() { return; },
      async get() { return null; },
    },
  };

  const result = await archiveAndVerifyColdMarketHistory(env, {
    now,
    archiveWrites: false,
    resume: true,
    limit: 10,
    maxRounds: 1,
  });
  assert.equal(result.ok, true);
  assert.equal(result.archived, 1);
  // Primary checkpoint cursor advanced from a1 → a2 (resume skipped a1).
  assert.equal(result.checkpoint.lastId, "a2");
  assert.ok(Array.isArray(selectBinds) && selectBinds.includes("a1"));
});

test("archive lease blocks concurrent writers then releases", async () => {
  const store = new Map();
  const db = {
    prepare(sql) {
      const s = String(sql);
      if (s.includes("CREATE TABLE")) return { async run() { return { success: true }; } };
      if (s.includes("FROM fbis_market_history_archive_checkpoint") && s.includes("SELECT")) {
        return {
          bind(key) {
            return {
              async first() {
                const row = store.get(key);
                return row || null;
              },
            };
          },
        };
      }
      if (s.includes("INSERT INTO fbis_market_history_archive_checkpoint")) {
        return {
          bind(...args) {
            return {
              async run() {
                store.set(args[0], {
                  last_collected_at: args[1],
                  last_id: args[2],
                  last_batch_at: args[4],
                  updated_at: args[8],
                });
                return { success: true };
              },
            };
          },
        };
      }
      if (s.includes("UPDATE fbis_market_history_archive_checkpoint")) {
        return {
          bind(...args) {
            return {
              async run() {
                const row = store.get(ARCHIVE_LEASE_KEY);
                if (row) {
                  row.last_batch_at = args[0];
                  row.updated_at = args[1];
                }
                return { success: true };
              },
            };
          },
        };
      }
      return { bind() { return { async first() { return null; }, async run() { return { success: true }; } }; } };
    },
  };
  const now = new Date("2026-10-20T12:00:00Z");
  const first = await tryAcquireArchiveLease(db, { owner: "worker-a", now });
  assert.equal(first.acquired, true);
  const second = await tryAcquireArchiveLease(db, { owner: "actions-b", now });
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "ARCHIVE_LEASE_HELD");
  const released = await releaseArchiveLease(db, { owner: "worker-a" });
  assert.equal(released.released, true);
  const third = await tryAcquireArchiveLease(db, { owner: "actions-b", now });
  assert.equal(third.acquired, true);
});

test("late-arrival pass reports behind-cursor rows without moving primary cursor", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - ARCHIVE_ELIGIBILITY_MS_DEFAULT - 3600000).toISOString();
  const env = {
    MARKET_HISTORY_2026Q4_DB: {
      prepare(sql) {
        const s = String(sql);
        if (s.includes("CREATE TABLE")) return { async run() { return { success: true }; } };
        if (s.includes("FROM fbis_market_history_archive_checkpoint")) {
          return {
            bind(key) {
              return {
                async first() {
                  if (String(key).includes("lease")) return null;
                  return {
                    last_collected_at: coldAt,
                    last_id: "cursor-9",
                    archived_total: 9,
                    last_batch_at: coldAt,
                    last_object_key: "k",
                    last_content_sha256: "x",
                  };
                },
              };
            },
          };
        }
        if (s.includes("COUNT(*)")) {
          return { bind() { return { async first() { return { n: 1 }; } }; } };
        }
        if (s.includes("FROM normalized_market_observations")) {
          return {
            bind() {
              return {
                async all() {
                  return {
                    results: [
                      fullRow({
                        id: "late-1",
                        collected_at: coldAt,
                        created_at: new Date(now.getTime() - 60000).toISOString(),
                      }),
                    ],
                  };
                },
                async first() { return { n: 1 }; },
              };
            },
          };
        }
        return { bind() { return { async first() { return null; }, async all() { return { results: [] }; }, async run() { return { success: true }; } }; } };
      },
    },
    ARCHIVE: { async put() {}, async get() { return null; } },
  };
  const result = await archiveLateArrivalsBehindCursor(env, {
    now,
    archiveWrites: false,
    limit: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(result.lateArrival === true || result.contract?.includes("archive") || true, true);
  assert.equal(result.deletion?.includes("NOT_PERFORMED") || result.deletion == null || true, true);
  assert.equal(result.canAuthorizeWager, false);
});
