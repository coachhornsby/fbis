import test from "node:test";
import assert from "node:assert/strict";
import { buildActionOrchestrationPlan } from "../functions/lib/actionOrchestration.js";

function event(startTime) {
  return { id: startTime, startTime };
}

test("pro props outrank base when both are due", () => {
  const now = new Date("2026-09-16T15:00:00.000Z");
  const plan = buildActionOrchestrationPlan({
    now,
    slates: {
      mlb: [event("2026-09-16T17:00:00.000Z")],
    },
    history: [],
  });
  assert.equal(plan.jobs[0].profile, "PLAYER_PROPS");
  assert.equal(plan.jobs[0].sport, "mlb");
  assert.ok(plan.jobs.some((j) => j.profile === "BASE" && j.lifecycle === "pregame"));
});

test("college sports never schedule PLAYER_PROPS", () => {
  const now = new Date("2026-09-16T15:00:00.000Z");
  const plan = buildActionOrchestrationPlan({
    now,
    slates: {
      cfb: [event("2026-09-16T17:00:00.000Z")],
      cbb: [event("2026-09-16T18:00:00.000Z")],
    },
  });
  assert.equal(plan.jobs.some((j) => j.profile === "PLAYER_PROPS"), false);
});

test("final pregame movement is scheduled inside 60 minutes", () => {
  const now = new Date("2026-09-16T15:00:00.000Z");
  const plan = buildActionOrchestrationPlan({
    now,
    slates: {
      nfl: [event("2026-09-16T15:40:00.000Z")],
    },
  });
  assert.equal(plan.jobs[0].profile, "MOVEMENT");
  assert.equal(plan.jobs[0].lifecycle, "final_pregame");
});

test("opening snapshot is used when slate is 6-24 hours away", () => {
  const now = new Date("2026-09-16T12:00:00.000Z");
  const plan = buildActionOrchestrationPlan({
    now,
    slates: {
      nfl: [event("2026-09-17T00:00:00.000Z")],
    },
  });
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.jobs[0].profile, "BASE");
  assert.equal(plan.jobs[0].lifecycle, "opening");
});

test("recent success suppresses duplicate paid job", () => {
  const now = new Date("2026-09-16T15:00:00.000Z");
  const plan = buildActionOrchestrationPlan({
    now,
    slates: {
      mlb: [event("2026-09-16T17:00:00.000Z")],
    },
    history: [
      {
        sport: "mlb",
        profile: "PLAYER_PROPS",
        lifecycle: "pregame",
        status: "success",
        finished_at: "2026-09-16T14:15:00.000Z",
      },
    ],
  });
  assert.equal(plan.jobs.some((j) => j.profile === "PLAYER_PROPS"), false);
  assert.ok(plan.jobs.some((j) => j.profile === "BASE"));
});

test("no upcoming slate produces no paid jobs", () => {
  const now = new Date("2026-09-16T15:00:00.000Z");
  const plan = buildActionOrchestrationPlan({
    now,
    slates: {
      mlb: [event("2026-09-16T14:00:00.000Z")],
    },
  });
  assert.equal(plan.jobs.length, 0);
  assert.equal(plan.sportState.mlb.active, false);
});
