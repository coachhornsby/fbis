import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recoverCurrentPipeline, RECOVERY_SPORTS } from "../workers/prospective-pipeline-recovery.mjs";
import { collectCurrentPipeline } from "../functions/api/collect-current.js";
import {
  selectPipelineJob,
  triggerFromEvent,
  utcHourToChicago,
  CRON_CHICAGO,
  scheduledPipelineState,
  lastExpectedCollectUtc,
  FULL_COLLECT_CRON,
  CACHE_COLLECT_CRON,
  HARVEST_CRON,
} from "../functions/lib/pipelineSchedule.js";
import { actionAcceptsJob, staleScheduleWarning, scheduledHealth } from "../functions/lib/jobs.js";

describe("GitHub scheduling", () => {
  it("distinguishes schedule from workflow_dispatch", () => {
    assert.equal(triggerFromEvent("schedule"), "schedule");
    assert.equal(triggerFromEvent("workflow_dispatch"), "workflow_dispatch");
    assert.equal(selectPipelineJob({ hourUtc: 13, minuteUtc: 0, eventName: "schedule" }).trigger, "schedule");
    assert.equal(
      selectPipelineJob({ hourUtc: 13, minuteUtc: 0, eventName: "workflow_dispatch", jobInput: "collect-full" }).trigger,
      "workflow_dispatch"
    );
  });

  it("selects runtime jobs for each UTC cron", () => {
    assert.equal(selectPipelineJob({ hourUtc: 13, minuteUtc: 0 }).job, "collect-full");
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 0 }).job, "collect-full");
    assert.equal(selectPipelineJob({ hourUtc: 18, minuteUtc: 0 }).job, "collect-cache");
    assert.equal(selectPipelineJob({ hourUtc: 20, minuteUtc: 0 }).job, "collect-cache");
    assert.equal(selectPipelineJob({ hourUtc: 22, minuteUtc: 0 }).job, "collect-cache");
    assert.equal(selectPipelineJob({ hourUtc: 0, minuteUtc: 0 }).job, "collect-cache");
    assert.equal(selectPipelineJob({ hourUtc: 2, minuteUtc: 0 }).job, "collect-cache");
    assert.equal(selectPipelineJob({ hourUtc: 11, minuteUtc: 20 }).job, "harvest");
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 20 }).job, "harvest");
  });

  it("routes delayed scheduled jobs by cron identity, not actual start minute", () => {
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 27, eventName: "schedule", scheduledExpression: FULL_COLLECT_CRON }).job, "collect-full");
    assert.equal(selectPipelineJob({ hourUtc: 3, minuteUtc: 12, eventName: "schedule", scheduledExpression: CACHE_COLLECT_CRON }).job, "collect-cache");
    assert.equal(selectPipelineJob({ hourUtc: 16, minuteUtc: 47, eventName: "schedule", scheduledExpression: HARVEST_CRON }).job, "harvest");
    assert.equal(selectPipelineJob({ hourUtc: 11, minuteUtc: 58, eventName: "schedule", scheduledExpression: HARVEST_CRON }).job, "harvest");
  });

  it("maps CDT and CST wall times", () => {
    const cdt = utcHourToChicago(13, "CDT");
    const cst = utcHourToChicago(13, "CST");
    assert.equal(cdt.hour, 8);
    assert.equal(cst.hour, 7);
    assert.ok(CRON_CHICAGO.some((r) => r.utc === "13:00" && r.cdt.startsWith("08:00") && r.cst.startsWith("07:00")));
    assert.ok(CRON_CHICAGO.some((r) => r.utc === "11:20" && r.job === "harvest"));
  });

  it("prevents diagnostic minutes from selecting full paid collection", () => {
    const job = selectPipelineJob({ hourUtc: 16, minuteUtc: 7, eventName: "schedule", diagnostic: true });
    assert.equal(job.job, "health");
    assert.notEqual(job.job, "collect-full");
    const prod = selectPipelineJob({ hourUtc: 16, minuteUtc: 0, eventName: "schedule", diagnostic: true });
    assert.equal(prod.job, "collect-full");
  });

  it("rejects partial and failed API responses", () => {
    assert.equal(actionAcceptsJob(207, { ok: false, status: "partial" }), false);
    assert.equal(actionAcceptsJob(200, { ok: true, status: "partial" }), false);
    assert.equal(actionAcceptsJob(500, { ok: false, status: "failed" }), false);
    assert.equal(actionAcceptsJob(200, { ok: true, status: "success" }), true);
  });

  it("records trigger type on success selection", () => {
    const scheduled = selectPipelineJob({ hourUtc: 13, minuteUtc: 0, eventName: "schedule" });
    assert.equal(scheduled.trigger, "schedule");
    assert.equal(scheduled.job, "collect-full");
  });

  it("does not treat manual success as scheduled health", () => {
    const now = new Date("2026-08-27T16:30:00Z");
    const health = {
      lastCollectSuccessAt: "2026-08-27T15:29:00Z",
      lastManualCollectSuccessAt: "2026-08-27T15:29:00Z",
      lastScheduledCollectSuccessAt: null,
    };
    const warn = staleScheduleWarning(health, now);
    assert.ok(warn.some((w) => /never observed/i.test(w)));
    const sched = scheduledHealth(health, now);
    assert.equal(sched.collect.state, "never observed");
  });

  it("emits a missed-run warning after the grace period", () => {
    const now = new Date("2026-08-27T20:50:00Z");
    const health = { lastScheduledCollectSuccessAt: "2026-08-26T13:00:00Z" };
    const warn = staleScheduleWarning(health, now);
    assert.ok(warn.some((w) => /missed/i.test(w)));
  });

  it("clears the stale warning after a scheduled success", () => {
    const now = new Date("2026-08-27T13:10:00Z");
    const expected = lastExpectedCollectUtc(now);
    const health = { lastScheduledCollectSuccessAt: expected };
    const sched = scheduledPipelineState({
      lastScheduledSuccessAt: expected,
      lastExpectedAt: expected,
      now,
    });
    assert.equal(sched.state, "healthy");
    const warn = staleScheduleWarning(health, now);
    assert.equal(warn.filter((w) => /collect/i.test(w)).length, 0);
  });
});

