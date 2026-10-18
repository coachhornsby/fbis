import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SDV_SOURCE_REGISTRY,
  searchSdvRegistry,
  summarizeSdvRegistry,
  DATASET_STATUS,
} from "../functions/lib/cfbSdvSourceRegistry.js";
import {
  CFBD_ENDPOINT_REGISTRY,
  searchCfbdRegistry,
  summarizeCfbdRegistry,
} from "../functions/lib/cfbCfbdSourceRegistry.js";
import {
  buildLineageRecord,
  resolveProviderConflict,
  assertNotSilentRetrospective,
  INCOMPATIBLE_OVERLAPS,
} from "../functions/lib/cfbCanonicalLineage.js";
import {
  buildSourceModelMatrix,
  buildScoringProvenance,
  searchUtilizationMatrix,
} from "../functions/lib/cfbSourceModelMatrix.js";
import {
  buildCollectionManifest,
  validateCollectionEvidence,
  detectCollectionAlerts,
  retryGuard,
  compareExistingVsRequired,
  buildWeeklyOperatingReport,
  EXPECTED_FBS_TEAM_FLOOR,
} from "../functions/lib/cfbWeeklyCollection.js";
import {
  summarizeRetentionPolicy,
  proposeCfbRetentionRelease,
  RETAIN_PERMANENTLY,
} from "../functions/lib/cfbRetentionPolicy.js";
import {
  buildCoreWeeklyArchivePayload,
  coreArchiveRowsFromPayload,
  evaluateCoreResearchReadiness,
  CORE_RESEARCH_ONLY,
} from "../functions/lib/cfbCoreArchive.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";
import {
  runOklahomaProjectionAudit,
  OKLAHOMA_ESPN_ID,
  OKLAHOMA_STATE_ESPN_ID,
} from "../functions/lib/cfbOklahomaAudit.js";

test("SDV registry is searchable and never champion-consumed", () => {
  const summary = summarizeSdvRegistry();
  assert.ok(summary.nDatasets >= 8);
  assert.equal(summary.championConsumes, 0);
  const hits = searchSdvRegistry("epa");
  assert.ok(hits.length >= 1);
  assert.ok(SDV_SOURCE_REGISTRY.every((d) => d.championConsumes === false));
});

test("CFBD registry documents champion PPA overall and unused advanced fields", () => {
  const summary = summarizeCfbdRegistry();
  assert.ok(summary.nEndpoints >= 10);
  assert.match(summary.championContract, /overall PPA/i);
  const ppa = CFBD_ENDPOINT_REGISTRY.find((e) => e.id === "cfbd-ppa-teams");
  assert.equal(ppa.championConsumes, true);
  assert.ok(ppa.unusedByChampion.includes("offense.passing"));
  const core = CFBD_ENDPOINT_REGISTRY.find((e) => e.id === "cfbd-ratings-core");
  assert.equal(core.championConsumes, false);
  assert.equal(core.researchConsumes, true);
  const found = searchCfbdRegistry("havoc");
  assert.ok(found.endpoints.length + found.features.length >= 1);
});

test("lineage rejects silent retrospective and incompatible averages", () => {
  const rec = buildLineageRecord({
    provider: "cfbd",
    sourceDataset: "cfbd-ppa-teams",
    originalField: "offense.overall",
    canonicalFeature: "ppaOff",
    originalValue: -0.04,
    teamId: "201",
    season: 2026,
    throughWeek: 6,
    units: "PPA/play",
    modelEligibility: "champion",
    validationStatus: "ok",
  });
  assert.equal(rec.provider, "cfbd");
  assert.equal(rec.missingness, false);
  assert.ok(INCOMPATIBLE_OVERLAPS.some((o) => o.rule === "reject_average"));

  const conflict = resolveProviderConflict({
    concept: "epa_or_ppa_per_play",
    purpose: "champion",
    candidates: [
      { provider: "sdv", value: 12.5 },
      { provider: "cfbd", value: -0.04 },
    ],
  });
  assert.equal(conflict.winner.provider, "cfbd");
  assert.equal(conflict.conflict, true);
  assert.notEqual(conflict.rule, "average");

  const retro = assertNotSilentRetrospective({
    seasonComplete: true,
    sourceGrain: "season",
    labeledRetrospective: false,
  });
  assert.equal(retro.ok, false);
  assert.equal(retro.error, "retrospective_reconstruction_unlabeled");
});

