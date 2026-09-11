import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAuditStatus,
  runCfbdEndpointAudit,
  probeCfbdEndpoint,
  AUDIT_CLASS,
} from "../functions/lib/cfbdEndpointAudit.js";
import {
  CFBD_FEATURE_CATALOG,
  featureAvailabilityTable,
  markdownFeatureTable,
  independentModelFeatures,
} from "../functions/lib/cfbdFeatureCatalog.js";
import {
  assertPregameTemporalIntegrity,
  filterGamesBeforeKickoff,
  shrinkageWeight,
  blendPriorCurrent,
  buildPregameFeatureRecord,
  rollingTeamStrengthFromGames,
  markLeakageRisk,
} from "../functions/lib/cfbFeatureStore.js";
import {
  projectCfbFbisV2,
  attachCfbFbisV2,
  ablationSuite,
  fcsStrengthAdjustment,
  qbValueAdjustment,
  CFB_FBIS_V2_ID,
  ABLATION_MASKS,
} from "../functions/lib/cfbFbisV2.js";
import { COLLEGE_JOBS, runCollegeJob } from "../functions/lib/collegeJobs.js";
import { COLLEGE_MODELS, shadowCannotQualify, PROMOTION_CRITERIA, evaluatePromotionEvidence } from "../functions/lib/collegeModels.js";
import { CFBD_ENDPOINT_PROBES } from "../data/cfbd/endpoint-probe-plan.js";
import { estimateMonthlyCalls } from "../functions/lib/quota.js";

function mockFetchFactory(handler) {
  return async (url, init = {}) => {
    const auth = init.headers?.Authorization || "";
    assert.equal(/Bearer\s+\S+/.test(auth), true);
    assert.equal(JSON.stringify(init).includes("test-college-key-not-real") || auth.includes("test-college-key-not-real"), true);
    return handler(url, init);
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === "__malformed__") throw new Error("bad-json");
      return body;
    },
  };
}

describe("cfbd endpoint audit", () => {
  it("classifies status families", () => {
    assert.equal(classifyAuditStatus({ httpStatus: 200, ok: true, rowCount: 3 }), AUDIT_CLASS.AVAILABLE);
    assert.equal(classifyAuditStatus({ httpStatus: 200, ok: true, rowCount: 0 }), AUDIT_CLASS.AVAILABLE_BUT_EMPTY);
    assert.equal(classifyAuditStatus({ httpStatus: 401, ok: false }), AUDIT_CLASS.AUTH_FAILURE);
    assert.equal(classifyAuditStatus({ httpStatus: 403, ok: false }), AUDIT_CLASS.NOT_ENTITLED);
    assert.equal(classifyAuditStatus({ httpStatus: 404, ok: false }), AUDIT_CLASS.DEPRECATED);
    assert.equal(classifyAuditStatus({ httpStatus: 400, ok: false }), AUDIT_CLASS.INVALID_PARAMETERS);
    assert.equal(classifyAuditStatus({ httpStatus: 429, ok: false }), AUDIT_CLASS.TRANSIENT_FAILURE);
    assert.equal(classifyAuditStatus({ httpStatus: 500, ok: false }), AUDIT_CLASS.TRANSIENT_FAILURE);
    assert.equal(classifyAuditStatus({ httpStatus: 0, ok: false, error: "no-api-key" }), AUDIT_CLASS.AUTH_FAILURE);
  });

  it("fails safely without API key", async () => {
    const report = await runCfbdEndpointAudit({}, { seasons: [2025], probes: CFBD_ENDPOINT_PROBES.slice(0, 3) });
    assert.equal(report.summary.configured, false);
    assert.ok(report.endpoints.every((e) => e.classification === AUDIT_CLASS.AUTH_FAILURE));
    assert.equal(JSON.stringify(report).includes("Bearer"), false);
  });

  it("records valid, empty, 401, 403, 404, 429, 5xx, and malformed JSON", async () => {
    const env = { CFBD_API_KEY: "test-college-key-not-real" };
    const map = {
      "/games": jsonResponse(200, [{ id: 1, homeTeam: "A", awayTeam: "B" }]),
      "/teams": jsonResponse(200, []),
      "/teams/fbs": jsonResponse(401, { message: "Unauthorized" }),
      "/conferences": jsonResponse(403, { message: "upgrade plan" }),
      "/venues": jsonResponse(404, { message: "Not Found" }),
      "/stats/season": jsonResponse(429, { message: "rate limit" }),
      "/ppa/teams": jsonResponse(503, { message: "unavailable" }),
      "/talent": jsonResponse(200, "__malformed__"),
    };
    const fetchFn = mockFetchFactory(async (url) => {
      const path = new URL(url).pathname;
      return map[path] || jsonResponse(200, [{ ok: true }]);
    });
    const probes = Object.keys(map).map((endpoint) => ({
      family: "test",
      endpoint,
      query: (y) => ({ year: y }),
    }));
    const report = await runCfbdEndpointAudit(env, { seasons: [2025], probes, fetchFn });
    const by = report.byEndpoint;
    assert.equal(by["/games"].classification, AUDIT_CLASS.AVAILABLE);
    assert.ok(by["/games"].sampleFieldNames.includes("homeTeam"));
    assert.equal(by["/teams"].classification, AUDIT_CLASS.AVAILABLE_BUT_EMPTY);
    assert.equal(by["/teams/fbs"].classification, AUDIT_CLASS.AUTH_FAILURE);
    assert.equal(by["/conferences"].classification, AUDIT_CLASS.NOT_ENTITLED);
    assert.equal(by["/venues"].classification, AUDIT_CLASS.DEPRECATED);
    assert.equal(by["/stats/season"].classification, AUDIT_CLASS.TRANSIENT_FAILURE);
    assert.equal(by["/ppa/teams"].classification, AUDIT_CLASS.TRANSIENT_FAILURE);
    assert.equal(by["/talent"].classification, AUDIT_CLASS.TRANSIENT_FAILURE);
    assert.equal(JSON.stringify(report).includes("test-college-key-not-real"), false);
  });

  it("probeCfbdEndpoint never returns the bearer", async () => {
    const env = { CFBD_API_KEY: "test-college-key-not-real" };
    const res = await probeCfbdEndpoint("/games", env, {
      query: { year: 2025 },
      fetchFn: mockFetchFactory(async () => jsonResponse(200, [{ id: 1 }])),
    });
    assert.equal(res.ok, true);
    assert.equal(JSON.stringify(res).includes("test-college-key-not-real"), false);
  });

  it("college job is registered and runs without key", async () => {
    assert.ok(COLLEGE_JOBS.includes("cfbd-endpoint-audit"));
    const out = await runCollegeJob("cfbd-endpoint-audit", {}, { seasons: [2025], probes: CFBD_ENDPOINT_PROBES.slice(0, 2) });
    assert.equal(out.ok, true);
    assert.equal(out.job, "cfbd-endpoint-audit");
    assert.ok(out.d1.audit.featureTableMarkdown.includes("Feature"));
  });
});

