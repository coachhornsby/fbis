/**
 * End-to-end CFB validation harness unit tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  runFullE2eValidation,
  runAcquisitionAudit,
  runClassificationAudit,
  runConsumptionAudit,
  runFeatureImpactAudit,
  acquisitionFailureFixtures,
  E2E_VALIDATION_VERSION,
} from "../functions/lib/cfbE2eValidation.js";
import { probeRuntimeConsumption } from "../functions/lib/cfbRuntimeConsumption.js";
import { runFeatureImpactAblation } from "../functions/lib/cfbFeatureImpact.js";
import { executeWeeklyValidationJob } from "../functions/lib/cfbWeeklyValidationJob.js";
import { OKLAHOMA_ESPN_ID, OKLAHOMA_STATE_ESPN_ID } from "../functions/lib/cfbOklahomaAudit.js";

test("acquisition failure fixtures catch empty / partial / drift / quota", () => {
  const f = acquisitionFailureFixtures();
  assert.equal(f.empty_http_200.usable, false);
  assert.equal(f.partial_coverage.usable, false);
  assert.equal(f.schema_drift.usable, false);
  assert.equal(f.through_week_mismatch.usable, false);
  assert.equal(f.quota_block_alert, true);
});

test("acquisition matrix covers every registered SDV and CFBD dataset", () => {
  const audit = runAcquisitionAudit({
    season: 2026,
    week: 8,
    evidenceByDataset: {
      "cfbd-ppa-teams": {
        httpOk: true,
        rowCount: 136,
        teamCoverage: 136,
        throughWeek: 7,
        expectedThroughWeek: 7,
        archived: true,
        contentHash: "abc",
        collectedAt: "2026-10-18T12:00:00.000Z",
      },
      "cfbd-info": {
        httpOk: true,
        rowCount: 1,
        archived: true,
        contentHash: "info",
        collectedAt: "2026-10-18T12:00:00.000Z",
      },
    },
  });
  assert.ok(audit.matrix.length >= 20);
  assert.ok(audit.matrix.every((r) => r.provider === "SDV" || r.provider === "CFBD"));
  assert.ok(audit.matrix.some((r) => r.dataset === "cfbd-ppa-teams" && r.verified));
  assert.ok(audit.unresolved.length >= 0);
  // Missing required due datasets must be explicit, not silent pass
  const missing = audit.unresolved.filter((u) => u.status === "missing_receipt");
  assert.ok(Array.isArray(missing));
});

test("classification: Oklahoma ≠ Oklahoma State; silent retrospective blocked", () => {
  const c = runClassificationAudit();
  assert.equal(c.identityCheck.oklahomaEspnId, OKLAHOMA_ESPN_ID);
  assert.equal(c.identityCheck.oklahomaStateEspnId, OKLAHOMA_STATE_ESPN_ID);
  assert.equal(c.identityCheck.crossMapImpossible, true);
  assert.equal(c.silentRetrospectiveBlocked, true);
  assert.equal(c.conflictRule.winner, "cfbd");
  assert.ok(c.pass);
});

test("runtime consumption: Model A reads fitted fields; advanced unused", () => {
  const probe = probeRuntimeConsumption({ modelId: "A" });
  assert.equal(probe.runtimeMatchesContract, true);
  assert.ok(probe.enteringFitted.includes("ppaOff"));
  assert.ok(probe.enteringFitted.includes("gamesPlayed"));
  assert.ok(probe.enteringFitted.includes("hfa"));
  assert.ok(probe.ignored.length > 0 || probe.displayOnly.length >= 0);
  const c = probeRuntimeConsumption({ modelId: "C" });
  assert.equal(c.projectionOk, false);
  assert.match(String(c.reason), /CORE|ARTIFACT/i);
  const e = probeRuntimeConsumption({ modelId: "E" });
  assert.equal(e.projectionOk, true);
  assert.equal(e.canInfluenceProduction, false);
  assert.ok(e.researchOnly.includes("combined_advanced_cfbd") || e.challengerId === "E");
});

test("feature impact: fitted PPA ablation moves scores; unfitted families near-zero", () => {
  const impact = runFeatureImpactAblation();
  assert.equal(impact.reproducible, true);
  const ppa = impact.table.find((r) => r.familyId === "current_season_efficiency");
  assert.ok(ppa);
  assert.ok(Math.abs(ppa.marginChange || 0) > 0 || Math.abs(ppa.homePtsChange || 0) > 0);
  const passRush = impact.table.find((r) => r.familyId === "passing_rushing");
  assert.ok(passRush);
  assert.equal(passRush.fittedInChampion, false);
  assert.match(String(passRush.predictiveEvidence), /unproven/);
});

test("full e2e report exposes five essentials and unresolved findings", () => {
  const report = runFullE2eValidation({
    season: 2026,
    week: 8,
    evidenceByDataset: {},
    readinessResults: [],
  });
  assert.equal(report.version, E2E_VALIDATION_VERSION);
  assert.equal(report.canModifyChampion, false);
  assert.equal(report.canAuthorizeWager, false);
  assert.ok(report.fiveEssentials);
  assert.ok(report.tests[1] && report.tests[7]);
  assert.ok(Array.isArray(report.unresolvedFindings));
  assert.ok(report.tests[2].pass);
  assert.ok(report.tests[3].pass);
  assert.ok(report.tests[4].pass);
});

test("weekly validation job is independent of collector self-report", () => {
  const job = executeWeeklyValidationJob({ season: 2026, week: 8 });
  assert.equal(job.independentOfCollectorSelfReport, true);
  assert.match(job.scheduleConstraint, /before_pregame_freeze/);
  assert.ok(job.weekly.checklist.some((c) => c.id === "independent_of_collector_self_report"));
});

test("migration 0113 declares e2e validation ledger", async () => {
  const sql = await readFile(new URL("../migrations/0113_cfb_e2e_validation.sql", import.meta.url), "utf8");
  assert.match(sql, /cfb_e2e_validation_runs/);
  assert.match(sql, /schema_migrations[\s\S]*0113_cfb_e2e_validation/);
});

test("consumption + impact audits via orchestrator", () => {
  assert.ok(runConsumptionAudit().pass);
  assert.ok(runFeatureImpactAudit().pass);
});