test("utilization matrix: SDV champion hits must be 0; page≠model", () => {
  const matrix = buildSourceModelMatrix();
  assert.equal(matrix.counts.sdvChampionConsumed, 0);
  assert.ok(matrix.counts.championConsumed >= 5);
  assert.ok(matrix.counts.uiOrResearchOnly >= 1);
  const success = matrix.rows.find((r) => r.canonicalFeature === "offensiveSuccessRate");
  assert.equal(success.consumedByCfbFbisV2, false);
  assert.equal(success.availableButUnused, true);
  const filtered = searchUtilizationMatrix("core");
  assert.ok(filtered.rows.some((r) => String(r.canonicalFeature).includes("core")));
});

test("scoring provenance diagnostics on missing inputs; no silent reuse", () => {
  const prov = buildScoringProvenance({
    homeFeatures: { ppaOff: -0.04, ppaDef: -0.1, gamesPlayed: 6, offensiveSuccessRate: 0.4 },
    awayFeatures: { ppaOff: null, ppaDef: null, gamesPlayed: 0 },
    homeTeamId: "201",
    awayTeamId: "66",
    season: 2026,
    throughWeek: 6,
  });
  assert.equal(prov.home.consumed.ppaOff, -0.04);
  assert.ok(prov.home.presentButUnusedByChampion.includes("offensiveSuccessRate"));
  assert.ok(prov.away.missingCritical.includes("ppaOff"));
  assert.equal(prov.ok, false);
  assert.ok(prov.diagnostics.some((d) => d.code === "missing_champion_input"));
});

test("HTTP 200 with empty rows is not verified complete", () => {
  const v = validateCollectionEvidence({
    httpStatus: 200,
    rows: [],
    expectedTeamFloor: EXPECTED_FBS_TEAM_FLOOR,
  });
  assert.equal(v.httpOk, true);
  assert.equal(v.usable, false);
  assert.equal(v.reason, "empty_payload");

  const manifest = buildCollectionManifest({
    season: 2026,
    week: 8,
    evidenceByDataset: {
      "cfbd-ppa-teams": { httpOk: true, rowCount: 0, schemaOk: true },
    },
  });
  const ppa = manifest.datasets.find((d) => d.datasetId === "cfbd-ppa-teams");
  assert.equal(ppa.status, DATASET_STATUS.FAILED);
  assert.ok(manifest.alerts.some((a) => a.code === "http_ok_empty_payload" || a.code === "required_source_failed"));
});

test("partial coverage and quota block raise alerts", () => {
  const manifest = buildCollectionManifest({
    season: 2026,
    week: 8,
    allowanceBlocked: true,
    evidenceByDataset: {
      "cfbd-ppa-teams": {
        httpOk: true,
        rowCount: 40,
        teamCoverage: 40,
        schemaOk: true,
      },
    },
  });
  assert.ok(manifest.datasets.some((d) => d.status === DATASET_STATUS.BLOCKED_ALLOWANCE));
  assert.ok(manifest.alerts.some((a) => a.code === "blocked_by_provider_allowance"));
});

test("idempotent retry guard skips duplicate hash writes", () => {
  const same = retryGuard({
    priorBatchId: "a",
    newBatchId: "b",
    priorContentHash: "abc",
    newContentHash: "abc",
  });
  assert.equal(same.allow, true);
  assert.equal(same.skipWrite, true);
  const dupBatch = retryGuard({ priorBatchId: "x", newBatchId: "x" });
  assert.equal(dupBatch.allow, false);
});

test("retention policy blocks permanent class deletion", () => {
  const policy = summarizeRetentionPolicy();
  assert.ok(policy.permanentCount >= 8);
  assert.ok(RETAIN_PERMANENTLY.some((c) => c.id === "core_weekly_pit"));
  const blocked = proposeCfbRetentionRelease({
    retentionClassId: "raw_source_versions",
    r2ArchiveVerified: true,
    r2ReadbackSha256: "a".repeat(64),
    independentRestoreVerified: true,
    consumerAuditComplete: true,
    retentionReleaseAuthorized: true,
  });
  assert.equal(blocked.authorized, false);
  assert.equal(blocked.blockedReason, "not_expireable_class");
});

