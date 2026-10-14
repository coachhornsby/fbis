import test from "node:test";
import assert from "node:assert/strict";
import { auditSportMarketCoverage, auditPlatformMarketCoverage } from "../functions/lib/marketCoverageAudit.js";

function dbMock(handlers = {}) {
  return {
    prepare(sql) {
      const run = handlers[sql] || handlers.default || (() => ({ results: [], n: 0, total: 0, linked: 0, unmatched: 0, linked_events: 0 }));
      const stmt = {
        bind(...args) {
          stmt._args = args;
          return stmt;
        },
        async first() {
          return typeof run === "function" ? run(sql, stmt._args, "first") : run;
        },
        async all() {
          const out = typeof run === "function" ? run(sql, stmt._args, "all") : run;
          return { results: out.results || [] };
        },
      };
      return stmt;
    },
  };
}

test("auditSportMarketCoverage separates observation linkage from event coverage", async () => {
  const db = dbMock({
    default(sql) {
      if (sql.includes("FROM normalized_market_observations") && sql.includes("source = ?")) {
        return {
          total: 10,
          linked: 4,
          unmatched: 6,
          linked_events: 2,
          latest_collected_at: "2026-10-14T00:00:00.000Z",
          latest_provider_observed_at: null,
        };
      }
      if (sql.includes("FROM games") && sql.includes("COUNT(*)")) return { n: 5 };
      if (sql.includes("JOIN normalized_market_observations")) return { n: 2 };
      return { n: 0, total: 0, linked: 0, unmatched: 0, linked_events: 0 };
    },
  });
  const report = await auditSportMarketCoverage(db, "nhl", {
    now: new Date("2026-10-14T12:00:00.000Z"),
    lookbackHours: 48,
  });
  assert.equal(report.ok, true);
  assert.equal(report.totals.totalObservations, 40); // 4 sources × 10
  assert.equal(report.totals.linkedObservations, 16);
  assert.equal(report.totals.observationLinkageRate, 0.4);
  assert.equal(report.totals.eligibleEvents, 5);
  assert.equal(report.totals.eventsWithLinkedMarket, 2);
  assert.equal(report.totals.eventMarketCoverage, 0.4);
  assert.equal(report.bySource[0].status, "PARTIAL");
});

test("auditPlatformMarketCoverage returns every configured sport", async () => {
  const db = dbMock({
    default() {
      return { n: 0, total: 0, linked: 0, unmatched: 0, linked_events: 0 };
    },
  });
  const report = await auditPlatformMarketCoverage(db, {
    now: new Date("2026-10-14T12:00:00.000Z"),
    lookbackHours: 24,
  });
  assert.equal(report.ok, true);
  assert.ok(report.sports.length >= 11);
  assert.ok(report.sports.every((s) => s.ok === true));
  assert.ok(report.eligibility.includes("lookbackHours"));
});

test("missing database fails closed", async () => {
  const report = await auditSportMarketCoverage(null, "nhl");
  assert.equal(report.ok, false);
  assert.equal(report.error, "DATABASE_OR_SPORT_REQUIRED");
});

test("tennis event coverage uses official/ESPN fixtures not games table", async () => {
  let sawTennisUnion = false;
  const db = dbMock({
    default(sql) {
      if (sql.includes("tennis_official_matches") || sql.includes("tennis_external_fixtures")) {
        sawTennisUnion = true;
        return { n: 17 };
      }
      if (sql.includes("FROM normalized_market_observations") && sql.includes("DISTINCT canonical_event_id")) {
        return { n: 13 };
      }
      if (sql.includes("FROM normalized_market_observations") && sql.includes("source = ?")) {
        return {
          total: 20,
          linked: 14,
          unmatched: 6,
          linked_events: 5,
          latest_collected_at: "2026-10-14T06:00:00.000Z",
          latest_provider_observed_at: null,
        };
      }
      return { n: 0, total: 0, linked: 0, unmatched: 0, linked_events: 0 };
    },
  });
  const report = await auditSportMarketCoverage(db, "tennis", {
    now: new Date("2026-10-14T12:00:00.000Z"),
    lookbackHours: 48,
  });
  assert.equal(report.ok, true);
  assert.equal(sawTennisUnion, true);
  assert.equal(report.totals.eligibleEvents, 17);
  assert.equal(report.totals.eventsWithLinkedMarket, 13);
  assert.equal(report.totals.eventMarketCoverage, 0.7647);
});