describe("prospective Cloudflare recovery", () => {
  const now = new Date("2026-10-07T17:10:00Z");
  const controller = { scheduledTime: now.getTime() };
  const env = { HARVEST_SECRET: "test-secret" };
  const sha = "a".repeat(40);
  const health = (collect = "healthy", harvest = "healthy") => ({
    deploymentCommit: sha, state: "HEALTHY", staleChecks: [],
    pipeline: { schedule: { collect: { state: collect }, harvest: { state: harvest } } },
  });
  const mock = (initial, mutate = () => {}, coverage = { ok: true, missingSports: RECOVERY_SPORTS, missingHarvestSports: [], initializing: false, inProgress: false }) => {
    const writes = [];
    let reads = 0;
    return { writes, request: async (raw, options) => {
      const url = new URL(raw);
      if (url.pathname === "/api/health") {
        const row = structuredClone(initial);
        mutate(row, reads++);
        return Response.json(row);
      }
      if (url.pathname === "/api/collect-current" && url.searchParams.get("status") === "1") {
        return Response.json(coverage);
      }
      writes.push({ url, options });
      return Response.json({ ok: true, status: "success" });
    }};
  };
  it("does nothing within healthy or delayed schedule windows", async () => {
    const m = mock(health("delayed", "healthy"));
    const r = await recoverCurrentPipeline(env, controller, m.request, now);
    assert.equal(r.status, "not_due");
    assert.equal(m.writes.length, 0);
  });
  it("initializes fresh per-sport proof even when global health is healthy", async () => {
    const m = mock(health(), () => {}, { ok: true, missingSports: RECOVERY_SPORTS, missingHarvestSports: [], initializing: true, inProgress: false });
    await recoverCurrentPipeline(env, controller, m.request, now);
    assert.equal(m.writes.length, RECOVERY_SPORTS.length);
  });
  it("resumes only missing sports after a partial cycle made global health healthy", async () => {
    const m = mock(health(), () => {}, { ok: true, missingSports: ["soccer"], missingHarvestSports: [], initializing: false, inProgress: true });
    await recoverCurrentPipeline(env, controller, m.request, now);
    assert.deepEqual(m.writes.map(({ url }) => url.searchParams.get("sport")), ["soccer"]);
  });
  it("fails closed on unknown collection coverage", async () => {
    const m = mock(health("missed"), () => {}, { ok: true, missingSports: ["unknown"] });
    await assert.rejects(recoverCurrentPipeline(env, controller, m.request, now), /coverage unavailable/);
    assert.equal(m.writes.length, 0);
  });
  it("resumes missing current-hour harvest sports even when global health is healthy", async () => {
    const m = mock(health(), () => {}, { ok: true, missingSports: [], missingHarvestSports: ["mlb", "soccer"], initializing: false, inProgress: false });
    const r = await recoverCurrentPipeline(env, controller, m.request, now);
    assert.equal(r.harvestReason, "per_sport_hourly_delivery_gap");
    assert.deepEqual(m.writes.map(({ url }) => [url.pathname, url.searchParams.get("sport"), url.searchParams.get("date")]), [
      ["/api/harvest", "mlb", "2026-10-07"], ["/api/harvest", "soccer", "2026-10-07"],
    ]);
  });
  it("collects all configured sports using current-day cached odds with actual cron provenance", async () => {
    const m = mock(health("missed", "healthy"));
    await recoverCurrentPipeline(env, controller, m.request, now);
    assert.equal(m.writes.length, RECOVERY_SPORTS.length);
    for (const { url, options } of m.writes) {
      assert.equal(url.pathname, "/api/collect-current");
      assert.equal(url.searchParams.get("odds"), "cache");
      assert.equal(url.searchParams.get("dayOffset"), "0");
      assert.equal(url.searchParams.get("trigger"), "schedule");
      assert.match(url.searchParams.get("scheduledSlot"), /cloudflare-current-recovery:2026-10-07T17:10/);
      assert.equal(options.headers["x-harvest-secret"], "test-secret");
    }
  });
  it("harvests only the actual current Chicago date, including events straddling midnight", async () => {
    const at = new Date("2026-10-08T05:00:01Z");
    const m = mock(health("healthy", "missed"));
    await recoverCurrentPipeline(env, { scheduledTime: at.getTime() - 2000 }, m.request, at);
    assert.equal(m.writes.length, RECOVERY_SPORTS.length);
    for (const { url } of m.writes) {
      assert.equal(url.pathname, "/api/harvest");
      assert.equal(url.searchParams.get("date"), "2026-10-08");
      assert.equal(url.searchParams.get("settleOnly"), "1");
    }
  });
  it("blocks historical events and missing credentials before any calls", async () => {
    const m = mock(health("missed", "missed"));
    await assert.rejects(recoverCurrentPipeline(env, { scheduledTime: now.getTime() - 600000 }, m.request, now), /historical replay blocked/);
    await assert.rejects(recoverCurrentPipeline({}, controller, m.request, now), /HARVEST_SECRET missing/);
    assert.equal(m.writes.length, 0);
  });
  it("blocks writes if the deployment changes or its SHA is unavailable", async () => {
    const changed = mock(health("missed"), (h, n) => { if (n > 0) h.deploymentCommit = "b".repeat(40); });
    await assert.rejects(recoverCurrentPipeline(env, controller, changed.request, now), /SHA changed/);
    assert.equal(changed.writes.length, 0);
    const missing = mock({ ...health("missed"), deploymentCommit: null });
    await assert.rejects(recoverCurrentPipeline(env, controller, missing.request, now), /SHA unavailable/);
    assert.equal(missing.writes.length, 0);
  });
  it("recovers a stale required check even if schedule text says healthy", async () => {
    const h = health(); h.staleChecks = [{ name: "scheduled-collect" }];
    const m = mock(h);
    await recoverCurrentPipeline(env, controller, m.request, now);
    assert.equal(m.writes.length, RECOVERY_SPORTS.length);
  });
  it("rejects partial writes and does not proceed to harvest", async () => {
    const m = mock(health("missed", "missed"));
    const request = (url, options) => new URL(url).pathname === "/api/collect-current" && !new URL(url).searchParams.has("status")
      ? Response.json({ ok: false, status: "partial" }, { status: 207 }) : m.request(url, options);
    await assert.rejects(recoverCurrentPipeline(env, controller, request, now), /failed HTTP 207/);
    assert.equal(m.writes.length, 0);
  });
  it("enforces a hard cycle deadline so recovery cannot overlap the next cron", async () => {
    const m = mock(health("missed"));
    let ticks = 0;
    const clock = () => ticks++ === 0 ? 0 : 480001;
    await assert.rejects(recoverCurrentPipeline(env, controller, m.request, now, clock), /time budget exhausted/);
    assert.equal(m.writes.length, 0);
  });
  it("covers a missing hourly harvest delivery while preserving wider release-health thresholds", async () => {
    const h = health();
    h.pipeline.schedule.harvest.lastObservedAt = "2026-10-07T16:00:00Z";
    const m = mock(h);
    const r = await recoverCurrentPipeline(env, controller, m.request, now);
    assert.equal(r.harvestReason, "hourly_delivery_gap");
    assert.equal(m.writes.length, RECOVERY_SPORTS.length);
    assert.ok(m.writes.every(({ url }) => url.pathname === "/api/harvest" && url.searchParams.get("date") === "2026-10-07"));
  });
});