test("CORE weekly archive is research-only and builds team rows", () => {
  assert.equal(CORE_RESEARCH_ONLY, true);
  const payload = buildCoreWeeklyArchivePayload({
    season: 2026,
    targetWeek: 8,
    coreRows: [
      {
        team: "Oklahoma",
        year: 2026,
        throughWeek: 7,
        throughSeasonType: "regular",
        overall: 1.2,
        offense: 2.0,
        defense: -0.5,
      },
      {
        team: "Texas",
        year: 2026,
        throughWeek: 7,
        throughSeasonType: "regular",
        overall: 5.0,
        offense: 4.0,
        defense: -1.0,
      },
    ],
    collectionTime: "2026-10-13T12:00:00.000Z",
    ingestionBatchId: "test-batch",
  });
  assert.equal(payload.throughWeek, 7);
  assert.equal(payload.researchOnly, true);
  assert.equal(payload.canInfluenceProjection, false);
  const rows = coreArchiveRowsFromPayload(payload);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].research_only, 1);
  const ready = evaluateCoreResearchReadiness({ archiveTeamCount: rows.length, expectedFloor: 100 });
  assert.equal(ready.researchReady, false);
  assert.equal(ready.championEligible, false);
});

test("projection scoring provenance is attached without changing coefficients", () => {
  const proj = projectCfbFbisV2({
    home: "Oklahoma",
    away: "Texas",
    homeEspnId: OKLAHOMA_ESPN_ID,
    awayEspnId: "251",
    season: 2026,
    week: 8,
    cfbFbisV2Input: {
      home: {
        offensePpa: -0.04,
        defensePpa: -0.16,
        gamesPlayed: 6,
        priorOff: 32,
        priorDef: 22,
        offensiveSuccessRate: 0.41,
        coreOffense: -4.7,
      },
      away: {
        offensePpa: 0.12,
        defensePpa: -0.05,
        gamesPlayed: 6,
        priorOff: 35,
        priorDef: 20,
      },
    },
  });
  assert.equal(proj.ok, true);
  assert.ok(proj.provenance?.scoring);
  assert.equal(proj.provenance.scoring.home.consumed.ppaOff, -0.04);
  assert.ok(proj.provenance.scoring.home.presentButUnusedByChampion.includes("offensiveSuccessRate"));
  assert.ok(proj.provenance.scoring.home.presentButUnusedByChampion.includes("coreOffense"));
});

test("Oklahoma remains permanent regression case and distinct from Oklahoma State", () => {
  assert.notEqual(OKLAHOMA_ESPN_ID, OKLAHOMA_STATE_ESPN_ID);
  const audit = runOklahomaProjectionAudit({});
  assert.equal(audit.identityCheck.crossContamination, "PASS");
  assert.equal(audit.identityCheck.oklahomaEspnId, OKLAHOMA_ESPN_ID);
  assert.equal(audit.identityCheck.oklahomaStateEspnId, OKLAHOMA_STATE_ESPN_ID);
  assert.ok(audit.originalReconstruction);
  assert.ok(audit.repaired?.fitted);
});

test("weekly operating report and existing-vs-required schedule export", () => {
  const cmp = compareExistingVsRequired();
  assert.ok(cmp.required.length >= 5);
  assert.ok(cmp.schedule.length >= 5);
  const report = buildWeeklyOperatingReport({ season: 2026, week: 8 });
  assert.equal(report.supposedToArrive.length, report.actuallyArrived.length);
  assert.ok(report.modelConsumed.champion.includes("ppaOff"));
});

test("migration 0111 registers data-ops tables", async () => {
  const sql = await readFile(new URL("../migrations/0112_cfb_data_ops.sql", import.meta.url), "utf8");
  assert.match(sql, /cfb_collection_manifests/);
  assert.match(sql, /cfb_core_weekly_archive/);
  assert.match(sql, /cfb_feature_lineage_receipts/);
  assert.match(sql, /schema_migrations[\s\S]*0112_cfb_data_ops/);
  const ext = await readFile(new URL("../schema.extensions.sql", import.meta.url), "utf8");
  assert.match(ext, /cfb_core_weekly_archive/);
});

test("Data Ops API module exports onRequestGet", async () => {
  const mod = await import("../functions/api/cfb-data-ops.js");
  assert.equal(typeof mod.onRequestGet, "function");
  const res = await mod.onRequestGet({
    env: {},
    request: new Request("https://example.test/api/cfb-data-ops?section=matrix"),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.utilizationMatrix?.counts);
  assert.equal(body.utilizationMatrix.counts.sdvChampionConsumed, 0);
});
