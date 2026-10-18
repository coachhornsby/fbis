import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveGamesPlayedWithSource,
  GAMES_PLAYED_SOURCES,
  countCompletedGamesBySchool,
} from "../functions/lib/cfbGamesPlayed.js";
import {
  auditTeamFeatureUsage,
  summarizeFeatureCoverage,
  CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION,
} from "../functions/lib/cfbFeatureUsageAudit.js";
import {
  projectModelA,
  projectModelB,
  projectModelC,
  projectModelD,
  projectModelE,
} from "../functions/lib/cfbCurrentSeasonChallengers.js";
import { summarizeResearchModelFamilies } from "../functions/lib/cfbResearchModelFamilies.js";
import {
  runOklahomaProjectionAudit,
  explainRepairedOklahomaInflation,
  OKLAHOMA_ESPN_ID,
  OKLAHOMA_STATE_ESPN_ID,
} from "../functions/lib/cfbOklahomaAudit.js";
import { buildCfbProjectionReliability } from "../functions/lib/cfbProjectionReliability.js";
import { resolvePersistedGamesPlayed } from "../functions/lib/cfbDeepFeed.js";
import {
  buildRollingOriginFolds,
  summarizeWalkForward,
  evaluateFold,
} from "../functions/lib/cfbWalkForward.js";
import { findSnapshotPredictionGaps } from "../functions/lib/cfbSnapshotSettlement.js";

test("gamesPlayed prefers schedule over coreThroughWeek and flags fallback", () => {
  const fallback = resolveGamesPlayedWithSource({
    coreThroughWeek: 6,
    coreWeekBounded: true,
  });
  assert.equal(fallback.source, GAMES_PLAYED_SOURCES.CORE_THROUGH_WEEK_FALLBACK);
  assert.equal(fallback.uncertainty, true);
  assert.equal(fallback.gamesPlayed, 6);

  const schedule = resolveGamesPlayedWithSource(
    { coreThroughWeek: 6, coreWeekBounded: true },
    { scheduleGamesPlayed: 7 }
  );
  assert.equal(schedule.source, GAMES_PLAYED_SOURCES.SCHEDULE);
  assert.equal(schedule.uncertainty, false);
  assert.equal(schedule.gamesPlayed, 7);

  assert.equal(
    resolvePersistedGamesPlayed({ coreThroughWeek: 6, coreWeekBounded: true }, { scheduleGamesPlayed: 7 }),
    7
  );
});

test("coreThroughWeek is not silently treated as verified games without flag", () => {
  const r = resolveGamesPlayedWithSource({
    coreThroughWeek: 6,
    coreWeekBounded: true,
  });
  assert.match(String(r.note), /proxy/i);
  assert.notEqual(r.source, GAMES_PLAYED_SOURCES.EXPLICIT);
  assert.notEqual(r.source, GAMES_PLAYED_SOURCES.SCHEDULE);
});

test("feature usage audit separates collected vs champion-consumed fields", () => {
  const audit = auditTeamFeatureUsage({
    ppaOff: -0.04,
    ppaDef: -0.16,
    offensiveSuccessRate: 0.38,
    coreOffense: -4.7,
    gamesPlayed: 6,
    gamesPlayedSource: "coreThroughWeekFallback",
  });
  assert.ok(audit.presentButUnusedByChampion.includes("offensiveSuccessRate"));
  assert.ok(audit.presentButUnusedByChampion.includes("coreOffense"));
  assert.ok(CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION.includes("offensiveSuccessRate"));
  assert.equal(audit.championConsumed.ppaOff, -0.04);
  assert.equal(audit.championConsumed.coreThroughWeekUsedAsN, true);
});

test("Oklahoma/Oklahoma State IDs remain distinct", () => {
  assert.equal(OKLAHOMA_ESPN_ID, "201");
  assert.equal(OKLAHOMA_STATE_ESPN_ID, "197");
  assert.notEqual(OKLAHOMA_ESPN_ID, OKLAHOMA_STATE_ESPN_ID);
});

test("Oklahoma audit reconstructs 34.1 and explains remaining 30.4 inflation", () => {
  const audit = runOklahomaProjectionAudit();
  assert.equal(audit.originalReconstruction.withinRoundingTolerance, true);
  assert.ok(Math.abs(audit.repaired.fitted.home - 30.4) < 0.15);
  const inflation = explainRepairedOklahomaInflation({
    repairedFitted: audit.repaired.fitted,
    ouBlend: audit.repaired.ouOffBlend,
  });
  assert.ok(inflation.factors.some((f) => f.id === "prior-still-50pct"));
  assert.ok(inflation.factors.some((f) => f.id === "champion-ignores-advanced-offense-limits"));
  assert.ok(inflation.currentOnlyProjection.home < audit.repaired.fitted.home + 0.01);
});

