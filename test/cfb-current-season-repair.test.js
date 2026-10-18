import test from "node:test";
import assert from "node:assert/strict";
import { resetCacheMem, writeCache } from "../functions/lib/cache.js";
import {
  loadCfbDeepFeatures,
  attachCfbDeepFeatures,
  resolvePersistedGamesPlayed,
} from "../functions/lib/cfbDeepFeed.js";
import { projectCfbFbisV2Production } from "../functions/lib/cfbFbisV2.js";
import { runOklahomaProjectionAudit, OKLAHOMA_ORIGINAL_CLOSE, OKLAHOMA_ESPN_ID, OKLAHOMA_STATE_ESPN_ID } from "../functions/lib/cfbOklahomaAudit.js";
import {
  currentSeasonDominates,
  evaluatePriorDecayCandidates,
  CFB_PRIOR_DECAY_DEFAULT_K,
} from "../functions/lib/cfbPriorDecay.js";
import {
  compareTeamFeatureParity,
  runFeatureParityGate,
  snapshotFieldsToEngineShape,
} from "../functions/lib/cfbFeatureParityGate.js";
import { replayOneGame, aggregateReplayMetrics, scoreErrors } from "../functions/lib/cfbOct17Replay.js";

test("resolvePersistedGamesPlayed prefers explicit games then coreThroughWeek", () => {
  assert.equal(resolvePersistedGamesPlayed({ gamesPlayed: 5, coreThroughWeek: 6, coreWeekBounded: true }), 5);
  assert.equal(resolvePersistedGamesPlayed({ games: 4, coreThroughWeek: 6, coreWeekBounded: true }), 4);
  assert.equal(resolvePersistedGamesPlayed({ coreThroughWeek: 6, coreWeekBounded: true }), 6);
  assert.equal(resolvePersistedGamesPlayed({ coreThroughWeek: 6, coreWeekBounded: false }), null);
  assert.equal(resolvePersistedGamesPlayed({}), null);
});

test("Oklahoma CLOSE 34.1 reconstructs from 2025 prior with gamesPlayed=0", () => {
  const audit = runOklahomaProjectionAudit();
  assert.equal(audit.identityCheck.crossContamination, "PASS");
  assert.equal(audit.identityCheck.oklahomaEspnId, OKLAHOMA_ESPN_ID);
  assert.notEqual(OKLAHOMA_ESPN_ID, OKLAHOMA_STATE_ESPN_ID);
  assert.equal(audit.originalReconstruction.withinRoundingTolerance, true);
  assert.equal(audit.originalReconstruction.fitted.home, OKLAHOMA_ORIGINAL_CLOSE.projHome);
  assert.equal(audit.originalReconstruction.fitted.away, OKLAHOMA_ORIGINAL_CLOSE.projAway);
  assert.equal(audit.rootCause.priorOff, 34.61);
  // Repaired path must move off the prior-only 34.1 using current PPA + n=6.
  assert.ok(audit.repaired.fitted.home < 34.1);
  assert.ok(audit.repaired.fitted.away > 15.2);
  assert.equal(audit.repaired.week7CurrentDominates.ok, true);
  assert.ok(audit.repaired.vsActual.repairedMarginError < audit.repaired.vsActual.originalMarginError);
});

