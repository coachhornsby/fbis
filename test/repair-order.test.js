import test from "node:test";
import assert from "node:assert/strict";
import { matchExecutedBet, summarizeExecutedBets } from "../functions/lib/executedBets.js";
import { readFileSync } from "node:fs";

test("matchExecutedBet corrects college tickets mislabeled as mlb", () => {
  const ticket = {
    sport: "mlb",
    date: "2026-09-05",
    awayTeam: "MARSHALL",
    homeTeam: "PENN STATE",
    executedAt: "2026-09-05T17:11:00.000Z",
  };
  const games = [
    {
      id: "cfb-1",
      sport: "cfb",
      date: "2026-09-05",
      start: "2026-09-05T16:00:00.000Z",
      home: { name: "Penn State", abbr: "PSU" },
      away: { name: "Marshall", abbr: "MRSH" },
      homeName: "Penn State",
      awayName: "Marshall",
    },
  ];
  const hit = matchExecutedBet(ticket, games);
  assert.equal(hit.status, "matched");
  assert.equal(hit.sportCorrected, true);
  assert.equal(hit.game.id, "cfb-1");
});

test("summarizeExecutedBets counts MANUAL_REVIEW separately from open and settled", () => {
  const summary = summarizeExecutedBets([
    { result: "WON", riskAmount: 2, profit: 1.8 },
    { result: "LOST", riskAmount: 2, profit: -2 },
    { result: "OPEN" },
    { result: "MANUAL_REVIEW" },
    { result: null },
  ]);
  assert.equal(summary.bets, 5);
  assert.equal(summary.open, 2);
  assert.equal(summary.manualReview, 1);
  assert.equal(summary.unresolved, 3);
  assert.equal(summary.settled, 2);
  assert.equal(summary.record, "1-1");
});

test("today source status no longer treats schedule-only as projection ok", () => {
  const src = readFileSync(new URL("../functions/api/today.js", import.meta.url), "utf8");
  assert.match(src, /projectedGames > 0/);
  assert.doesNotMatch(src, /projectionOk = Number\(feed\?\.n \|\| 0\) > 0 \|\| scheduleOk/);
});

test("health requires schema migration verification and conflict breakdown", () => {
  const src = readFileSync(new URL("../functions/api/health.js", import.meta.url), "utf8");
  assert.match(src, /name: "schema-migration"/);
  assert.match(src, /conflictBreakdown/);
  assert.match(src, /immutable-projection-mismatch/);
});

test("CI release gate verifies live health SHA and API smoke", () => {
  const src = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(src, /verify-deployment-sha\.mjs/);
  assert.match(src, /\/api\/published-projections/);
  assert.match(src, /Release gate smoke passed/);
});

test("harvest catch-up window covers stale OPEN college tickets", () => {
  const src = readFileSync(new URL("../.github/workflows/harvest.yml", import.meta.url), "utf8");
  assert.match(src, /\/api\/harvest\?days=10/);
  assert.doesNotMatch(src, /\/api\/harvest\?days=3/);
});

test("deep shadow models remain non-qualifying", async () => {
  const { COLLEGE_MODELS } = await import("../functions/lib/collegeModels.js");
  for (const id of ["MLB-RUN-ALLOC-v1", "CFB-MATCHUP-v2", "NFL-PRO-v1"]) {
    assert.equal(COLLEGE_MODELS[id].role, "shadow");
    assert.equal(COLLEGE_MODELS[id].canQualify, false);
  }
});

test("classifyProspectiveLifecycle separates past-open from upcoming", async () => {
  const { classifyProspectiveLifecycle } = await import("../functions/lib/strategy.js");
  const out = classifyProspectiveLifecycle(
    [
      { role: "prospective", date: "2026-09-10", result: "OPEN", gameId: "a", matchup: "B @ A", dataQuality: 80 },
      { role: "prospective", date: "2026-09-01", result: "OPEN", gameId: "b", matchup: "D @ C", dataQuality: 80 },
      { role: "prospective", date: "2026-09-01", result: "WON", gameId: "c", matchup: "F @ E", dataQuality: 80 },
      { role: "prospective", date: "2026-09-01", result: "OPEN", gameId: null, matchup: "", dataQuality: 0 },
    ],
    { today: "2026-09-08" }
  );
  assert.equal(out.counts.upcoming, 1);
  assert.equal(out.counts.awaitingFinal, 1);
  assert.equal(out.counts.graded, 1);
  assert.equal(out.counts.dataErrors, 1);
});
