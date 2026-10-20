import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveColdMarketHistoryObservations,
  marketHistoryArchiveKey,
} from "../functions/lib/marketHistoryArchive.js";
import { MARKET_HISTORY_HOT_WINDOW_MS } from "../functions/lib/databaseTopology.js";

test("archive key namespaces by partition day and observation id", () => {
  assert.equal(
    marketHistoryArchiveKey({
      partitionKey: "MARKET_HISTORY_2026Q4",
      collectedAt: "2026-10-01T12:00:00.000Z",
      id: "obs/1",
    }),
    "market-history/observations/MARKET_HISTORY_2026Q4/2026-10-01/obs_1.json"
  );
});

test("archive scan dry-runs cold rows and never deletes", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const coldAt = new Date(now.getTime() - MARKET_HISTORY_HOT_WINDOW_MS - 3600000).toISOString();
  const hotAt = new Date(now.getTime() - 3600000).toISOString();
  const rows = [
    {
      id: "cold-1",
      observation_key: "k1",
      source: "Polymarket US",
      sport: "nhl",
      canonical_event_id: "g1",
      market_family: "moneyline",
      side: "home",
      line: null,
      period: "full_game",
      contract_price: 0.55,
      decimal_odds: null,
      american_odds: null,
      source_market_id: "m1",
      source_outcome_id: "o1",
      source_observed_at: coldAt,
      collected_at: coldAt,
      snapshot_type: "HISTORICAL",
      raw_payload_json: "{}",
      execution_eligible: 0,
      can_qualify: 0,
      can_authorize_wager: 0,
    },
    {
      id: "hot-1",
      observation_key: "k2",
      source: "Polymarket US",
      sport: "nhl",
      canonical_event_id: "g1",
      market_family: "moneyline",
      side: "away",
      line: null,
      period: "full_game",
      contract_price: 0.45,
      decimal_odds: null,
      american_odds: null,
      source_market_id: "m1",
      source_outcome_id: "o2",
      source_observed_at: hotAt,
      collected_at: hotAt,
      snapshot_type: "CURRENT",
      raw_payload_json: "{}",
      execution_eligible: 0,
      can_qualify: 0,
      can_authorize_wager: 0,
    },
  ];
  const puts = [];
  const env = {
    MARKET_HISTORY_2026Q4_DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return { results: rows };
              },
            };
          },
        };
      },
    },
    ARCHIVE: {
      async put(key, body) {
        puts.push({ key, body: JSON.parse(body) });
      },
      async get() { return null; },
    },
  };

  const dry = await archiveColdMarketHistoryObservations(env, { now, limit: 10, archiveWrites: false });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.archived, 1);
  assert.equal(dry.scanned, 2);
  assert.equal(dry.deletion, "NOT_PERFORMED_REQUIRES_RETENTION_GATE");
  assert.equal(puts.length, 0);

  const written = await archiveColdMarketHistoryObservations(env, { now, limit: 10, archiveWrites: true });
  assert.equal(written.ok, true);
  assert.equal(written.dryRun, false);
  assert.equal(written.archived, 1);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.observation.id, "cold-1");
  assert.equal(puts[0].body.canAuthorizeWager, false);
  assert.equal(puts[0].body.observation.can_authorize_wager, 0);
});

test("archive scan reports unbound history without inventing writes", async () => {
  const report = await archiveColdMarketHistoryObservations({ ARCHIVE: { put() {}, get() {} } }, { archiveWrites: true });
  assert.equal(report.ok, false);
  assert.equal(report.reason, "MARKET_HISTORY_UNBOUND");
});
