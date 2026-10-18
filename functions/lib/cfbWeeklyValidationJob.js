/**
 * Post-collection weekly regression entrypoint.
 * Intended to run AFTER source collection and BEFORE pregame freeze.
 * Independent of collector self-success — reconciles manifests + D1 coverage.
 */

import { runWeeklyRegressionSuite, runFullE2eValidation } from "./cfbE2eValidation.js";

export const WEEKLY_VALIDATION_JOB_ID = "cfb-e2e-weekly-validation";

/**
 * @param {{ season:number, week:number, evidenceByDataset?:object, d1FeatureTeamCount?:number|null, readinessResults?:array, unsettledFinals?:number }} opts
 */
export function executeWeeklyValidationJob(opts = {}) {
  const weekly = runWeeklyRegressionSuite(opts);
  const full = runFullE2eValidation(opts);
  return {
    jobId: WEEKLY_VALIDATION_JOB_ID,
    ranAt: new Date().toISOString(),
    scheduleConstraint: "after_collection_before_pregame_freeze",
    independentOfCollectorSelfReport: true,
    weekly,
    essentials: full.fiveEssentials,
    unresolvedFindings: full.unresolvedFindings,
    pass: weekly.pass && full.tests[2].pass && full.tests[3].pass,
  };
}

/**
 * Persist a compact validation receipt when D1 binding is available.
 */
export async function persistWeeklyValidationReceipt(env, result, { season, week } = {}) {
  if (!env?.DB || !result) return null;
  const runId = `${WEEKLY_VALIDATION_JOB_ID}-${season}-W${week}-${Date.now()}`;
  try {
    await env.DB.prepare(
      `INSERT INTO cfb_e2e_validation_runs(
         run_id, season, week, triggered_by, overall_pass,
         five_essentials_json, weekly_pass, unresolved_json, report_json, created_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
      .bind(
        runId,
        season,
        week,
        WEEKLY_VALIDATION_JOB_ID,
        result.pass ? 1 : 0,
        JSON.stringify(result.essentials || {}),
        result.weekly?.pass ? 1 : 0,
        JSON.stringify(result.unresolvedFindings || []),
        JSON.stringify({
          jobId: result.jobId,
          pass: result.pass,
          checklist: result.weekly?.checklist?.map((c) => ({ id: c.id, ok: c.ok })),
        }),
        new Date().toISOString()
      )
      .run();
    return runId;
  } catch {
    return null;
  }
}