describe("bounded current collection boundary", () => {
  const sha = "a".repeat(40);
  const context = (query = "", token = "secret") => ({
    env: { HARVEST_SECRET: "secret", CF_PAGES_COMMIT_SHA: sha },
    request: new Request(`https://example.com/api/collect-current?sport=cbb&trigger=schedule&expectedSha=${sha}${query}`, {
      headers: { "x-harvest-secret": token },
    }),
  });
  it("reads real per-sport current-hour harvest coverage without collecting or writing", async () => {
    const c = context("&status=1");
    const queries = [];
    c.env.DB = { prepare(sql) {
      const stmt = { bind(...args) { queries.push({ sql, args }); return stmt; }, async all() {
        if (sql.includes("store_meta")) return { results: RECOVERY_SPORTS.map(sport => ({ k: `native_current_collect_success:${sport}`, v: new Date().toISOString() })) };
        return { results: RECOVERY_SPORTS.filter(sport => sport !== "soccer").map(sport => ({ sport })) };
      } }; return stmt;
    } };
    const response = await collectCurrentPipeline(c, () => { throw new Error("status must not collect"); });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(result.missingSports, []);
    assert.deepEqual(result.missingHarvestSports, ["soccer"]);
    assert.equal(result.initializing, false);
    assert.match(queries[0].sql, /trigger_type = 'schedule'/);
    assert.match(queries[0].sql, /status = 'success'/);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    assert.equal(queries[0].args[1], JSON.stringify([today]));
    assert.ok(Math.abs(Date.parse(queries[0].args[0]) - (Date.now() - 3600000)) < 1000);
  });
  it("uses canonical collection with current cache settings even if historical/full arguments are supplied", async () => {
    let called;
    const response = await collectCurrentPipeline(context("&date=2020-01-01&odds=full&dayOffset=-1000"), async (_env, options) => {
      called = options;
      return { ok: true, status: "success" };
    });
    assert.equal(response.status, 200);
    assert.deepEqual(called, { odds: "cache", trigger: "schedule", sport: "cbb", dayOffset: 0 });
    assert.equal((await response.json()).status, "success");
  });
  it("blocks unauthorized and moved-SHA calls before invoking collection", async () => {
    const collect = () => { throw new Error("must not collect"); };
    assert.equal((await collectCurrentPipeline(context("", "wrong"), collect)).status, 401);
    const changed = context(); changed.env.CF_PAGES_COMMIT_SHA = "b".repeat(40);
    assert.equal((await collectCurrentPipeline(changed, collect)).status, 409);
  });
  it("keeps partial canonical collection results partial", async () => {
    const response = await collectCurrentPipeline(context(), async () => ({ ok: false, status: "partial" }));
    assert.equal(response.status, 207);
    assert.equal((await response.json()).ok, false);
  });
});
