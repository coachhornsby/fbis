import test from "node:test";
import assert from "node:assert/strict";
import {
  describeCoreHoldoutEvalDesign,
  auditCoreHoldoutCoverage,
  buildEligibleCoreHoldoutRows,
  selectLambdaWithinTrainSeason,
  evaluateFrozenModelCHoldout,
  runCore2025Train2026HoldoutReport,
  selectCoreThroughWeekForGame,
  CORE_HOLDOUT_TRAIN_SEASON,
  CORE_HOLDOUT_EVAL_SEASON,
} from "../functions/lib/cfbCoreHoldout.js";

function archiveFor(season, throughWeeks, teams) {
  const rows = [];
  for (const tw of throughWeeks) {
    for (const t of teams) {
      rows.push({
        season,
        through_week: tw,
        school_key: t.key,
        core: t.core + tw,
        core_offense: t.off + tw * 0.1,
        core_defense: t.def - tw * 0.1,
        collection_time: `20${String(season).slice(2)}-09-${String(tw).padStart(2, "0")}T12:00:00.000Z`,
      });
    }
  }
  return rows;
}

const TEAMS = [
  { key: "georgia", name: "Georgia", core: 20, off: 12, def: -10 },
  { key: "alabama", name: "Alabama", core: 18, off: 11, def: -9 },
  { key: "auburn", name: "Auburn", core: 10, off: 6, def: -5 },
  { key: "ole miss", name: "Ole Miss", core: 12, off: 8, def: -6 },
];

function game({ season, week, home, away, homePts, awayPts, bh, ba, id }) {
  const kick = `${season}-09-${String(Math.min(28, 7 + week)).padStart(2, "0")}T19:00:00.000Z`;
  return {
    gameId: id || `${season}-w${week}-${home}-${away}`,
    season,
    week,
    kickoff: kick,
    homeTeam: home,
    awayTeam: away,
    actualHome: homePts,
    actualAway: awayPts,
    finalVerified: true,
    finalAt: new Date(Date.parse(kick) + 4 * 3600 * 1000).toISOString(),
    baselineHome: bh,
    baselineAway: ba,
  };
}

function buildCorpus() {
  const archives = [
    ...archiveFor(2025, [4, 5, 6, 7, 8, 9], TEAMS),
    ...archiveFor(2026, [4, 5, 6], TEAMS),
  ];
  const games = [];
  let n = 0;
  // 2025 weeks 5–10: enough train games
  for (let week = 5; week <= 10; week++) {
    for (let i = 0; i < 25; i++) {
      n += 1;
      const home = TEAMS[i % TEAMS.length].name;
      const away = TEAMS[(i + 1) % TEAMS.length].name;
      const margin = ((i % 7) - 3) * 3 + (week % 3);
      games.push(
        game({
          season: 2025,
          week,
          home,
          away,
          homePts: 28 + margin,
          awayPts: 28,
          bh: 27 + margin * 0.5,
          ba: 24,
          id: `2025-${n}`,
        })
      );
    }
  }
  // 2026 holdout weeks 5–7
  for (let week = 5; week <= 7; week++) {
    for (let i = 0; i < 25; i++) {
      n += 1;
      const home = TEAMS[i % TEAMS.length].name;
      const away = TEAMS[(i + 2) % TEAMS.length].name;
      const margin = ((i % 5) - 2) * 4;
      games.push(
        game({
          season: 2026,
          week,
          home,
          away,
          homePts: 30 + margin,
          awayPts: 24,
          bh: 29 + margin * 0.4,
          ba: 25,
          id: `2026-${n}`,
        })
      );
    }
  }
  return { archives, games };
}

test("holdout design locks 2025 train/select and forbids 2026 tune", () => {
  const d = describeCoreHoldoutEvalDesign();
  assert.equal(d.trainSeason, 2025);
  assert.equal(d.evaluateSeason, 2026);
  assert.ok(d.forbidden.includes("use_2026_for_both_tune_and_evaluate"));
  assert.ok(d.forbidden.includes("tune_lambda_on_2026"));
  assert.equal(d.canInfluenceProduction, false);
});

test("selectCoreThroughWeekForGame enforces throughWeek < gameWeek", () => {
  assert.equal(selectCoreThroughWeekForGame([4, 5, 6, 7], 7), 6);
  assert.equal(selectCoreThroughWeekForGame([7], 7), null);
  assert.equal(selectCoreThroughWeekForGame([4, 5], 4), null);
});

