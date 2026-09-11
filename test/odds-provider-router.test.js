import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ODDS_PROVIDER_ORDER,
  canQualifyFromOddsResolution,
  isFreshComplete,
  planOddsSecretSync,
  providerConfigured,
  resolveOddsProviders,
  shouldSyncPagesSecret,
} from "../functions/lib/oddsProviderRouter.js";
import {
  shouldPutPagesSecret,
  syncPagesSecretsSkipEmpty,
} from "../scripts/lib/pagesSecretSync.js";

function okResult(provider, events, extra = {}) {
  return {
    provider,
    ok: true,
    complete: true,
    events,
    asOf: extra.asOf || new Date().toISOString(),
    quotaRemaining: extra.quotaRemaining ?? 100,
    meta: extra.meta || {},
    ...extra,
  };
}

describe("odds provider router", () => {
  it("exposes the intended production pool order", () => {
    assert.deepEqual([...ODDS_PROVIDER_ORDER], ["parlay", "theodds", "sharpapi", "therundown"]);
  });

  it("does not query backups when Parlay returns fresh complete data", async () => {
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
          return okResult("parlay", [{ id: 1 }]);
        },
        theodds: async () => {
          called.push("theodds");
          return okResult("theodds", [{ id: 2 }]);
        },
        sharpapi: async () => {
          called.push("sharpapi");
          return okResult("sharpapi", [{ id: 3 }]);
        },
        therundown: async () => {
          called.push("therundown");
          return okResult("therundown", [{ id: 4 }]);
        },
      },
    });
    assert.equal(resolution.ok, true);
    assert.equal(resolution.provider, "parlay");
    assert.deepEqual(called, ["parlay"]);
    assert.equal(canQualifyFromOddsResolution(resolution), true);
  });

  it("routes to TheOdds when Parlay is exhausted", async () => {
    const called = [];
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: true, therundown: true },
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
          return okResult("theodds", [{ id: "odds" }]);
        },
        sharpapi: async () => {
          called.push("sharpapi");
          return okResult("sharpapi", [{ id: "sharp" }]);
        },
        therundown: async () => {
          called.push("therundown");
          return okResult("therundown", [{ id: "rd" }]);
        },
      },
    });
    assert.equal(resolution.provider, "theodds");
    assert.deepEqual(called, ["parlay", "theodds"]);
  });

  it("routes to SharpAPI when TheOdds is exhausted", async () => {
    const called = [];
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: true, therundown: true },
      fetchers: {
        parlay: async () => {
          called.push("parlay");
          return { provider: "parlay", ok: false, complete: false, events: [], quotaExhausted: true, error: "quota" };
        },
        theodds: async () => {
          called.push("theodds");
          return { provider: "theodds", ok: false, complete: false, events: [], rateLimited: true, error: "429" };
        },
        sharpapi: async () => {
          called.push("sharpapi");
          return okResult("sharpapi", [{ id: "s" }]);
        },
        therundown: async () => {
          called.push("therundown");
          return okResult("therundown", [{ id: "r" }]);
        },
      },
    });
    assert.equal(resolution.provider, "sharpapi");
    assert.deepEqual(called, ["parlay", "theodds", "sharpapi"]);
  });

  it("continues past an unconfigured backup to the next configured provider", async () => {
    const called = [];
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: false, therundown: true },
      fetchers: {
        parlay: async () => {
          called.push("parlay");
          return { provider: "parlay", ok: false, complete: false, events: [], error: "down" };
        },
        theodds: async () => {
          called.push("theodds");
          return { provider: "theodds", ok: false, complete: false, events: [], error: "down" };
        },
        sharpapi: async () => {
          called.push("sharpapi");
          return okResult("sharpapi", [{ id: "s" }]);
        },
        therundown: async () => {
          called.push("therundown");
          return okResult("therundown", [{ id: "r" }]);
        },
      },
    });
    assert.equal(resolution.provider, "therundown");
    assert.deepEqual(called, ["parlay", "theodds", "therundown"]);
    assert.ok(resolution.attempts.some((a) => a.provider === "sharpapi" && a.skipped));
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
    assert.equal(resolution.provider, null);
    assert.equal(canQualifyFromOddsResolution(resolution), false);
  });

  it("rejects stale provider data and continues to a fresh backup", async () => {
    const nowMs = Date.parse("2026-09-11T18:00:00Z");
    assert.equal(
      isFreshComplete(okResult("parlay", [{ id: 1 }], { asOf: "2026-09-11T17:00:00Z" }), {
        nowMs,
        maxAgeMs: 15 * 60 * 1000,
      }),
      false
    );
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: false, therundown: false },
      nowMs,
      maxAgeMs: 15 * 60 * 1000,
      fetchers: {
        parlay: async () => okResult("parlay", [{ id: 1 }], { asOf: "2026-09-11T17:00:00Z" }),
        theodds: async () => okResult("theodds", [{ id: 2 }], { asOf: "2026-09-11T17:55:00Z" }),
      },
    });
    assert.equal(resolution.provider, "theodds");
  });

  it("does not qualify wagers from missing market data", () => {
    assert.equal(canQualifyFromOddsResolution(null), false);
    assert.equal(canQualifyFromOddsResolution({ ok: false, failClosed: true, events: [] }), false);
    assert.equal(canQualifyFromOddsResolution({ ok: true, failClosed: false, provider: "parlay", events: [] }), false);
    assert.equal(
      canQualifyFromOddsResolution({ ok: true, failClosed: false, provider: "parlay", events: [{ id: 1 }] }),
      true
    );
  });

  it("preserves source attribution and market timestamp on provider switch", async () => {
    const asOf = "2026-09-11T17:58:00Z";
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: false, therundown: false },
      fetchers: {
        parlay: async () => ({
          provider: "parlay",
          ok: false,
          complete: false,
          events: [],
          error: "quota",
          quotaExhausted: true,
        }),
        theodds: async () => okResult("theodds", [{ id: "mkt" }], { asOf, meta: { book: "pinnacle" } }),
      },
    });
    assert.equal(resolution.source, "theodds");
    assert.equal(resolution.asOf, asOf);
    assert.equal(resolution.meta.book, "pinnacle");
  });

  it("rejects incomplete markets when completeness is required", async () => {
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: false, therundown: false },
      fetchers: {
        parlay: async () => ({
          provider: "parlay",
          ok: true,
          complete: true,
          incomplete: true,
          events: [{ id: 1 }],
          asOf: new Date().toISOString(),
          error: "missing-side",
        }),
        theodds: async () => okResult("theodds", [{ id: 2 }]),
      },
    });
    assert.equal(resolution.provider, "theodds");
    assert.ok(resolution.attempts.some((a) => a.provider === "parlay" && a.incomplete));
  });

  it("can skip a preferred provider when configurable quota reserve is reached", async () => {
    const called = [];
    const resolution = await resolveOddsProviders({
      configured: { parlay: true, theodds: true, sharpapi: false, therundown: false },
      quotaReserve: { parlay: 50 },
      fetchers: {
        parlay: async () => {
          called.push("parlay");
          return okResult("parlay", [{ id: 1 }], { quotaRemaining: 10 });
        },
        theodds: async () => {
          called.push("theodds");
          return okResult("theodds", [{ id: 2 }], { quotaRemaining: 500 });
        },
      },
    });
    assert.equal(resolution.provider, "theodds");
    assert.deepEqual(called, ["parlay", "theodds"]);
  });
});