describe("feature catalog", () => {
  it("includes candidate groups and excludes market from independent set", () => {
    assert.ok(CFBD_FEATURE_CATALOG.some((f) => f.canonical === "ppa_offense_passing"));
    assert.ok(CFBD_FEATURE_CATALOG.some((f) => f.canonical === "closing_lines" && f.use === "evaluation"));
    assert.ok(independentModelFeatures().every((f) => f.use !== "evaluation"));
    const table = featureAvailabilityTable({
      "/ppa/teams": { classification: "AVAILABLE", sampleFieldNames: ["offense.overall"] },
      "/lines": { classification: "AVAILABLE", sampleFieldNames: ["lines"] },
    });
    const pass = table.find((r) => r.feature === "ppa_offense_passing");
    const lines = table.find((r) => r.feature === "closing_lines");
    assert.equal(pass.available2026, "✅");
    assert.equal(lines.use, "evaluation");
    assert.equal(lines.pregameSafe, "❌ model");
    assert.ok(markdownFeatureTable(table).includes("| Feature |"));
  });
});

describe("temporal feature store", () => {
  it("rejects post-kickoff timestamps", () => {
    const kick = "2025-10-11T19:00:00.000Z";
    const bad = assertPregameTemporalIntegrity({
      kickoffTimestamp: kick,
      featureAsOfTimestamp: "2025-10-11T20:00:00.000Z",
      featureCutoffTimestamp: "2025-10-11T18:59:00.000Z",
      collectionTimestamp: "2025-10-11T18:50:00.000Z",
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.includes("feature-as-of-after-kickoff"));
  });

  it("accepts pregame-safe cutoffs and filters future games", () => {
    const kick = "2025-10-11T19:00:00.000Z";
    const ok = assertPregameTemporalIntegrity({
      kickoffTimestamp: kick,
      featureAsOfTimestamp: "2025-10-11T18:00:00.000Z",
      featureCutoffTimestamp: "2025-10-11T18:59:00.000Z",
      collectionTimestamp: "2025-10-11T18:00:00.000Z",
    });
    assert.equal(ok.ok, true);
    const games = filterGamesBeforeKickoff(
      [
        { team: "Ohio State", startDate: "2025-10-04T19:00:00.000Z", offense: { overall: 0.3 } },
        { team: "Ohio State", startDate: "2025-10-11T19:00:00.000Z", offense: { overall: 0.9 } },
        { team: "Ohio State", startDate: "2025-10-18T19:00:00.000Z", offense: { overall: 0.5 } },
      ],
      kick
    );
    assert.equal(games.length, 1);
    const rolling = rollingTeamStrengthFromGames(
      [
        { team: "Ohio State", startDate: "2025-10-04T19:00:00.000Z", offense: { overall: 0.2, passing: 0.3, rushing: 0.1 }, defense: { overall: -0.1, passing: 0, rushing: -0.05 } },
      ],
      "Ohio State",
      { kickoffTimestamp: kick }
    );
    assert.equal(rolling.gamesPlayed, 1);
    assert.equal(rolling.leakageRisk, "none");
  });

  it("marks full-season aggregates as excluded without reconstruction", () => {
    const marked = markLeakageRisk({ grain: "season", leakageRisk: "high" }, { weekBounded: false, reconstructedFromGames: false });
    assert.equal(marked.excludedFromTemporal, true);
    const safe = markLeakageRisk({ grain: "season", leakageRisk: "high" }, { reconstructedFromGames: true });
    assert.equal(safe.excludedFromTemporal, false);
  });

  it("builds records with required temporal fields", () => {
    const rec = buildPregameFeatureRecord({
      gameId: "401234",
      season: 2025,
      week: 8,
      kickoffTimestamp: "2025-10-11T19:00:00.000Z",
      homeTeam: "Ohio State",
      awayTeam: "Nebraska",
      features: { home_off: 35 },
      featureAsOfTimestamp: "2025-10-11T12:00:00.000Z",
      collectionTimestamp: "2025-10-11T12:00:00.000Z",
    });
    assert.equal(rec.temporalOk, true);
    assert.ok(rec.feature_cutoff_timestamp);
    assert.ok(rec.source_version);
  });

  it("uses n/(n+6) shrinkage benchmark", () => {
    assert.equal(shrinkageWeight(6, 6), 0.5);
    const b = blendPriorCurrent(20, 40, 6, 6);
    assert.equal(b.value, 30);
  });
});

describe("CFB-FBIS-v2 model", () => {
  const baseGame = {
    sport: "cfb",
    home: { name: "Ohio State", abbr: "OSU" },
    away: { name: "Oregon", abbr: "ORE" },
    neutralSite: false,
    pinSpread: -7.5,
    pinTotal: 55.5,
    cfbFbisV2Input: {
      home: {
        priorOff: 38, priorDef: 16, off: 40, def: 15, gamesPlayed: 6,
        passEpa: 0.25, passEpaAllowed: 0.05, rushEpa: 0.12, rushEpaAllowed: 0.04,
        successRate: 0.48, successRateAllowed: 0.38, explosiveRate: 0.15, explosiveRateAllowed: 0.1,
        havocRate: 0.18, havocAllowed: 0.12, lineYards: 3.5, lineYardsAllowed: 2.6,
        pointsPerOpportunity: 4.5, pointsPerOpportunityAllowed: 3.2,
        qbPpa: 0.35, ppaOffensePassing: 0.22, qbStarterKnown: true, qbGamesPlayed: 6, paceNorm: 0.1,
      },
      away: {
        priorOff: 34, priorDef: 20, off: 33, def: 21, gamesPlayed: 6,
        passEpa: 0.1, passEpaAllowed: 0.18, rushEpa: 0.08, rushEpaAllowed: 0.1,
        successRate: 0.42, successRateAllowed: 0.45, explosiveRate: 0.11, explosiveRateAllowed: 0.14,
        havocRate: 0.14, havocAllowed: 0.16, lineYards: 2.9, lineYardsAllowed: 3.1,
        pointsPerOpportunity: 3.6, pointsPerOpportunityAllowed: 4.1,
        qbPpa: 0.12, ppaOffensePassing: 0.1, qbStarterKnown: true, qbGamesPlayed: 6, paceNorm: -0.05,
      },
    },
  };

  it("is deterministic and projection-enabled without qualification", () => {
    const a = projectCfbFbisV2(baseGame);
    const b = projectCfbFbisV2(baseGame);
    assert.equal(a.ok, true);
    assert.deepEqual(a.home, b.home);
    assert.deepEqual(a.away, b.away);
    assert.equal(a.modelId, CFB_FBIS_V2_ID);
    assert.equal(a.canQualify, false);
    assert.equal(shadowCannotQualify(CFB_FBIS_V2_ID), true);
    assert.equal(COLLEGE_MODELS[CFB_FBIS_V2_ID].role, "production-projection");
    assert.equal(COLLEGE_MODELS[CFB_FBIS_V2_ID].projectionEnabled, true);
    assert.equal(COLLEGE_MODELS[CFB_FBIS_V2_ID].canAuthorizeWager, false);
  });

  it("zeros HFA on neutral and keeps 2.5 at home", () => {
    const home = projectCfbFbisV2(baseGame);
    const neut = projectCfbFbisV2({ ...baseGame, neutralSite: true });
    assert.equal(home.decomposition.HFA, 2.5);
    assert.equal(neut.decomposition.HFA, 0);
  });

  it("ignores market lines for independent score", () => {
    const withMkt = projectCfbFbisV2(baseGame);
    const noMkt = projectCfbFbisV2({ ...baseGame, pinSpread: null, pinTotal: null });
    assert.equal(withMkt.home, noMkt.home);
    assert.equal(withMkt.away, noMkt.away);
    assert.equal(withMkt.provenance.marketUsed, false);
    assert.equal(withMkt.marketInformed, false);
  });

  it("widens uncertainty for missing QB and FCS provisional", () => {
    const known = projectCfbFbisV2(baseGame);
    const unknownQb = projectCfbFbisV2({
      ...baseGame,
      cfbFbisV2Input: {
        ...baseGame.cfbFbisV2Input,
        home: { ...baseGame.cfbFbisV2Input.home, qbStarterKnown: false, qbPpa: null },
      },
    });
    assert.ok(unknownQb.uncertainty.margin_sigma >= known.uncertainty.margin_sigma);
    const fcs = fcsStrengthAdjustment({ classification: "fcs" });
    assert.equal(fcs.provisional, true);
    const fcsProj = projectCfbFbisV2({
      ...baseGame,
      cfbFbisV2Input: {
        ...baseGame.cfbFbisV2Input,
        away: { ...baseGame.cfbFbisV2Input.away, classification: "FCS" },
      },
    });
    assert.equal(fcsProj.provisional, true);
    assert.ok(fcsProj.uncertainty.margin_sigma > known.uncertainty.margin_sigma);
  });

  it("does not invent matchup advantage from missing features", () => {
    const sparse = projectCfbFbisV2({
      sport: "cfb",
      home: { name: "A" },
      away: { name: "B" },
      cfbFbisV2Input: {
        home: { priorOff: 30, priorDef: 24, gamesPlayed: 0 },
        away: { priorOff: 28, priorDef: 26, gamesPlayed: 0 },
      },
    });
    assert.equal(sparse.ok, true);
    assert.equal(sparse.decomposition.PASS_MATCHUP, null);
    assert.equal(sparse.decomposition.RUSH_MATCHUP, null);
  });

  it("reconciles decomposition to raw margin and supports ablations", () => {
    const p = projectCfbFbisV2(baseGame, { ablation: "K" });
    assert.equal(p.provenance.reconcileOk, true);
    const suite = ablationSuite(baseGame);
    assert.equal(suite.length, Object.keys(ABLATION_MASKS).length);
    assert.ok(suite.every((row) => row.projection.ok));
    const baseOnly = suite.find((s) => s.ablation === "A").projection;
    assert.equal(baseOnly.decomposition.mask.pass, undefined);
  });

  it("attach marks qualification forbidden", () => {
    const attached = attachCfbFbisV2([baseGame]);
    assert.equal(attached.meta.qualificationAllowed, false);
    assert.equal(attached.games[0].challengers[CFB_FBIS_V2_ID].canQualify, false);
  });

  it("QB residual is separate from team pass baseline", () => {
    const adj = qbValueAdjustment({ qbPpa: 0.4, ppaOffensePassing: 0.2, qbStarterKnown: true, qbGamesPlayed: 8 });
    assert.ok(adj.points > 0);
    assert.equal(adj.state, "KNOWN");
  });
});

describe("promotion gates unchanged", () => {
  it("does not promote provisional CFB-FBIS-v2 without evidence", () => {
    const decision = evaluatePromotionEvidence({
      n: 50,
      seasons: 1,
      maeImprovement: 0.01,
      biasAbs: 0.2,
      brierDegradation: 0,
      coverage: 0.95,
      leakageOk: true,
      operatorApproved: false,
      artifactOk: true,
    });
    assert.equal(decision.promote, false);
    assert.equal(PROMOTION_CRITERIA.minOosN, 400);
    assert.equal(PROMOTION_CRITERIA.minSeasons, 3);
    assert.equal(PROMOTION_CRITERIA.requireOperatorApproval, true);
  });
});

describe("quota design with v2 pipeline", () => {
  it("stays under monthly design target", () => {
    const est = estimateMonthlyCalls();
    assert.equal(est.underCap, true);
    assert.equal(est.underDesign, true);
    assert.ok(est.dailyCfbFbisV2 >= 1);
  });
});
