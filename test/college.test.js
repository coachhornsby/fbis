import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collegeApiKey, collegeKeyHealth, redactSecrets, assertNoSecretLeak, cfbdConfigured, cbbdConfigured } from "../functions/lib/collegeSecrets.js";
import { unwrapCollegeResponse, collegePublicResult, summarizeSchema, collegeRequest } from "../functions/lib/collegeApi.js";
import { quotaHealth, quotaAlerts, estimateMonthlyCalls, MONTHLY_QUOTA, utcMonthKey } from "../functions/lib/quota.js";
import { CONTRACTS, contractFor } from "../data/contracts/college-endpoints.js";
import { identityFailClosed, miamiDisambiguation, mapSourceTeam, cutoffViolated, featureCutoffIso, AMBIGUOUS_ALONE } from "../functions/lib/collegeIdentity.js";
import { COLLEGE_MODELS, failClosedShadow, evaluatePromotion, shadowCannotQualify, PROMOTION_CRITERIA, CHAMPION_HFA, unavailableMetric } from "../functions/lib/collegeModels.js";
import { cfbLeagueBaseline, cfbRatingsV1, cfbRegV1, independentEnsemble, pinnacleImplied, projectCfbChallengers, attachMc } from "../functions/lib/cfbRatings.js";
import { projectCfbMatchup } from "../functions/lib/cfbModel.js";
import { cbbRatingsV1, cbbLeagueBaseline, rejectedOldCbbTotal, expectedPossessions, expectedEfficiency, projectCbbChallengers, torvikUnavailable, kenpomAbsent, cbbMarketShrunk, CBB_NATIONAL_EFF } from "../functions/lib/cbbRatings.js";
import { r2Bound, r2Key, R2_SETUP } from "../functions/lib/r2Archive.js";
import { warnLevel, metricUnavailable } from "../functions/lib/storageBudget.js";
import { insertModelPrediction, gradeModelPrediction, insertGameFeatureSnapshot } from "../functions/lib/collegeStore.js";
import { gradeScores, freezeChallengerPredictions, COLLEGE_JOBS, runCollegeJob } from "../functions/lib/collegeJobs.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";
import { CHAMPION_HFA as HFA_CONST } from "../functions/lib/hfa.js";
import { STRATEGY_HC_V1 } from "../functions/lib/strategy.js";
import { resolveTeam, resolveTeamExact } from "../functions/lib/teams.js";
import { resetCacheMem } from "../functions/lib/cache.js";
import { runCbbdEndpointAudit } from "../functions/lib/cbbdEndpointAudit.js";

const FAKE = "test-college-key-not-real";

describe("secret non-exposure", () => {
  it("aliases CBBD_API_KEY without duplicating a literal", () => {
    const env = { CFBD_API_KEY: FAKE };
    assert.equal(collegeApiKey(env, "cfbd"), FAKE);
    assert.equal(collegeApiKey(env, "cbbd"), FAKE);
    assert.equal(cbbdConfigured(env), true);
    const health = collegeKeyHealth(env);
    assert.equal(health.cfbdConfigured, true);
    assert.equal(health.sharedAlias, true);
    const dump = JSON.stringify(health);
    assert.equal(dump.includes(FAKE), false);
  });

  it("redacts bearer and refuses leaks", () => {
    const red = redactSecrets({ Authorization: "Bearer abcdefghijklmnop", nested: "Bearer abcdefghijklmnop" });
    assert.equal(red.Authorization, "[redacted]");
    assert.throws(() => assertNoSecretLeak({ msg: FAKE }, { CFBD_API_KEY: FAKE }));
    const pub = collegePublicResult({ ok: true, status: 200, n: 3, path: "/ratings/sp", source: "cfbd" });
    assert.equal(JSON.stringify(pub).includes("Bearer"), false);
  });
});

