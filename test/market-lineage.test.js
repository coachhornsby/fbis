import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_SOURCE_MODE,
  RETRY_CLASS,
  attachMarketLineage,
  canRetryPregameSnapshot,
  classifyHarvestRetryReason,
  classifyOpenHarvestRetries,
  evaluateCachedMarketFreshness,
  isRetryableClass,
  isUnusableCachedOddsMeta,
  normalizeMarketSourceMode,
  providerConfigFlags,
} from "../functions/lib/marketLineage.js";
import {
  canQualifyFromOddsResolution,
  isFreshComplete,
  providerConfigured,
  resolveOddsProviders,
} from "../functions/lib/oddsProviderRouter.js";
import { COLLEGE_MODELS } from "../functions/lib/collegeModels.js";

describe("market lineage + cache policy", () => {
  it("labels live / cached / fallback source modes", () => {
    assert.equal(normalizeMarketSourceMode({ source: "parlay" }), MARKET_SOURCE_MODE.LIVE_PROVIDER);
    assert.equal(
      normalizeMarketSourceMode({ source: "parlay", cached: true }),
      MARKET_SOURCE_MODE.CACHED_PROVIDER
    );
    assert.equal(
      normalizeMarketSourceMode({ source: "sharpapi-soft-backup" }),
      MARKET_SOURCE_MODE.FALLBACK_PROVIDER
    );
    assert.equal(
      normalizeMarketSourceMode({ source: "theodds-backup" }),
      MARKET_SOURCE_MODE.FALLBACK_PROVIDER
    );
  });

  it("treats parlay credit-exhausted cache as unusable so fallback can run", () => {
    assert.equal(
      isUnusableCachedOddsMeta({
        source: "parlay-credit-exhausted",
        games: 67,
        pinGames: 67,
        parlayError: "OUT_OF_USAGE_CREDITS",
      }),
      true
    );
    assert.equal(
      isUnusableCachedOddsMeta({
        source: "sharpapi-soft-backup",
        games: 10,
        pinGames: 10,
        asOf: new Date().toISOString(),
      }),
      false
    );
  });

  it("preserves original observedAt and rejects stale cache", () => {
    const observedAt = "2026-09-11T14:00:00.000Z";
    const fresh = evaluateCachedMarketFreshness(
      { observedAt, source: "sharpapi-soft-backup" },
      { nowMs: Date.parse("2026-09-11T14:10:00.000Z"), maxAgeMs: 15 * 60 * 1000 }
    );
    assert.equal(fresh.ok, true);
    assert.equal(fresh.observedAt, observedAt);

    const stale = evaluateCachedMarketFreshness(
      { asOf: observedAt, source: "sharpapi-soft-backup" },
      { nowMs: Date.parse("2026-09-11T14:30:00.000Z"), maxAgeMs: 15 * 60 * 1000 }
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "MARKET_STALE");
    assert.equal(stale.observedAt, observedAt);

    const missing = evaluateCachedMarketFreshness({ source: "parlay" });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing-observedAt");
  });

  it("attachMarketLineage retains observedAt and marks cache/retry lineage", () => {
    const observedAt = "2026-09-11T12:00:00.000Z";
    const lineage = attachMarketLineage(
      { source: "theodds-backup", asOf: observedAt, games: 3 },
      {
        provider: "theodds",
        cached: true,
        receivedAt: "2026-09-11T12:05:00.000Z",
        jobId: "collect:1",
        retryOf: "collect:0",
      }
    );
    assert.equal(lineage.observedAt, observedAt);
    assert.equal(lineage.sourceMode, MARKET_SOURCE_MODE.CACHED_PROVIDER);
    assert.equal(lineage.provider, "theodds");
    assert.equal(lineage.collectionJobId, "collect:1");
    assert.equal(lineage.retryOf, "collect:0");
    assert.equal(lineage.cached, true);
  });
});

