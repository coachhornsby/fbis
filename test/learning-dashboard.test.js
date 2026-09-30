import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("learning report is backed by prediction_snapshots for all six sports", async () => {
  const api = await readFile(new URL("../functions/api/learning-report.js", import.meta.url), "utf8");
  assert.match(api, /prediction_snapshots/);
  assert.match(api, /LEARNING_SPORTS/);
  assert.match(api, /snapshotRows/);
  assert.match(api, /canonicalProjections/);
  assert.match(api, /gradedProjections/);
  assert.match(api, /awaitingFinals/);
  assert.match(api, /snapshotCount/);
  assert.match(api, /GRADED \/ INCLUDED/);
});

test("render learning sync writes dashboard, projection audit, and reconciles finals", async () => {
  const orchestrator = await readFile(
    new URL("../services/sports-projection-orchestrator/orchestrator.mjs", import.meta.url),
    "utf8"
  );
  assert.match(orchestrator, /modelLearning:\s*'Model Learning'/);
  assert.match(orchestrator, /projectionAudit:\s*'Projection Audit'/);
  assert.match(orchestrator, /export async function syncLearningDashboard/);
  assert.match(orchestrator, /allProjectionFinalsReconciled/);
  assert.match(orchestrator, /GRADED \/ INCLUDED/);
});

test("hourly orchestrator workflow mirrors authenticated learning evidence", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/sports-projection-orchestrator.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /\/api\/learning-report\?since=2026-01-01&limit=5000/);
  assert.match(workflow, /\/api\/sync-learning-dashboard/);
  assert.match(workflow, /HARVEST_SECRET/);
  assert.match(workflow, /allProjectionFinalsReconciled/);
});

test("render server exposes only authenticated learning dashboard sync", async () => {
  const server = await readFile(
    new URL("../services/sports-projection-orchestrator/server.mjs", import.meta.url),
    "utf8"
  );
  const authIndex = server.indexOf("const auth=await authorization(req)");
  const routeIndex = server.indexOf("/api/sync-learning-dashboard");
  assert.ok(authIndex >= 0);
  assert.ok(routeIndex > authIndex);
  assert.match(server, /syncLearningDashboard/);
});


