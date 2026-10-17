import { harvestSecret } from "../lib/auth.js";
import {
  validateAllSportPipelines,
  persistPipelineValidation,
  PIPELINE_VALIDATION_SPORTS,
} from "../lib/pipelineValidation.js";
import { deploymentCommit } from "../lib/jobs.js";

const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
});

export async function onRequestGet({ env, request } = {}) {
  const secret = harvestSecret(env);
  const provided = request?.headers?.get("x-harvest-secret");
  if (!secret || !provided || provided !== secret) {
    return response({ ok: false, error: "FORBIDDEN" }, 403);
  }
  if (!env?.DB?.prepare) {
    return response({ ok: false, error: "PRIMARY_DB_UNAVAILABLE" }, 503);
  }

  try {
    const url = new URL(request.url);
    const sportParam = url.searchParams.get("sport");
    const sports = sportParam
      ? sportParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
      : [...PIPELINE_VALIDATION_SPORTS];
    const persist = url.searchParams.get("persist") === "1";
    const report = await validateAllSportPipelines(env, { sports });
    let persistResult = { ok: false, reason: "not-requested", persisted: 0 };
    if (persist) {
      persistResult = await persistPipelineValidation(env, report, {
        deploymentSha: deploymentCommit(env),
      });
    }
    return response({
      ok: true,
      ...report,
      persist: persistResult,
      operatorNote: "Results prefer OPERATIONS_DB when bound; primary remains product authority.",
    });
  } catch (err) {
    return response({ ok: false, error: String(err?.message || err) }, 500);
  }
}

export async function onRequestPost() {
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