describe("Pages odds-secret sync never overwrites with empty values", () => {
  it("plans skips for all three optional backups when absent", () => {
    const plan = planOddsSecretSync({
      SHARPAPI_API_KEY: "",
      THERUNDOWN_API_KEY: null,
      THEODDS_API_KEY: undefined,
    });
    assert.deepEqual(plan.writes, []);
    assert.deepEqual(plan.skips.sort(), ["SHARPAPI_API_KEY", "THERUNDOWN_API_KEY", "THEODDS_API_KEY"].sort());
    assert.equal(shouldSyncPagesSecret("").write, false);
    assert.equal(shouldPutPagesSecret(""), false);
  });

  it("writes only present secrets and never invokes put for empty ones", async () => {
    const puts = [];
    const report = await syncPagesSecretsSkipEmpty(
      {
        SHARPAPI_API_KEY: "",
        THERUNDOWN_API_KEY: "   ",
        THEODDS_API_KEY: "odds-rotated",
      },
      async (name, value) => {
        puts.push({ name, value });
      }
    );
    assert.deepEqual(report.written, ["THEODDS_API_KEY"]);
    assert.deepEqual(report.skipped.sort(), ["SHARPAPI_API_KEY", "THERUNDOWN_API_KEY"].sort());
    assert.deepEqual(puts, [{ name: "THEODDS_API_KEY", value: "odds-rotated" }]);
  });

  it("treats deploy with all three optional odds backups absent as skip-only (safe degrade)", async () => {
    const puts = [];
    const report = await syncPagesSecretsSkipEmpty(
      { SHARPAPI_API_KEY: "", THERUNDOWN_API_KEY: "", THEODDS_API_KEY: "" },
      async (name, value) => puts.push({ name, value })
    );
    assert.deepEqual(puts, []);
    assert.equal(report.written.length, 0);
    assert.equal(report.skipped.length, 3);
  });
});