test("production D1 explicitly ensures weekly model validation storage", async () => {
  const migration = await readFile(
    new URL("../migrations/0031_model_validation_runs_ensure.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS model_validation_runs/);
  assert.match(migration, /0031_model_validation_runs_ensure/);
});

test("learning report treats training and finding tables as optional evidence", async () => {
  const api = await readFile(new URL("../functions/api/learning-report.js", import.meta.url), "utf8");
  assert.match(api, /async function optionalRows/);
  assert.match(api, /no such table/);
  assert.match(api, /optionalRows\(db,[\s\S]*FROM model_validation_runs/);
  assert.match(api, /optionalRows\(db,[\s\S]*FROM model_learning_findings/);
});


test("snapshot final reconciliation matches synthetic ids by CT date and canonical teams", async () => {
  const { resolveFinalForSnapshot } = await import("../functions/lib/projLedger.js");
  const row = {
    gameId: "ncaaf_appalachianstate_ncstatewolfpack_2026-09-26_b3",
    sport: "cfb",
    // Historical storage date drifted to UTC day, while kickoff is Sep 26 CT.
    date: "2026-09-27",
    start: "2026-09-26T23:30:00Z",
    matchup: "Appalachian State @ NC State",
    awayName: "Appalachian State",
    homeName: "NC State",
  };
  const final = {
    id: "401999999",
    sport: "cfb",
    date: "2026-09-26",
    start: "2026-09-26T23:30:00Z",
    away: { name: "Appalachian State Mountaineers", abbr: "APP", score: 17 },
    home: { name: "NC State Wolfpack", abbr: "NCSU", score: 31 },
    status: { completed: true, detail: "Final" },
  };
  const hit = resolveFinalForSnapshot(row, [final]);
  assert.equal(hit?.id, final.id);
});

test("snapshot final reconciliation fails closed on ambiguous same-day doubleheaders", async () => {
  const { resolveFinalForSnapshot } = await import("../functions/lib/projLedger.js");
  const row = {
    gameId: "synthetic-series-game",
    sport: "mlb",
    date: "2026-09-29",
    start: "2026-09-29T18:00:00Z",
    matchup: "Philadelphia Phillies @ Atlanta Braves",
    awayName: "Philadelphia Phillies",
    homeName: "Atlanta Braves",
  };
  const finals = [
    {
      id: "a", sport: "mlb", date: "2026-09-29", start: "2026-09-29T17:00:00Z",
      away: { name: "Philadelphia Phillies", abbr: "PHI", score: 3 },
      home: { name: "Atlanta Braves", abbr: "ATL", score: 4 },
      status: { completed: true, detail: "Final" },
    },
    {
      id: "b", sport: "mlb", date: "2026-09-29", start: "2026-09-29T23:00:00Z",
      away: { name: "Philadelphia Phillies", abbr: "PHI", score: 6 },
      home: { name: "Atlanta Braves", abbr: "ATL", score: 2 },
      status: { completed: true, detail: "Final" },
    },
  ];
  assert.equal(resolveFinalForSnapshot(row, finals), null);
});

test("daily results path grades the full immutable projection population", async () => {
  const ledger = await readFile(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/daily-results-grade.yml", import.meta.url), "utf8");
  assert.match(ledger, /gradeSnapshotPopulationAgainstFinals/);
  assert.match(ledger, /snapshotFinalsGraded/);
  assert.match(workflow, /settleOnly=1&gradeResearch=1/);
});


test("trusted final-score ingress grades immutable projection population", async () => {
  const api = await readFile(new URL("../functions/api/final-grade.js", import.meta.url), "utf8");
  assert.match(api, /authorizeHarvest/);
  assert.match(api, /gradeSnapshotPopulationAgainstFinals/);
  assert.match(api, /too-many-finals/);
  assert.match(api, /trusted-scoreboard-push/);
});

test("daily grading has a GitHub-runner scoreboard fallback for all six sports", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/daily-results-grade.yml", import.meta.url),
    "utf8"
  );
  const script = await readFile(
    new URL("../scripts/fetch-final-scoreboard.mjs", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /actions\/checkout@v4\.2\.2/);
  assert.match(workflow, /fetch-final-scoreboard\.mjs/);
  assert.match(workflow, /\/api\/final-grade/);
  assert.match(workflow, /for sport in mlb nfl nba nhl cfb cbb/);
  assert.match(script, /fetchResultsForReconcile/);
  assert.match(script, /nflverse\/nfldata/);
  assert.match(script, /sportsdataverse\/cfbfastR-data/);
});


test("trusted final-score ingress is authenticated and feeds full snapshot grading", async () => {
  const api = await readFile(new URL("../functions/api/final-grade.js", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/daily-results-grade.yml", import.meta.url), "utf8");
  const script = await readFile(new URL("../scripts/fetch-final-scoreboard.mjs", import.meta.url), "utf8");
  assert.match(api, /authorizeHarvest/);
  assert.match(api, /gradeSnapshotPopulationAgainstFinals/);
  assert.match(workflow, /api\/final-grade/);
  assert.match(workflow, /fetch-final-scoreboard\.mjs/);
  assert.match(script, /fetchResultsForReconcile/);
  assert.match(script, /preferCfbd:false/);
  assert.match(script, /espn-groups-80-81-35/);
  assert.match(script, /cfbfastR/);
});


test("historical final grading tolerates bounded board-date drift and new freezes use kickoff date", async () => {
  const ledger = await readFile(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8");
  assert.match(ledger, /shiftDateCT\(day, -7\)/);
  assert.match(ledger, /shiftDateCT\(day, 7\)/);
  assert.match(ledger, /const canonicalDate = dateCT\(game\.start\) \|\| slate\.date/);
  assert.match(ledger, /const storageDate = existing\?\.date \|\| canonicalDate/);
});


test("snapshot reconciliation uses a unique near-exact start to distinguish MLB doubleheaders", async () => {
  const { resolveFinalForSnapshot } = await import("../functions/lib/projLedger.js");
  const row = {
    gameId: "synthetic-doubleheader-g2",
    sport: "mlb",
    date: "2026-09-25",
    start: "2026-09-25T23:05:00Z",
    matchup: "Baltimore @ New York",
    awayName: "Baltimore Orioles",
    homeName: "New York Yankees",
  };
  const finals = [
    {
      id: "g1", sport: "mlb", date: "2026-09-25", start: "2026-09-25T20:05:00Z",
      away: { name: "Baltimore Orioles", abbr: "BAL", score: 2 },
      home: { name: "New York Yankees", abbr: "NYY", score: 5 },
      status: { completed: true, detail: "Final" },
    },
    {
      id: "g2", sport: "mlb", date: "2026-09-25", start: "2026-09-25T23:05:00Z",
      away: { name: "Baltimore Orioles", abbr: "BAL", score: 4 },
      home: { name: "New York Yankees", abbr: "NYY", score: 3 },
      status: { completed: true, detail: "Final" },
    },
  ];
  assert.equal(resolveFinalForSnapshot(row, finals)?.id, "g2");
});

test("runner final fetch merges primary and public college scoreboards", async () => {
  const script = await readFile(new URL("../scripts/fetch-final-scoreboard.mjs", import.meta.url), "utf8");
  assert.match(script, /function mergeFinals/);
  assert.match(script, /espn-groups-80-81-35/);
  assert.match(script, /cfbfastR/);
  assert.match(script, /preferCfbd:false/);
});

test("historical final grading uses a lightweight unresolved snapshot read", async () => {
  const store = await readFile(new URL("../functions/lib/store.js", import.meta.url), "utf8");
  const ledger = await readFile(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8");
  assert.match(store, /queryFinalSnapshotCandidates/);
  assert.match(store, /game_id, sport, date, matchup, checkpoint, model_version, frozen_at/);
  assert.match(store, /actual_home IS NULL AND actual_away IS NULL/);
  assert.match(ledger, /queryFinalSnapshotCandidates\(env/);
});

test("invalid historical snapshots can be explicitly excluded from learning", async () => {
  const api = await readFile(new URL("../functions/api/final-grade.js", import.meta.url), "utf8");
  const store = await readFile(new URL("../functions/lib/store.js", import.meta.url), "utf8");
  const report = await readFile(new URL("../functions/api/learning-report.js", import.meta.url), "utf8");
  const learning = await readFile(new URL("../functions/lib/snapshotLearning.js", import.meta.url), "utf8");
  assert.match(api, /learning-exclusions/);
  assert.match(store, /LEARNING_EXCLUDED/);
  assert.match(report, /COALESCE\(projection_state,''\) != 'LEARNING_EXCLUDED'/);
  assert.match(learning, /projectionState.*LEARNING_EXCLUDED/);
});

test("historical backfill can post pre-reconciled verified grades without rescanning D1", async () => {
  const api = await readFile(new URL("../functions/api/final-grade.js", import.meta.url), "utf8");
  const planner = await readFile(new URL("../scripts/build-final-grade-plan.mjs", import.meta.url), "utf8");
  assert.match(api, /direct-verified-grades/);
  assert.match(api, /gradeSnapshotsForGame/);
  assert.match(api, /invalid-direct-grade/);
  assert.match(planner, /resolveFinalForSnapshot/);
  assert.match(planner, /AWAITING FINAL/);
  assert.match(planner, /unmatchedGameIds/);
});

test("final-grade ingress supports bounded write batches for large historical slates", async () => {
  const api = await readFile(new URL("../functions/api/final-grade.js", import.meta.url), "utf8");
  const ledger = await readFile(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8");
  assert.match(api, /batchLimit/);
  assert.match(api, /maxWrites:batchLimit/);
  assert.match(ledger, /writeCap/);
  assert.match(ledger, /truncated/);
  assert.match(ledger, /writeAttempts/);
});

test("final-grade ingress rejects absent scores instead of coercing null to zero", async () => {
  const api = await readFile(new URL("../functions/api/final-grade.js", import.meta.url), "utf8");
  assert.match(api, /function finiteScore/);
  assert.match(api, /v==null \|\| v===""\) return null/);
  assert.match(api, /homeScore==null \|\| awayScore==null/);
});


test("projection sheet mirror uses canonical game/model identity and CT game dates", async () => {
  const orchestrator = await readFile(
    new URL("../services/sports-projection-orchestrator/orchestrator.mjs", import.meta.url),
    "utf8"
  );
  assert.match(orchestrator, /function canonicalProjectionKey/);
  assert.match(orchestrator, /start\?dateKeyCT\(new Date\(start\)\)/);
  assert.match(orchestrator, /allProjectionBackfilled/);
  assert.match(orchestrator, /sheetRowCanonicalKey/);
  assert.match(orchestrator, /auditCanonicalKey/);
  assert.match(orchestrator, /boardGameCanonicalKey/);
});

test("learning report deduplicates provider aliases and preserves market-blind FBIS identity", async () => {
  const api = await readFile(new URL("../functions/api/learning-report.js", import.meta.url), "utf8");
  assert.match(api, /canonicalGameExpr/);
  assert.match(api, /PARTITION BY \$\{canonicalGameExpr\},\$\{modelExpr\}/);
  assert.match(api, /date:dateCt\(row\.event_start\)\|\|row\.date/);
  assert.match(api, /kind==="FBIS"/);
  assert.match(api, /return false;/);
});
