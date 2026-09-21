import { authorizeHarvest, unauthorizedBody } from "../lib/auth.js";
import { httpStatusForJob, parseJobTrigger } from "../lib/jobs.js";
import { COLLEGE_JOBS, runCollegeJob } from "../lib/collegeJobs.js";
import { collegeKeyHealth } from "../lib/collegeSecrets.js";

export function parseCollegeJobOptions(request) {
  const url = new URL(request.url);
  return {
    trigger: parseJobTrigger(request),
    year: url.searchParams.get("year") ? Number(url.searchParams.get("year")) : undefined,
    seasons: url.searchParams.get("seasons")
      ? url.searchParams
          .get("seasons")
          .split(",")
          .map((v) => Number(v.trim()))
          .filter(Number.isFinite)
      : undefined,
    maxRequests: url.searchParams.get("maxRequests")
      ? Number(url.searchParams.get("maxRequests"))
      : undefined,
    operationStart: url.searchParams.get("operationStart")
      ? Number(url.searchParams.get("operationStart"))
      : undefined,
    operationLimit: url.searchParams.get("operationLimit")
      ? Number(url.searchParams.get("operationLimit"))
      : undefined,
    week: url.searchParams.get("week") ? Number(url.searchParams.get("week")) : undefined,
    date: url.searchParams.get("date") || undefined,
    sport: url.searchParams.get("sport") || undefined,
    modelId: url.searchParams.get("modelId") || undefined,
    championModelId:
      url.searchParams.get("championModelId") ||
      url.searchParams.get("referenceModelId") ||
      undefined,
    operatorApproved: url.searchParams.get("operatorApproved") === "true",
    n: url.searchParams.get("n") ? Number(url.searchParams.get("n")) : undefined,
    maeImproved: url.searchParams.get("maeImproved") === "true",
    leakageOk: url.searchParams.get("leakageOk") === "true",
    artifactOk: url.searchParams.get("artifactOk") === "true",
    biasAbs: url.searchParams.get("biasAbs") ? Number(url.searchParams.get("biasAbs")) : undefined,
  };
}

function envFrom(context) {
  return {
    PARLAY_API_KEY: context.env.PARLAY_API_KEY,
    THEODDS_API_KEY: context.env.THEODDS_API_KEY,
    SHARPAPI_API_KEY: context.env.SHARPAPI_API_KEY,
    THERUNDOWN_API_KEY: context.env.THERUNDOWN_API_KEY,
    BALLPARK_PAL_API_KEY: context.env.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: context.env.CFBD_API_KEY,
    CBBD_API_KEY: context.env.CBBD_API_KEY,
    caches: caches.default,
    DB: context.env.DB,
    ARCHIVE: context.env.ARCHIVE,
    CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
  };
}

export async function onRequestGet(context) {
  const auth = authorizeHarvest(context.request, context.env);
  if (!auth.ok) {
    return new Response(JSON.stringify(unauthorizedBody()), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const url = new URL(context.request.url);
  const job = url.searchParams.get("job") || "college-health";
  if (!COLLEGE_JOBS.includes(job)) {
    return new Response(JSON.stringify({ ok: false, status: "failed", error: "unknown-job", jobs: COLLEGE_JOBS }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  try {
    const payload = await runCollegeJob(job, envFrom(context), parseCollegeJobOptions(context.request));
    payload.keyHealth = collegeKeyHealth(context.env);
    return new Response(JSON.stringify(payload), {
      status: httpStatusForJob(payload.status),
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, status: "failed", error: String(err?.message || err) }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
