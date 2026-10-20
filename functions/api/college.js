import {cfbCfbdAcquisitionHealth} from "../lib/cfbCfbdAcquisition.js";
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
    remaining: url.searchParams.get("remaining")
      ? Number(url.searchParams.get("remaining"))
      : undefined,
    includePlayers: url.searchParams.get("includePlayers") !== "false",
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
    KENPOM_API_KEY: context.env.KENPOM_API_KEY,
    caches: caches.default,
    DB: context.env.DB,
    ARCHIVE: context.env.ARCHIVE,
    CF_PAGES_COMMIT_SHA: context.env.CF_PAGES_COMMIT_SHA,
    CFBD_DAILY_NETWORK_BUDGET: context.env.CFBD_DAILY_NETWORK_BUDGET,
    CFBD_MONTHLY_NETWORK_BUDGET: context.env.CFBD_MONTHLY_NETWORK_BUDGET,
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
    // The sole scheduled CFBD network owner is the early-morning postgame
    // harvester. All other operations can read durable / cached CFBD facts,
    // but cannot spend provider quota (even for an accidental old cron).
    const runEnv = envFrom(context);
    const options = parseCollegeJobOptions(context.request);
    const scheduledOwner = options.trigger === "schedule" &&
      ["cfb-postgame-harvest","cfb-current-refresh"].includes(job);
    const manualOwner = options.trigger === "workflow_dispatch" && options.operatorApproved &&
      ["cfb-postgame-harvest","cfb-current-refresh","cfb-reference-backfill",
       "cfb-qb-transfer-refresh","cfb-quota-replenish-ack","cfbd-endpoint-audit",
       // Research-only historical CORE reconstruct (authorized operator path).
       "cfb-core-historical-reconstruct"].includes(job);
    runEnv.cfbdNetworkAuthorized = scheduledOwner || manualOwner;
    runEnv.cfbdCacheOnly = !runEnv.cfbdNetworkAuthorized;
    // Basketball draws on the same subscription. No unowned CBBD HTTP on
    // cache misses, including board / ad-hoc read operations.
    const scheduledCbbOwner = options.trigger === "schedule" &&
      ["cbb-current-refresh","cbb-postgame-harvest"].includes(job);
    const manualCbbOwner = options.trigger === "workflow_dispatch" &&
      options.operatorApproved &&
      ["cbb-current-refresh","cbb-postgame-harvest","cbb-reference-backfill",
       "cbbd-endpoint-audit"].includes(job);
    runEnv.cbbdNetworkAuthorized = scheduledCbbOwner || manualCbbOwner;
    runEnv.cbbdCacheOnly = !runEnv.cbbdNetworkAuthorized;
    // CFBD and CBBD share the same subscription allowance. Pause scheduled
    // basketball collection too if the provider confirms zero shared calls.
    const sharedCollegeAcquisition = runEnv.cfbdNetworkAuthorized ||
      runEnv.cbbdNetworkAuthorized;
    if (sharedCollegeAcquisition) {
      const quota = await cfbCfbdAcquisitionHealth(runEnv);
      // A provider-confirmed zero balance is a monthly account-level stop, not
      // a new HTTP 429 each morning. Preserve SDV and previously acquired state.
      const depleted = quota.bound === true && quota.providerRemaining === 0 &&
        String(quota.last429At || "").slice(0, 7) === quota.month;
      if (depleted) {
        return new Response(JSON.stringify({
          ok: false, status: "paused", job, reason: "COLLEGE_SHARED_MONTHLY_QUOTA_EXHAUSTED",
          networkCalls: 0, canQualify: false, canAuthorizeWager: false,
          sourceCoverage: "unavailable-new-cfbd", sdvCollectionUnaffected: true,
          d1: {bound: true, cfbdAcquisition: quota}
        }), {
          status: 200,
          headers: {"content-type": "application/json; charset=utf-8","cache-control": "no-store"}
        });
      }
    }
    const payload = await runCollegeJob(job, runEnv, options);
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