test("persisted D1 deep feed maps coreThroughWeek into gamesPlayed and drives blend", async () => {
  resetCacheMem();
  const env = {
    cfbdCacheOnly: true,
    DB: {
      prepare(sql) {
        assert.match(sql, /team_feature_snapshots/);
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      team_id: "cfb-201",
                      as_of: "2026-10-15T17:00:00Z",
                      features_json: JSON.stringify({
                        team: "Oklahoma",
                        ppaOff: -0.04,
                        ppaDef: -0.16,
                        ppaPass: 0.27,
                        ppaRush: -0.24,
                        coreThroughWeek: 6,
                        coreWeekBounded: true,
                        off: 25.6,
                        def: 13.6,
                      }),
                    },
                    {
                      team_id: "cfb-96",
                      as_of: "2026-10-15T17:00:00Z",
                      features_json: JSON.stringify({
                        team: "Kentucky",
                        ppaOff: 0.21,
                        ppaDef: 0.04,
                        ppaPass: 0.24,
                        ppaRush: 0.19,
                        coreThroughWeek: 6,
                        coreWeekBounded: true,
                      }),
                    },
                  ],
                };
              },
            };
          },
        };
      },
    },
  };
  const feed = await loadCfbDeepFeatures(env, {
    now: Date.parse("2026-10-17T18:00:00Z"),
    fetchFn: async () => {
      throw new Error("must not call provider");
    },
  });
  assert.equal(feed.meta.source, "cfbd-weekly-persisted-d1");
  assert.equal(feed.bySchool.oklahoma.gamesPlayed, 6);
  assert.equal(feed.bySchool.oklahoma.gamesPlayedSource, "coreThroughWeek");
  assert.equal(feed.bySchool.oklahoma.offensePpa, -0.04);
  assert.equal(feed.byEspnId["201"].offensePpa, -0.04);
  // SP off must never be treated as current PPG on the deep feed.
  assert.equal(feed.bySchool.oklahoma.off, undefined);
  assert.equal(feed.bySchool.oklahoma.currentPointsForPerGame, null);

  const [game] = attachCfbDeepFeatures(
    [
      {
        sport: "cfb",
        home: { name: "Oklahoma", school: "Oklahoma", espnId: "201" },
        away: { name: "Kentucky", school: "Kentucky", espnId: "96" },
        cfb: {
          homeEst: { priorOff: 34.61, priorDef: 13.51 },
          awayEst: { priorOff: 28.58, priorDef: 22.66 },
        },
      },
    ],
    feed
  );
  const proj = projectCfbFbisV2Production(game);
  assert.equal(proj.ok, true);
  assert.ok(proj.priorDecay.homeCurrentWeight >= 0.5);
  assert.notEqual(proj.home, 34.1);
  assert.ok(proj.home < 34.1);
});