test("challengers are research-only and Model C fails closed without CORE artifact", () => {
  const game = {
    sport: "cfb",
    cfbFbisV2Input: {
      home: {
        priorOff: 34.61,
        priorDef: 13.51,
        gamesPlayed: 6,
        offensePpa: -0.04,
        defensePpa: -0.16,
        passEpa: 0.1,
        rushEpa: 0.05,
      },
      away: {
        priorOff: 28.58,
        priorDef: 22.66,
        gamesPlayed: 6,
        offensePpa: 0.21,
        defensePpa: 0.04,
        passEpa: 0.15,
        rushEpa: 0.08,
      },
    },
  };
  const a = projectModelA(game);
  const b = projectModelB(game);
  const c = projectModelC(game, { coreArtifact: null });
  const d = projectModelD(game);
  const e = projectModelE(game);
  assert.equal(a.canAuthorizeWager, false);
  assert.equal(b.canAuthorizeWager, false);
  assert.equal(b.canInfluenceProduction, false);
  assert.equal(b.modelId, "CFB-RESEARCH-B");
  assert.equal(c.ok, false);
  assert.equal(c.reason, "FITTED_CORE_ARTIFACT_UNAVAILABLE");
  assert.equal(d.ok, false);
  assert.equal(d.reason, "FITTED_SDV_ARTIFACT_UNAVAILABLE");
  assert.equal(e.canInfluenceProduction, false);
  assert.equal(e.improvesOverChampion, false);
  assert.ok(b.ok);
  assert.ok(e.ok);
});

test("research families report fitted B/E without promotion or OOS improvement", () => {
  const snap = summarizeResearchModelFamilies();
  assert.equal(snap.promotionAuthorized, false);
  assert.equal(snap.wagerAuthorized, false);
  assert.equal(snap.advancedStatsImproveChampion, false);
  const byId = Object.fromEntries(snap.families.map((f) => [f.id, f]));
  assert.equal(byId.A.fitted, true);
  assert.equal(byId.B.fitted, true);
  assert.equal(byId.C.fitted, false);
  assert.equal(byId.D.fitted, false);
  assert.equal(byId.E.fitted, true);
  assert.equal(byId.B.improvesOverChampion, false);
  assert.equal(byId.E.improvesOverChampion, false);
});

test("projection reliability flags provisional and offense-exceedance", () => {
  const game = {
    cfbFbisV2Input: {
      home: {
        gamesPlayed: 6,
        gamesPlayedSource: "coreThroughWeekFallback",
        gamesPlayedUncertainty: true,
        offensePpa: -0.04,
        defensePpa: -0.16,
        coreThroughWeek: 6,
      },
      away: {
        gamesPlayed: 6,
        offensePpa: 0.21,
        defensePpa: 0.04,
      },
    },
  };
  const reliability = buildCfbProjectionReliability(game, {
    home: 30.4,
    away: 20.3,
    provisional: true,
    priorDecay: { homeCurrentWeight: 0.5, awayCurrentWeight: 0.5 },
    missingCurrentSignals: [],
  });
  assert.equal(reliability.provisional, true);
  assert.equal(reliability.exceedsCurrentOffenseProfile, true);
  assert.equal(reliability.canAuthorizeWager, false);
});

test("schedule game counter ignores future kickoffs", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const map = countCompletedGamesBySchool(
    [
      {
        homeTeam: "Oklahoma",
        awayTeam: "Kentucky",
        homePoints: 13,
        awayPoints: 21,
        startDate: "2026-10-10T00:00:00Z",
        completed: true,
      },
      {
        homeTeam: "Oklahoma",
        awayTeam: "Texas",
        homePoints: 0,
        awayPoints: 0,
        startDate: "2026-10-18T00:00:00Z",
        completed: true,
      },
    ],
    now
  );
  assert.equal(map.get("oklahoma"), 1);
});

test("feature coverage summary detects page-without-n parity gaps", () => {
  const summary = summarizeFeatureCoverage([
    { features: { ppaOff: 0.1, gamesPlayed: 0 } },
    { features: { ppaOff: 0.2, gamesPlayed: 6 } },
  ]);
  assert.equal(summary.pageWithoutN, 1);
  assert.equal(summary.withBoth, 1);
});

test("walk-forward scaffold keeps CORE unproven without artifact", () => {
  const summary = summarizeWalkForward([], { coreArtifactAvailable: false });
  assert.match(summary.coreIncrementalValue, /UNPROVEN/);
  assert.equal(summary.canPromote, false);
  assert.equal(summary.canAuthorizeWager, false);
});

test("rolling-origin folds require training history before test week", () => {
  const games = [];
  for (let w = 1; w <= 4; w += 1) {
    for (let i = 0; i < 15; i += 1) {
      games.push({
        season: 2025,
        week: w,
        game: {
          sport: "cfb",
          cfbFbisV2Input: {
            home: { priorOff: 28, priorDef: 20, gamesPlayed: 4, offensePpa: 0.1, defensePpa: 0 },
            away: { priorOff: 24, priorDef: 22, gamesPlayed: 4, offensePpa: 0, defensePpa: 0.05 },
          },
        },
        actualHome: 27,
        actualAway: 21,
      });
    }
  }
  const folds = buildRollingOriginFolds(games, { minTrainGames: 20 });
  assert.ok(folds.length >= 1);
  const eval0 = evaluateFold(folds[0], { models: ["A", "B", "E"] });
  assert.ok(eval0.byModel.A.nGraded > 0);
  assert.ok(eval0.byModel.B.nGraded > 0);
  assert.ok(eval0.byModel.E.nGraded > 0);
});

test("snapshot settlement gap finder refuses unbound env", async () => {
  const r = await findSnapshotPredictionGaps({}, { sport: "cfb", date: "2026-10-17" });
  assert.equal(r.ok, false);
  assert.equal(r.gaps.length, 0);
});

test("harvest wires prediction→snapshot settlement for CFB", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../functions/lib/projLedger.js", import.meta.url), "utf8")
  );
  assert.match(src, /promotePredictionFinalsToSnapshots/);
  assert.match(src, /snapshotSettlement/);
});
