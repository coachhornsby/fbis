/**
 * Public college-research job facade.
 *
 * All collection/harvest behavior remains in collegeJobsCore.js. The validation
 * job is overridden here so CBB and CFB use the same frozen, temporal research
 * standard instead of silently hard-coding CFB.
 */

import * as core from "./collegeJobsCore.js";
import { queryModelPredictions, insertValidationRun } from "./collegeStore.js";
import { COLLEGE_MODELS } from "./collegeModels.js";
import { evaluateModelRows, pairedModelComparison } from "./modelLab.js";
import { newJobId, jobPayload, emptyWriteCounts, recordJob } from "./jobs.js";
import { hasDb } from "./store.js";

export * from "./collegeJobsCore.js";

const SCORE_FAMILIES = new Set(["baseline", "ratings", "reg", "ensemble", "matchup"]);

export function researchModelIds(sport, requested = "all") {
  const id = String(sport || "").toLowerCase();
  if (!new Set(["cbb", "cfb"]).has(id)) return [];
  if (requested && requested !== "all") {
    const meta = COLLEGE_MODELS[requested];
    return meta?.sport === id && !meta.marketInformed ? [requested] : [];
  }
  return Object.values(COLLEGE_MODELS)
    .filter((m) => m.sport === id)
    .filter((m) => m.role === "shadow" && !m.marketInformed && m.independent)
    .filter((m) => SCORE_FAMILIES.has(m.family) && !m.optional)
    .map((m) => m.id);
}

function frozenAt(row) {
  const raw = row?.frozen_at ?? row?.frozenAt;
  const ms = Date.parse(raw || "");
  return Number.isFinite(ms) ? ms : null;
}

export function temporalValidationFolds(rows = [], foldCount = 4) {
  const ordered = rows
    .filter((r) => frozenAt(r) != null)
    .slice()
    .sort((a, b) => frozenAt(a) - frozenAt(b));
  if (ordered.length < 2) return [];
  const blocks = Math.max(2, Math.min(Number(foldCount) || 4, ordered.length));
  const blockSize = Math.max(1, Math.floor(ordered.length / blocks));
  const folds = [];
  for (let i = 1; i < blocks; i += 1) {
    const split = Math.min(i * blockSize, ordered.length - 1);
    const end = i === blocks - 1 ? ordered.length : Math.min((i + 1) * blockSize, ordered.length);
    const train = ordered.slice(0, split);
    const validate = ordered.slice(split, end);
    if (train.length && validate.length) folds.push({ train, validate });
  }
  return folds;
}

export function cutoffLeakageOk(rows = []) {
  if (!rows.length) return false;
  return rows.every((row) => Number(row?.cutoff_ok ?? row?.cutoffOk) === 1);
}

async function runSportValidation(env, opts = {}) {
  const sport = String(opts.sport || "cfb").toLowerCase();
  if (!new Set(["cbb", "cfb"]).has(sport)) {
    return { ok: false, error: "model-train-validate supports sport=cbb or sport=cfb" };
  }

  const started = new Date().toISOString();
  const id = newJobId(`model-train-validate-${sport}`);
  const writes = emptyWriteCounts();
  await core.seedRegistry(env);

  const modelIds = researchModelIds(sport, opts.modelId || "all");
  if (!modelIds.length) {
    return jobPayload({
      ok: false,
      job: "model-train-validate",
      status: "failed",
      attemptedAt: started,
      errors: ["no-valid-independent-models"],
      env,
      writes,
    });
  }

  const validation = [];
  const rowsByModel = new Map();
  for (const modelId of modelIds) {
    const rows = await queryModelPredictions(env, { sport, modelId, limit: 5000 });
    const graded = rows.filter((r) => r.actual_home != null && r.actual_away != null);
    rowsByModel.set(modelId, graded);
    const folds = temporalValidationFolds(graded, 4);
    const metrics = evaluateModelRows(graded, { sport });
    const foldMetrics = folds.map((fold) => ({
      trainN: fold.train.length,
      validateN: fold.validate.length,
      validateFrom: fold.validate[0]?.frozen_at ?? fold.validate[0]?.frozenAt ?? null,
      validateUntil: fold.validate.at(-1)?.frozen_at ?? fold.validate.at(-1)?.frozenAt ?? null,
      metrics: evaluateModelRows(fold.validate, { sport }),
    }));
    const leakageOk = cutoffLeakageOk(graded);
    await insertValidationRun(env, {
      id: `${id}:val:${modelId}`,
      modelId,
      method: "rolling-origin-blocked-v2",
      trainUntil: folds.at(-1)?.train.at(-1)?.frozen_at ?? folds.at(-1)?.train.at(-1)?.frozenAt ?? null,
      validateFrom: folds.at(-1)?.validate[0]?.frozen_at ?? folds.at(-1)?.validate[0]?.frozenAt ?? null,
      validateUntil: folds.at(-1)?.validate.at(-1)?.frozen_at ?? folds.at(-1)?.validate.at(-1)?.frozenAt ?? null,
      n: metrics.n,
      metrics: { ...metrics, folds: foldMetrics },
      leakageOk,
    });
    validation.push({ modelId, metrics, folds: foldMetrics, leakageOk });
    writes.writesSucceeded += 1;
  }

  let paired = [];
  const referenceId = opts.championModelId || null;
  if (referenceId && rowsByModel.has(referenceId)) {
    paired = modelIds
      .filter((modelId) => modelId !== referenceId)
      .map((modelId) => ({
        referenceModelId: referenceId,
        challengerModelId: modelId,
        ...pairedModelComparison(rowsByModel.get(referenceId), rowsByModel.get(modelId), { sport }),
      }));
  }

  const successfulAt = new Date().toISOString();
  const payload = jobPayload({
    ok: true,
    job: "model-train-validate",
    status: "success",
    attemptedAt: started,
    successfulAt,
    env,
    writes,
    d1: {
      bound: hasDb(env),
      sport,
      validation,
      paired,
      referenceModelId: referenceId,
      note: "Frozen independent predictions only. Missing cutoff evidence fails the leakage audit. No model is promoted automatically.",
    },
  });

  await recordJob(env, {
    id,
    jobType: "model-train-validate",
    triggerType: opts.trigger || "http",
    startedAt: started,
    completedAt: successfulAt,
    status: payload.status,
    sport,
    writesAttempted: writes.writesSucceeded,
    writesSucceeded: writes.writesSucceeded,
    writesFailed: writes.writesFailed,
    env,
  });
  return payload;
}

export async function runCollegeJob(job, env = {}, opts = {}) {
  if (job !== "model-train-validate") return core.runCollegeJob(job, env, opts);
  return runSportValidation(env, opts);
}
