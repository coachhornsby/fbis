import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