describe("ingestion persistence visibility", () => {
  it("surfaces api_usage write failures instead of hiding them behind a successful API response", async () => {
    const env = {
      CFBD_API_KEY: FAKE,
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async run() {
                  throw new Error("no such table: api_usage");
                },
              };
            },
          };
        },
      },
    };
    const res = await collegeRequest("cfbd", "/ratings/sp", env, {
      query: { year: 2026 },
      skipCache: true,
      fetchFn: async () =>
        new Response(JSON.stringify([{ team: "A" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(res.ok, true);
    assert.equal(res.usagePersisted, false);
    assert.match(res.usageError || "", /api_usage-unavailable/);
    const pub = collegePublicResult(res);
    assert.equal(pub.usagePersisted, false);
    assert.match(pub.usageError || "", /api_usage-unavailable/);
  });

  it("college current-refresh code counts source-observation persistence failures", () => {
    const src = readFileSync(new URL("../functions/lib/collegeJobsCore.js", import.meta.url), "utf8");
    assert.match(src, /observationPersisted/);
    assert.match(src, /persistenceFailures/);
    assert.match(src, /writes\.writesFailed \+= persistenceFailures\.length/);
  });
});

describe("quota", () => {
  it("alerts at 50/75/90/100 and designs under 30k", () => {
    assert.equal(MONTHLY_QUOTA, 30000);
    assert.deepEqual(quotaAlerts(15000).map((a) => a.threshold), [0.5]);
    assert.ok(quotaAlerts(30000).some((a) => a.threshold === 1));
    const h = quotaHealth({ used: 27000 });
    assert.equal(h.level, "critical");
    const est = estimateMonthlyCalls();
    assert.equal(est.underCap, true);
    assert.equal(est.underDesign, true);
    assert.ok(utcMonthKey().match(/^\d{4}-\d{2}$/));
  });
});

describe("contracts and schemas", () => {
  it("covers every endpoint used", () => {
    for (const ep of ["/ratings/sp", "/ratings/fpi", "/ratings/core", "/games", "/teams/fbs"]) {
      assert.ok(contractFor("cfbd", ep), ep);
    }
    for (const ep of ["/ratings/adjusted", "/games", "/teams"]) {
      assert.ok(contractFor("cbbd", ep), ep);
    }
    assert.ok(CONTRACTS.every((c) => c.failure && c.units && c.asOf));
  });

  it("unwraps arrays and error objects", () => {
    assert.equal(unwrapCollegeResponse([{ team: "A" }]).data.length, 1);
    assert.equal(unwrapCollegeResponse({ message: "Unauthorized" }).error, "Unauthorized");
    const s = summarizeSchema([{ team: "A", offense: { rating: 1 } }]);
    assert.ok(s.fields.includes("team"));
    assert.ok(s.nested.offense.includes("rating"));
  });
});

describe("canonical identity", () => {
  it("keeps Miami FL vs OH and rejects State/Tech/Miami alone", () => {
    const fl = resolveTeamExact("cfb", { espnId: "2390" });
    const oh = resolveTeamExact("cfb", { espnId: "193" });
    assert.ok(fl && oh);
    assert.notEqual(fl.id, oh.id);
    assert.equal(miamiDisambiguation({ name: "Miami (OH)" }).espnId, "193");
    assert.equal(miamiDisambiguation({ name: "Miami Hurricanes" }).espnId, "2390");
    assert.equal(identityFailClosed("cfb", { name: "State" }).ok, false);
    assert.equal(identityFailClosed("cfb", { name: "Tech" }).ok, false);
    assert.equal(identityFailClosed("cfb", { name: "Miami" }).ok, false);
    assert.equal(AMBIGUOUS_ALONE.test("usc"), true);
  });

  it("maps source teams and enforces feature cutoff", () => {
    const mapped = mapSourceTeam("cfb", { school: "Ohio State", id: "194" });
    assert.equal(mapped.ok, true);
    const start = "2026-08-30T19:00:00.000Z";
    const cut = featureCutoffIso(start, { minutesBefore: 1 });
    assert.equal(cutoffViolated(cut, start), false);
    assert.equal(cutoffViolated("2026-08-30T20:00:00.000Z", start), true);
  });
});

describe("CBBD capability audit", () => {
  it("chunks the OpenAPI inventory without skipping the next window", async () => {
    resetCacheMem();
    const spec = {
      info: { title: "Test CBBD", version: "1.0" },
      paths: Object.fromEntries(
        ["/games", "/teams", "/ratings/adjusted", "/ratings/srs", "/players"].map((path) => [
          path,
          {
            get: {
              operationId: path.slice(1).replaceAll("/", "-"),
              parameters: [{ in: "query", name: "season", required: true }],
            },
          },
        ])
      ),
    };
    const fetchFn = async (url) => {
      if (String(url).endsWith("/api-docs.json")) {
        return { ok: true, status: 200, async json() { return spec; } };
      }
      const parsed = new URL(String(url));
      const season = Number(parsed.searchParams.get("season"));
      return {
        ok: true,
        status: 200,
        async json() { return [{ season, ok: true }]; },
      };
    };
    const env = { ...collegeDb(new Map()), CBBD_API_KEY: FAKE };
    const a = await runCbbdEndpointAudit(env, {
      seasons: [2024],
      maxRequests: 2,
      operationStart: 0,
      operationLimit: 2,
      fetchFn,
    });
    const b = await runCbbdEndpointAudit(env, {
      seasons: [2024],
      maxRequests: 2,
      operationStart: a.summary.nextOperationStart,
      operationLimit: 2,
      fetchFn,
    });
    assert.equal(a.summary.inventoryGetOperations, 5);
    assert.equal(a.summary.windowOperations, 2);
    assert.equal(a.summary.hasMore, true);
    assert.equal(a.summary.nextOperationStart, 2);
    assert.deepEqual(a.probes.map((p) => p.path), ["/games", "/teams"]);
    assert.deepEqual(b.probes.map((p) => p.path), ["/ratings/adjusted", "/ratings/srs"]);
    assert.equal(b.summary.nextOperationStart, 4);

    const last = await runCbbdEndpointAudit(env, {
      seasons: [2024],
      maxRequests: 2,
      operationStart: b.summary.nextOperationStart,
      operationLimit: 2,
      fetchFn,
    });
    assert.deepEqual(last.probes.map((p) => p.path), ["/players"]);
    assert.equal(last.summary.hasMore, false);
    assert.equal(last.summary.nextOperationStart, null);
  });

  it("discovers GET endpoints and proves historical season rows without exposing the key", async () => {
    resetCacheMem();
    const spec = {
      info: { title: "Test CBBD", version: "1.0" },
      paths: {
        "/games": {
          get: {
            operationId: "getGames",
            parameters: [
              { in: "query", name: "season", required: true },
              { in: "query", name: "team", required: false },
            ],
          },
        },
      },
    };
    const fetchFn = async (url) => {
      if (String(url).endsWith("/api-docs.json")) {
        return { ok: true, status: 200, async json() { return spec; } };
      }
      const parsed = new URL(String(url));
      const season = Number(parsed.searchParams.get("season"));
      return {
        ok: true,
        status: 200,
        async json() {
          return [{ id: `g-${season}`, season, homeTeam: "Duke", awayTeam: "UNC" }];
        },
      };
    };
    const env = { ...collegeDb(new Map()), CBBD_API_KEY: FAKE };
    const audit = await runCbbdEndpointAudit(env, {
      seasons: [2026, 2024, 2022],
      maxRequests: 10,
      fetchFn,
    });
    assert.equal(audit.ok, true);
    assert.equal(audit.schema.getOperations, 1);
    assert.equal(audit.summary.requestCount, 3);
    assert.equal(audit.probes[0].years["2026"].rowCount, 1);
    assert.equal(audit.probes[0].years["2024"].rowCount, 1);
    assert.equal(audit.probes[0].years["2022"].rowCount, 1);
    assert.equal(JSON.stringify(audit).includes(FAKE), false);
  });
});

describe("CFB formulas", () => {
  const game = { home: { canonicalId: "cfb-194" }, away: { canonicalId: "cfb-333" }, neutralSite: false };
  it("league baseline uses 2.5 HFA and zero on neutral", () => {
    const h = cfbLeagueBaseline(game);
    const n = cfbLeagueBaseline({ ...game, neutralSite: true });
    assert.equal(h.hfa, 2.5);
    assert.equal(n.hfa, 0);
    assert.ok(Math.abs(h.home + h.away - h.total) < 1e-9);
    assert.ok(Math.abs(h.home - h.away - h.margin) < 1e-9);
    assert.equal(HFA_CONST, CHAMPION_HFA);
  });

  it("ratings v1 uses opponent defense and preserves identity", () => {
    const p = cfbRatingsV1(game, { homeOff: 40, homeDef: 18, awayOff: 22, awayDef: 32 });
    assert.equal(p.ok, true);
    assert.ok(p.home > p.away);
    assert.ok(Math.abs(p.home + p.away - p.total) < 1e-9);
  });

  it("REG applies compact artifact without market features", () => {
    const p = cfbRegV1(game, { home_off: 38, home_def: 20, away_off: 24, away_def: 30, talent_diff: 100, returning_diff: 0.1 });
    assert.equal(p.ok, true);
    assert.equal(p.ok && JSON.stringify(p).includes("pin"), false);
  });

  it("ensemble ignores Monte Carlo and Pinnacle", () => {
    const a = cfbLeagueBaseline(game);
    const mc = attachMc(a);
    const pin = { ...pinnacleImplied({ odds: { total: 50, spread: -7 } }), modelId: "CFB-PINNACLE-IMPLIED", independent: false };
    const ens = independentEnsemble([a, mc, pin], "CFB-CFBD-ENSEMBLE-v1");
    assert.equal(ens.nMembers, 1);
    assert.ok(!ens.members.includes("CFB-PINNACLE-IMPLIED"));
  });

  it("shadow CFB cannot qualify", () => {
    const models = projectCfbChallengers(game, { home: { off: 38, def: 20 }, away: { off: 24, def: 30 } });
    for (const p of Object.values(models)) {
      assert.equal(p.canQualify, false);
      assert.equal(p.canLog, false);
      assert.equal(p.canWriteStrategy, false);
    }
    const rec = recommendBundle("cfb", { ...game, cfb: { bettingAllowed: false, blockReason: "shadow" }, marketUnresolved: false, model: { layers: { market: 0.5 }, projMargin: 7, projTotal: 50 }, odds: { spread: -3, total: 50 }, pin: {} }, { layers: { market: 0.5 } }, DEFAULT_WEIGHTS);
    assert.equal(rec.qualified, null);
  });
});

describe("CFB mismatch integrity", () => {
  it("does not halve opponent-adjusted power gaps", () => {
    const p = projectCfbMatchup({ homeOff: 32, homeDef: 23, awayOff: 17, awayDef: 36, hfa: 2.5, national: 26.5 });
    assert.equal(p.home, 42.8);
    assert.equal(p.away, 12.3);
    assert.equal(p.margin, 30.5);
  });

  it("resolves Idaho as a canonical FCS program", () => {
    const idaho = resolveTeam("cfb", { name: "Idaho Vandals", espnId: "70" });
    assert.equal(idaho?.school, "Idaho");
    assert.equal(idaho?.classification, "FCS");
  });
});

describe("CFB PRIOR_ONLY recommendation gate", () => {
  it("keeps an underdog value signal as a lean instead of CONVICTION", () => {
    const game = {
      sport: "cfb",
      home: { name: "Michigan State", school: "Michigan State" },
      away: { name: "Toledo", school: "Toledo" },
      cfb: { bettingAllowed: true, projectionState: "PRIOR_ONLY", sigmaMargin: 36.2, sigmaTotal: 31.6 },
      odds: { spread: -10, total: 49.5, pinPresent: true, pinHomeMl: -434, pinAwayMl: 323, heritageListed: false },
      pin: {
        ml: { priceA: -434, priceB: 323, noVigA: 0.7746664304, noVigB: 0.2253335696, complete: true },
        spread: { complete: false }, total: { complete: false },
      },
    };
    const model = { layers: { market: 0.7746664304, score: 0.588526727 }, projMargin: 8.1, projTotal: 48.7 };
    const bundle = recommendBundle("cfb", game, model, DEFAULT_WEIGHTS);
    assert.equal(bundle.qualified, null);
    assert.equal(bundle.lean?.pick, "Toledo");
    assert.equal(bundle.lean?.tag, "LEAN");
    assert.match(bundle.lean?.reason || "", /PRIOR_ONLY/);
  });
});

describe("CBB formulas", () => {
  const game = { home: { canonicalId: "cbb-150" }, away: { canonicalId: "cbb-87" }, neutralSite: false };
  const ratings = { homeAdjOe: 118, homeAdjDe: 92, homeTempo: 70, awayAdjOe: 104, awayAdjDe: 110, awayTempo: 66 };

  it("uses opposing defenses and identity-preserving total", () => {
    const p = cbbRatingsV1(game, ratings);
    assert.equal(p.ok, true);
    assert.ok(Math.abs(p.home + p.away - p.total) < 1e-9);
    const old = rejectedOldCbbTotal(118, 104, 70, 66);
    assert.notEqual(Math.round(p.total * 10), Math.round(old * 10));
    const poss = expectedPossessions(70, 66);
    assert.equal(poss, 68);
    const eff = expectedEfficiency(118, 110, CBB_NATIONAL_EFF);
    assert.ok(eff > 118);
  });

  it("zero HCA on neutral and does not assume 60/40 tempo", () => {
    const n = cbbLeagueBaseline({ ...game, neutralSite: true });
    assert.equal(n.hca, 0);
    assert.equal(n.home, n.away);
  });

  it("Torvik unavailable and KenPom absent continue without them", () => {
    assert.equal(torvikUnavailable().available, false);
    assert.equal(kenpomAbsent().available, false);
    const models = projectCbbChallengers(game, { ratings });
    assert.equal(models["CBB-TORVIK-RATINGS-v1"].available, false);
    assert.equal(models["CBB-KENPOM-SHADOW"].available, false);
    assert.equal(models["CBB-CBBD-RATINGS-v1"].canQualify, false);
  });

  it("market-shrunk is labeled market-informed", () => {
    const ind = cbbRatingsV1(game, ratings);
    const pin = pinnacleImplied({ odds: { total: 148, spread: -6.5 } });
    const s = cbbMarketShrunk(ind, pin);
    assert.equal(s.marketInformed, true);
    assert.equal(s.independent, false);
  });
});

describe("promotion and N=0", () => {
  it("never auto-promotes without operator approval", () => {
    const d = evaluatePromotion({ n: 5000, maeImproved: true, biasAbs: 0.1, leakageOk: true, operatorApproved: false, artifactOk: true });
    assert.equal(d.promote, false);
    assert.ok(PROMOTION_CRITERIA.neverEvidence.includes("7-0 cohort"));
    assert.equal(shadowCannotQualify("CFB-CFBD-RATINGS-v1"), true);
    assert.equal(unavailableMetric(0).available, false);
    assert.equal(unavailableMetric(0).label.includes("N=0"), true);
    assert.equal(metricUnavailable(0).display.includes("unavailable"), true);
  });
});

describe("immutable snapshots and grading", () => {
  it("INSERT OR IGNORE keeps the first frozen challenger", async () => {
    const rows = new Map();
    const env = collegeDb(rows);
    const row = {
      id: "cfb:1:CFB-CFBD-RATINGS-v1:cut",
      sport: "cfb",
      gameId: "1",
      modelId: "CFB-CFBD-RATINGS-v1",
      modelVersion: "v1",
      role: "shadow",
      projHome: 31.2,
      projAway: 21.4,
      projMargin: 9.8,
      projTotal: 52.6,
      canQualify: false,
      frozenAt: "2026-08-27T12:00:00.000Z",
      contentHash: "a",
    };
    const a = await insertModelPrediction(env, row);
    const b = await insertModelPrediction(env, { ...row, projHome: 99 });
    assert.equal(a.inserted, 1);
    assert.equal(b.already, 1);
    assert.equal(rows.get(row.id).proj_home, 31.2);
    await gradeModelPrediction(env, { id: row.id, actualHome: 34, actualAway: 17, grade: { ok: true } });
    assert.equal(rows.get(row.id).actual_home, 34);
    assert.equal(rows.get(row.id).proj_home, 31.2);
  });

  it("grades a completed fixture without rewriting inputs", () => {
    const g = gradeScores({ proj_home: 31, proj_away: 21 }, 34, 17);
    assert.equal(g.winnerHit, true);
    assert.equal(g.errHome, 31 - 34);
    assert.equal(g.errTotal, (31 + 21) - (34 + 17));
  });

  it("freeze helper never sets canQualify", () => {
    const game = { id: "401628000", start: "2026-08-30T19:00:00.000Z", home: { canonicalId: "cfb-194" }, away: { canonicalId: "cfb-333" } };
    const models = projectCfbChallengers(game, { home: { off: 40, def: 18 }, away: { off: 22, def: 32 } });
    const frozen = freezeChallengerPredictions(game, models, { sport: "cfb" });
    assert.ok(frozen.length >= 1);
    assert.ok(frozen.every((r) => r.canQualify === false));
  });
});

describe("jobs, R2, storage", () => {
  it("lists required jobs and refuses unknown", async () => {
    assert.ok(COLLEGE_JOBS.includes("model-promote"));
    assert.ok(COLLEGE_JOBS.includes("cfb-current-refresh"));
    assert.ok(COLLEGE_JOBS.includes("cfb-qb-transfer-refresh"));
    assert.ok(COLLEGE_JOBS.includes("cfbd-endpoint-audit"));
    assert.ok(COLLEGE_JOBS.includes("cbbd-endpoint-audit"));
    const env = collegeDb(new Map());
    const unknown = await runCollegeJob("nope", env);
    assert.equal(unknown.status, "failed");
    const health = await runCollegeJob("college-health", env);
    assert.equal(health.job, "college-health");
    const dump = JSON.stringify(health);
    assert.equal(dump.includes(FAKE), false);
    const promo = await runCollegeJob("model-promote", env, { sport: "cfb", modelId: "CFB-CFBD-RATINGS-v1", referenceModelId: "CFB-PINNACLE-IMPLIED", operatorApproved: false });
    assert.equal(promo.d1.promotion.promote, false);
    const train = await runCollegeJob("model-train-validate", env);
    assert.equal(train.status, "success");
    assert.ok(Array.isArray(train.d1?.validation));
  });

  it("documents R2 without blocking", () => {
    assert.equal(r2Bound({}), false);
    assert.ok(r2Key({ source: "cfbd", sport: "cfb", season: 2025, endpoint: "/games", hash: "abc" }).startsWith("raw/"));
    assert.ok(R2_SETUP.binding === "ARCHIVE");
    assert.equal(warnLevel(80, 100), "watch");
  });
});

describe("champion freeze", () => {
  it("did not change champion HFA, HC-v1, or 7-0", () => {
    assert.equal(CHAMPION_HFA, 2.5);
    assert.equal(STRATEGY_HC_V1.reportedRecord, "7-0");
    assert.equal(STRATEGY_HC_V1.reconstructionConfidence, "operator-declared");
    assert.equal(DEFAULT_WEIGHTS.market, 0.22);
  });
});

describe("no keys in contracts or artifacts", () => {
  it("checked-in files have empty placeholders only", () => {
    const envEx = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    assert.match(envEx, /CFBD_API_KEY=\s*$/m);
    const blob = readFileSync(new URL("../data/contracts/college-endpoints.js", import.meta.url), "utf8");
    assert.equal(/Bearer\s+\S{8,}/.test(blob), false);
  });
});

function collegeDb(rows) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.includes("INSERT OR IGNORE") && sql.includes("model_predictions")) {
                  const id = args[0];
                  if (!rows.has(id)) {
                    rows.set(id, { id, proj_home: args[7], actual_home: args[20], actual_away: args[21] });
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                if (sql.includes("UPDATE model_predictions")) {
                  const id = args[4];
                  const row = rows.get(id);
                  if (row && row.actual_home == null) {
                    row.actual_home = args[0];
                    row.actual_away = args[1];
                  }
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes("SUM") || sql.includes("COUNT")) return { used: 0, cache_hits: 0, n: 0, bytes: 0 };
                return { ok: 1 };
              },
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
}