test("coverage audit blocks missing 2025 archives", () => {
  const archives = archiveFor(2026, [6, 7], TEAMS);
  const a = auditCoreHoldoutCoverage({
    archiveRows: archives,
    cfbdAccess: false,
    verifiedHistoricalCutoffs: false,
    championBaselinesAvailable: false,
    trainGameCount: 0,
    evalGameCount: 0,
  });
  assert.equal(a.ok, false);
  assert.ok(a.blockers.some((b) => b.code === "insufficient_2025_core_throughweeks"));
  assert.ok(a.blockers.some((b) => b.code === "cfbd_api_key_unavailable"));
});

test("eligible rows verify cutoffs and reject missing A/A baselines", () => {
  const { archives, games } = buildCorpus();
  const noBase = games.map(({ baselineHome, baselineAway, ...rest }) => rest);
  const bad = buildEligibleCoreHoldoutRows({ games: noBase, archiveRows: archives });
  assert.equal(bad.counts.eligible, 0);
  assert.ok(bad.validationErrors.missing_champion_aa_baseline > 0);

  const good = buildEligibleCoreHoldoutRows({ games, archiveRows: archives });
  assert.ok(good.counts.train2025 >= 100);
  assert.ok(good.counts.holdout2026 >= 50);
  assert.equal(good.verifiedHistoricalCutoffs, true);
  assert.ok(good.eligible.every((r) => r.throughWeek < r.week));
});

test("lambda selection uses 2025 only and never references 2026", () => {
  const { archives, games } = buildCorpus();
  const built = buildEligibleCoreHoldoutRows({ games, archiveRows: archives });
  const sel = selectLambdaWithinTrainSeason(built.train);
  assert.equal(sel.season, CORE_HOLDOUT_TRAIN_SEASON);
  assert.equal(sel.neverUsedEvalSeason, CORE_HOLDOUT_EVAL_SEASON);
  assert.ok(Number.isFinite(sel.selectedLambda));
  assert.ok(sel.folds.length >= 1);
});

test("frozen holdout fits on 2025 and evaluates 2026 without pooling", () => {
  const { archives, games } = buildCorpus();
  const built = buildEligibleCoreHoldoutRows({ games, archiveRows: archives });
  const result = evaluateFrozenModelCHoldout({
    trainRows: built.train,
    holdoutRows: built.holdout,
  });
  assert.equal(result.ok, true);
  assert.equal(result.blocked, false);
  assert.equal(result.coefficients.frozen, true);
  assert.equal(result.coefficients.lastTrainingSeason, 2025);
  assert.equal(result.coefficients.evaluateSeason, 2026);
  assert.equal(result.coefficients.neverRefitOnEvaluateSeason, true);
  assert.ok(result.holdout2026.n >= 50);
  assert.ok(result.holdout2026.headToHeadVsChampionAA.n >= 50);
  assert.ok(Array.isArray(result.coefficients.combined.margin.beta));
  assert.equal(result.coefficients.combined.margin.beta.length, 4);
  assert.equal(result.canInfluenceProduction, false);
});

test("end-to-end report blocks when 2025 CORE archive missing", () => {
  const archives = archiveFor(2026, [6], TEAMS);
  const games = [
    game({
      season: 2026,
      week: 7,
      home: "Georgia",
      away: "Auburn",
      homePts: 31,
      awayPts: 17,
      bh: 30,
      ba: 20,
    }),
  ];
  const report = runCore2025Train2026HoldoutReport({
    games,
    archiveRows: archives,
    cfbdAccess: false,
  });
  assert.equal(report.blocked, true);
  assert.equal(report.status, "MODEL_C_BLOCKED");
  assert.equal(report.coefficients, null);
  assert.equal(report.productionSafeguards.championAAUnchanged, true);
  assert.ok(report.blockers.some((b) => /2025|cfbd|cutoff|baseline|train|games/i.test(b.code)));
});

test("end-to-end report completes on sufficient synthetic corpus", () => {
  const { archives, games } = buildCorpus();
  const report = runCore2025Train2026HoldoutReport({
    games,
    archiveRows: archives,
    cfbdAccess: true,
  });
  assert.equal(report.blocked, false);
  assert.equal(report.status, "FROZEN_HOLDOUT_COMPLETE");
  assert.equal(report.design.trainSeason, 2025);
  assert.equal(report.design.evaluateSeason, 2026);
  assert.ok(report.counts.train2025 >= 100);
  assert.ok(report.counts.holdout2026 >= 50);
  assert.ok(report.coefficients?.frozen);
  assert.ok(report.headToHeadVsChampionAA?.n >= 50);
  assert.equal(report.productionSafeguards.canAuthorizeWager, false);
});