test("cache-only miss falls back to warmed Workers cache (PR #1231 regression)", async () => {
  resetCacheMem();
  const payload = {
    season: 2026,
    byEspnId: { 204: { school: "Oregon State", espnId: "204", offensePpa: 0.2, gamesPlayed: 4 } },
    bySchool: { "oregon state": { school: "Oregon State", espnId: "204", offensePpa: 0.2, gamesPlayed: 4 } },
    meta: { records: 1, asOf: "2026-10-10T19:00:00Z", source: "cfbd-team-ppa+advanced+completed-games" },
  };
  await writeCache("cfb-deep-v2-2026", payload, null, 7200000);
  const env = {
    cfbdCacheOnly: true,
    caches: null,
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
  const feed = await loadCfbDeepFeatures(env, {
    now: Date.parse("2026-10-10T20:00:00Z"),
    fetchFn: async () => {
      throw new Error("must not call provider");
    },
  });
  assert.equal(feed.meta.warmedCacheFallback, true);
  assert.equal(feed.byEspnId["204"].offensePpa, 0.2);
  resetCacheMem();
});

test("current-season evidence is not replaced by prior when n is adequate", () => {
  const gate = currentSeasonDominates({ gamesPlayed: 6, k: CFB_PRIOR_DECAY_DEFAULT_K });
  assert.equal(gate.ok, true);
  assert.ok(gate.currentWeight >= 0.5);
  const early = currentSeasonDominates({ gamesPlayed: 1 });
  assert.equal(early.ok, false);
});

test("prior-decay candidate sweep is research-only and keeps default k=6 documented", () => {
  const rows = [
    { prior: 34.61, current: 24.9, gamesPlayed: 6, actual: 26 },
    { prior: 28.58, current: 34.9, gamesPlayed: 6, actual: 30 },
    { prior: 30, current: 28, gamesPlayed: 7, actual: 29 },
  ];
  const evals = evaluatePriorDecayCandidates(rows);
  assert.ok(evals.length >= 4);
  assert.ok(evals.every((e) => e.researchOnly === true));
  assert.ok(evals.some((e) => e.productionDefault && e.k === 6));
});

test("feature parity gate fails when page has PPA but engine gamesPlayed is 0", () => {
  const page = {
    ppaOff: -0.04,
    ppaDef: -0.16,
    coreThroughWeek: 6,
    coreWeekBounded: true,
  };
  const engine = snapshotFieldsToEngineShape(page);
  // Simulate the broken engine state before repair.
  const broken = { ...engine, gamesPlayed: 0 };
  const cmp = compareTeamFeatureParity({
    teamId: "201",
    pageFeatures: page,
    engineFeatures: broken,
  });
  assert.equal(cmp.ok, false);
  assert.ok(cmp.discrepancies.some((d) => d.reason === "current-ppa-ignored-zero-games-played"));

  const fixed = compareTeamFeatureParity({
    teamId: "201",
    pageFeatures: page,
    engineFeatures: engine,
  });
  assert.equal(fixed.ok, true);

  const gate = runFeatureParityGate({
    games: [{ id: "401856722", home: { espnId: "201" }, away: { espnId: "96" }, cfbDeepInput: { home: engine, away: engine } }],
    pageByEspnId: { 201: page, 96: page },
    engineByEspnId: { 201: engine, 96: engine },
  });
  assert.equal(gate.ok, true);
});

test("Oklahoma/Oklahoma State identity cannot cross-contaminate in replay helper", () => {
  const row = replayOneGame({
    close: {
      game_id: "401856722",
      matchup: "Kentucky @ Oklahoma",
      proj_home: 34.1,
      proj_away: 15.2,
      actual_home: 13,
      actual_away: 21,
      frozen_at: "2026-10-17T22:53:25Z",
    },
    homeEspnId: "201",
    awayEspnId: "96",
    homeFeatures: {
      ppaOff: -0.04,
      ppaDef: -0.16,
      coreThroughWeek: 6,
      coreWeekBounded: true,
    },
    awayFeatures: {
      ppaOff: 0.21,
      ppaDef: 0.04,
      coreThroughWeek: 6,
      coreWeekBounded: true,
    },
    homeFeatureAsOf: "2026-10-17T16:32:00Z",
    awayFeatureAsOf: "2026-10-17T16:32:00Z",
    kickoff: "2026-10-17T23:30:00Z",
    mode: "diagnostic",
  });
  assert.equal(row.eligible, true);
  assert.notEqual(row.rebuilt.home, 34.1);
  const okst = replayOneGame({
    close: {
      game_id: "401856831",
      matchup: "Oklahoma State @ Houston",
      proj_home: 32.6,
      proj_away: 18.3,
      actual_home: 35,
      actual_away: 32,
      frozen_at: "2026-10-17T22:53:25Z",
    },
    homeEspnId: "248",
    awayEspnId: "197",
    homeFeatures: { ppaOff: 0.1, ppaDef: 0.05, coreThroughWeek: 6, coreWeekBounded: true },
    awayFeatures: { ppaOff: -0.2, ppaDef: 0.1, coreThroughWeek: 6, coreWeekBounded: true },
    homeFeatureAsOf: "2026-10-17T16:00:00Z",
    awayFeatureAsOf: "2026-10-17T16:00:00Z",
    kickoff: "2026-10-17T23:00:00Z",
    mode: "diagnostic",
  });
  assert.equal(okst.eligible, true);
  assert.notEqual(okst.gameId, row.gameId);

  const agg = aggregateReplayMetrics([row, okst]);
  assert.equal(agg.nEligibleGraded, 2);
  assert.match(agg.note, /No ATS/);
});

test("scoreErrors marks winner correctly for UK upset", () => {
  const e = scoreErrors(34.1, 15.2, 13, 21);
  assert.equal(e.winnerCorrect, false);
  assert.equal(e.projWinner, "home");
  assert.equal(e.actualWinner, "away");
});