describe("odds router fallback + fail-closed", () => {
  it("routes Parlay credit exhaustion to TheOdds then SharpAPI", async () => {
    const called = [];
    const resolution = await resolveOddsProviders({
      configured: providerConfigured({
        parlayApiKey: "p",
        theOddsApiKey: "o",
        sharpApiKey: "s",
        theRundownApiKey: "r",
      }),
      fetchers: {
        parlay: async () => {
          called.push("parlay");
          return {
            provider: "parlay",
            ok: false,
            complete: false,
            events: [],
            error: "credit limit",
            quotaExhausted: true,
          };
        },
        theodds: async () => {
          called.push("theodds");
          return {
            provider: "theodds",
            ok: true,
            complete: true,
            events: [{ id: "m1" }],
            asOf: "2026-09-11T14:55:00.000Z",
          };
        },
        sharpapi: async () => {
          called.push("sharpapi");
          return { provider: "sharpapi", ok: true, complete: true, events: [{ id: "s" }], asOf: new Date().toISOString() };
        },
        therundown: async () => {
          called.push("therundown");
          return { provider: "therundown", ok: true, complete: true, events: [{ id: "r" }], asOf: new Date().toISOString() };
        },
      },
    });
    assert.equal(resolution.provider, "theodds");
    assert.deepEqual(called, ["parlay", "theodds"]);
    assert.equal(resolution.asOf, "2026-09-11T14:55:00.000Z");
  });

  it("skips missing backup credential and continues to next provider", async () => {
    const called = [];
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: false, sharpapi: true, therundown: false },
      fetchers: {
        parlay: async () => {
          called.push("parlay");
          return { provider: "parlay", ok: false, complete: false, events: [], quotaExhausted: true, error: "quota" };
        },
        theodds: async () => {
          called.push("theodds");
          return { provider: "theodds", ok: true, complete: true, events: [{ id: 1 }], asOf: new Date().toISOString() };
        },
        sharpapi: async () => {
          called.push("sharpapi");
          return {
            provider: "sharpapi",
            ok: true,
            complete: true,
            events: [{ id: 2 }],
            asOf: "2026-09-11T14:58:00.000Z",
          };
        },
        therundown: async () => {
          called.push("therundown");
          return { provider: "therundown", ok: true, complete: true, events: [{ id: 3 }], asOf: new Date().toISOString() };
        },
      },
    });
    assert.equal(resolution.provider, "sharpapi");
    assert.deepEqual(called, ["parlay", "sharpapi"]);
    assert.ok(resolution.attempts.some((a) => a.provider === "theodds" && a.skipped));
  });

  it("fails closed when all providers are unavailable", async () => {
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: true, therundown: true },
      fetchers: {
        parlay: async () => ({ provider: "parlay", ok: false, complete: false, events: [], error: "x" }),
        theodds: async () => ({ provider: "theodds", ok: false, complete: false, events: [], error: "x" }),
        sharpapi: async () => ({ provider: "sharpapi", ok: false, complete: false, events: [], error: "x" }),
        therundown: async () => ({ provider: "therundown", ok: false, complete: false, events: [], error: "x" }),
      },
    });
    assert.equal(resolution.ok, false);
    assert.equal(resolution.failClosed, true);
    assert.equal(canQualifyFromOddsResolution(resolution), false);
  });

  it("rejects missing asOf as not fresh", () => {
    assert.equal(
      isFreshComplete({ ok: true, complete: true, events: [{ id: 1 }] }),
      false
    );
  });
});

describe("retry temporal safety + classification", () => {
  it("allows pregame retry before kickoff and blocks after", () => {
    const before = canRetryPregameSnapshot({
      kickoffAt: "2026-09-11T20:00:00.000Z",
      nowMs: Date.parse("2026-09-11T18:00:00.000Z"),
    });
    assert.equal(before.allowed, true);
    assert.equal(before.temporalValid, true);

    const after = canRetryPregameSnapshot({
      kickoffAt: "2026-09-11T17:00:00.000Z",
      nowMs: Date.parse("2026-09-11T18:00:00.000Z"),
    });
    assert.equal(after.allowed, false);
    assert.equal(after.class, RETRY_CLASS.POST_KICKOFF);
    assert.equal(after.temporalValid, false);
  });

  it("does not invent a pregame snapshot after kickoff for market retries", () => {
    const report = classifyOpenHarvestRetries(
      [
        {
          id: "cfb:2026-09-11:g1",
          sport: "cfb",
          date: "2026-09-11",
          game_id: "g1",
          reason: "provider timeout",
          kind: "market",
          kickoffAt: "2026-09-11T16:00:00.000Z",
          status: "open",
        },
        {
          id: "mlb:2026-09-10:*",
          sport: "mlb",
          date: "2026-09-10",
          reason: "OUT_OF_USAGE_CREDITS",
          kind: "harvest",
          status: "open",
        },
      ],
      { nowMs: Date.parse("2026-09-11T18:00:00.000Z") }
    );
    assert.equal(report.total, 2);
    assert.equal(report.postKickoff, 1);
    const market = report.rows.find((r) => r.id === "cfb:2026-09-11:g1");
    assert.equal(market.retryable, false);
    assert.equal(market.class, RETRY_CLASS.POST_KICKOFF);
    const harvest = report.rows.find((r) => r.id === "mlb:2026-09-10:*");
    assert.equal(harvest.class, RETRY_CLASS.PROVIDER_QUOTA);
    assert.equal(harvest.retryable, true);
    assert.equal(isRetryableClass(RETRY_CLASS.AUTH_FAILURE), false);
    assert.equal(classifyHarvestRetryReason("401 unauthorized"), RETRY_CLASS.AUTH_FAILURE);
  });

  it("providerConfigFlags never returns secret values", () => {
    const flags = providerConfigFlags({
      PARLAY_API_KEY: "secret-parlay",
      THEODDS_API_KEY: "",
      SHARPAPI_API_KEY: "secret-sharp",
      THERUNDOWN_API_KEY: null,
    });
    assert.deepEqual(flags, { parlay: true, theodds: false, sharpapi: true, therundown: false });
    assert.equal(JSON.stringify(flags).includes("secret"), false);
  });
});

describe("model safeguards during ops recovery", () => {
  it("keeps CFB-FBIS-v2 qualification and wager auth disabled", () => {
    const m = COLLEGE_MODELS["CFB-FBIS-v2"];
    assert.ok(m);
    assert.equal(m.canQualify, false);
    assert.equal(m.canAuthorizeWager, false);
  });
});
