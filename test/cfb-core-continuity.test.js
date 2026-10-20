import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoreWeeklyMovement,
  assessCoreChallengerCorpus,
  buildCoreMatchupAdvantages,
} from "../functions/lib/cfbCoreContinuity.js";

test("movement classifies identical cross-week values as source lag / relabel", () => {
  const earlier = [{ schoolKey: "georgia", core: 26, coreOffense: 15, coreDefense: -11 }];
  const later = [{ school_key: "georgia", core: 26, core_offense: 15, core_defense: -11 }];
  const m = buildCoreWeeklyMovement({
    earlier,
    later,
    earlierThroughWeek: 6,
    laterThroughWeek: 7,
  });
  assert.equal(m.genuineMoves, 0);
  assert.equal(m.identical, 1);
  assert.equal(m.rows[0].classification, "identical_across_labels_source_lag_or_relabel");
});

test("movement detects genuine CORE deltas", () => {
  const m = buildCoreWeeklyMovement({
    earlier: [{ schoolKey: "georgia", core: 26, coreOffense: 15, coreDefense: -11 }],
    later: [{ schoolKey: "georgia", core: 28, coreOffense: 16, coreDefense: -12 }],
    earlierThroughWeek: 6,
    laterThroughWeek: 7,
  });
  assert.equal(m.genuineMoves, 1);
  assert.equal(m.rows[0].delta.core, 2);
});

test("challenger corpus insufficient without multi-week PIT + OOS artifact", () => {
  const a = assessCoreChallengerCorpus({
    archivedThroughWeeks: [6],
    shadowPredictionCount: 41,
    verifiedOosArtifacts: 0,
    seasonsCovered: 1,
  });
  assert.equal(a.sufficientToFitAndEvaluate, false);
  assert.ok(a.missing.some((m) => m.code === "no_verified_oos_artifact"));
  assert.ok(a.backfillPlan?.steps?.length > 0);
  assert.equal(a.canAuthorizeWager, false);
});

test("matchup advantages use existing cross formula and flag missing CORE", () => {
  const core = new Map([
    ["georgia", { core: 26, coreOffense: 15, coreDefense: -11, throughWeek: 6 }],
    ["auburn", { core: 10, coreOffense: 5, coreDefense: -5, throughWeek: 6 }],
  ]);
  const rows = buildCoreMatchupAdvantages({
    games: [
      { gameId: "1", homeTeam: "Georgia", awayTeam: "Auburn", identityStatus: "matched" },
      { gameId: "2", homeTeam: "Miami", awayTeam: "FSU", identityStatus: "partial_match" },
    ],
    coreBySchoolKey: core,
  });
  assert.equal(rows[0].eligible, true);
  assert.equal(rows[0].coreCrossMargin, (15 - -5) - (5 - -11));
  assert.equal(rows[1].eligible, false);
  assert.ok(rows[1].missing.includes("home_core"));
});
