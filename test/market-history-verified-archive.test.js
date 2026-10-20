import test from "node:test";
import assert from "node:assert/strict";
import { archiveAndVerifyColdMarketHistory } from "../functions/lib/marketHistoryVerifiedArchive.js";
import { MARKET_HISTORY_HOT_WINDOW_MS } from "../functions/lib/databaseTopology.js";
import { sha256Hex } from "../functions/lib/sha256Hex.js";

test("verified archive dry-run never deletes and produces content hash plan", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS - 3600000).toISOString();
  const store = new Map();
  const env = {
    MARKET_HISTORY_2026Q4_DB: {
      prepare(sql) {
        if (String(sql).includes("FROM normalized_market_observations")) {
          return {
            bind() {
              return {
                async all() {
                  return {
                    results: [{
                      id: "cold-1",
                      observation_key: "k1",
                      source: "Polymarket US WebSocket",
                      sport: "nhl",
                      canonical_event_id: "e1",
                      market_family: "moneyline",
                      side: "home",
                      line: null,
                      period: "full_game",
                      contract_price: 0.55,
                      decimal_odds: null,
                      american_odds: null,
                      source_market_id: "m",
                      source_outcome_id: "o",
                      source_observed_at: coldAt,
                      collected_at: coldAt,
                      snapshot_type: "CURRENT",
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
        }
        return { async all() { return { results: [] }; } };
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

  const dry = await archiveAndVerifyColdMarketHistory(env, { now, archiveWrites: false });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.archived, 1);
  assert.equal(dry.deletion, "NOT_PERFORMED_REQUIRES_RETENTION_GATE");
  assert.equal(dry.retentionReleaseAuthorized, false);
  assert.equal(store.size, 0);

  const written = await archiveAndVerifyColdMarketHistory(env, {
    now,
    archiveWrites: true,
    verifyReadback: true,
  });
  assert.equal(written.ok, true);
  assert.equal(written.readbackVerified, true);
  assert.equal(written.contentSha256, written.readbackSha256);
  assert.equal(written.contentSha256.length, 64);
  assert.ok(store.has(written.objectKey));
  assert.ok(store.has(written.manifestKey));
  const body = JSON.parse(store.get(written.objectKey));
  assert.equal(body.observations[0].can_authorize_wager, 0);
  assert.equal(sha256Hex(store.get(written.objectKey)), written.contentSha256);
});
