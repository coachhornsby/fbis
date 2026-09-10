import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyQb1,
  identifyRb1,
  identifyWr1,
  identifyGamePlayerRoles,
  filterPlayerGamesBeforeKickoff,
  flattenGamesPlayersResponse,
  assertNoFutureRoleLeakage,
} from "../functions/lib/cfbPlayerIdentity.js";
import {
  projectCfbPlayerV1,
  attachCfbPlayerV1,
  probabilityAtThreshold,
  deriveTeamEnvironment,
  CFB_PLAYER_V1_ID,
} from "../functions/lib/cfbPlayerModel.js";
import { projectCfbFbisV2 } from "../functions/lib/cfbFbisV2.js";
import { reconcileGamePlayerCoherence, assertMarketIndependence } from "../functions/lib/cfbPlayerCoherence.js";
import {
  detectPropFeedStatus,
  buildPropMarketRecord,
  compareProjectionToMarket,
  tagPropCorrelations,
  PROP_SOURCES,
} from "../functions/lib/cfbPropMarket.js";
import { indexCoreByTeam, selectCoreThroughWeek, estimateRequestCount } from "../functions/lib/cfbdCanonical.js";
import { regularizePreseasonPrior } from "../functions/lib/cfbFeaturePipeline.js";
import { COLLEGE_MODELS } from "../functions/lib/collegeModels.js";

function baseGame(overrides = {}) {
  const kickoff = "2024-10-12T19:00:00.000Z";
  return {
    sport: "cfb",
    id: "g-1",
    home: { name: "Alabama", fullName: "Alabama", abbr: "ALA" },
    away: { name: "Georgia", fullName: "Georgia", abbr: "UGA" },
    homeTeam: "Alabama",
    awayTeam: "Georgia",
    week: 7,
    season: 2024,
    startDate: kickoff,
    kickoff,
    featureCutoffOk: true,
    cfbFbisV2Input: {
      home: {
        priorOff: 38,
        priorDef: 16,
        off: 37,
        def: 17,
        gamesPlayed: 6,
        passEpa: 0.28,
        rushEpa: 0.12,
        passEpaAllowed: -0.05,
        rushEpaAllowed: 0.02,
        successRate: 0.48,
        successRateAllowed: 0.4,
        explosiveRate: 1.2,
        explosiveRateAllowed: 1.0,
        havocRate: 0.18,
        havocAllowed: 0.14,
        lineYards: 2.9,
        lineYardsAllowed: 2.4,
        pointsPerOpportunity: 4.2,
        pointsPerOpportunityAllowed: 3.6,
        paceNorm: 0.1,
        qbStarterKnown: true,
        qbName: "Home QB",
        qbPpa: 0.35,
        passEpa: 0.28,
      },
      away: {
        priorOff: 36,
        priorDef: 18,
        off: 35,
        def: 19,
        gamesPlayed: 6,
        passEpa: 0.22,
        rushEpa: 0.1,
        passEpaAllowed: 0.0,
        rushEpaAllowed: 0.05,
        successRate: 0.45,
        successRateAllowed: 0.42,
        explosiveRate: 1.15,
        explosiveRateAllowed: 1.05,
        havocRate: 0.16,
        havocAllowed: 0.15,
        lineYards: 2.7,
        lineYardsAllowed: 2.5,
        pointsPerOpportunity: 4.0,
        pointsPerOpportunityAllowed: 3.8,
        paceNorm: 0.05,
        qbStarterKnown: true,
        qbName: "Away QB",
        qbPpa: 0.3,
      },
    },
    ...overrides,
  };
}

function withV2(game) {
  const v2 = projectCfbFbisV2(game);
  return { ...game, cfbFbisV2: v2, challengers: { "CFB-FBIS-v2": v2 } };
}

test("CFB-PLAYER-v1 cannot qualify or authorize wagers", () => {
  assert.equal(COLLEGE_MODELS["CFB-PLAYER-v1"].canQualify, false);
  assert.equal(COLLEGE_MODELS["CFB-PLAYER-v1"].canAuthorizeWager, false);
  const game = withV2(baseGame());
  const proj = projectCfbPlayerV1(game, {
    feeds: {
      identityAsOf: "2024-10-12T12:00:00.000Z",
      qbPpaRows: [],
      rbPpaRows: [],
      wrPpaRows: [],
      usageRows: [],
      playerGameRows: [],
    },
  });
  assert.equal(proj.canQualify, false);
  assert.equal(proj.canAuthorizeWager, false);
  assert.equal(proj.canLog, false);
  assert.equal(proj.modelId, CFB_PLAYER_V1_ID);
});

test("player identity rejects future game rows", () => {
  const kickoff = "2024-10-12T19:00:00.000Z";
  const rows = [
    { name: "Past RB", team: "Alabama", position: "RB", rushingAttempts: 18, startDate: "2024-10-05T18:00:00.000Z" },
    { name: "Future RB", team: "Alabama", position: "RB", rushingAttempts: 40, startDate: "2024-10-19T18:00:00.000Z" },
  ];
  const prior = filterPlayerGamesBeforeKickoff(rows, kickoff);
  assert.equal(prior.length, 1);
  assert.equal(prior[0].name, "Past RB");
  assert.equal(assertNoFutureRoleLeakage({ roleWeek: 7, evidenceThroughWeek: 7 }).ok, false);
  assert.equal(assertNoFutureRoleLeakage({ roleWeek: 7, evidenceThroughWeek: 6 }).ok, true);
});

test("QB1 uncertain when evidence weak; confirmed starter preferred", () => {
  const uncertain = identifyQb1({ team: "Alabama", week: 1 });
  assert.equal(uncertain.state, "QB_UNCERTAIN");
  const confirmed = identifyQb1({
    team: "Alabama",
    week: 7,
    confirmedStarter: { name: "Jalen Milroe", playerId: "1", confidence: 0.95 },
  });
  assert.equal(confirmed.player_name, "Jalen Milroe");
  assert.equal(confirmed.state, "CONFIRMED_STARTER");
});

test("RB1 prefers recent carries over season yards leader", () => {
  const kickoff = "2024-10-12T19:00:00.000Z";
  const playerGameRows = [
    { name: "Season Leader", team: "Alabama", position: "RB", rushingAttempts: 5, rushingYards: 20, startDate: "2024-09-01T18:00:00.000Z" },
    { name: "Season Leader", team: "Alabama", position: "RB", rushingAttempts: 4, rushingYards: 10, startDate: "2024-09-08T18:00:00.000Z" },
    { name: "Current RB1", team: "Alabama", position: "RB", rushingAttempts: 22, rushingYards: 110, startDate: "2024-09-28T18:00:00.000Z" },
    { name: "Current RB1", team: "Alabama", position: "RB", rushingAttempts: 20, rushingYards: 95, startDate: "2024-10-05T18:00:00.000Z" },
  ];
  const rb = identifyRb1({ team: "Alabama", playerGameRows, kickoffTimestamp: kickoff, week: 7 });
  assert.equal(rb.player_name, "Current RB1");
  assert.ok(rb.role_confidence > 0.3);
});

test("WR1 prefers recent targets; TE excluded", () => {
  const kickoff = "2024-10-12T19:00:00.000Z";
  const playerGameRows = [
    { name: "Old WR", team: "Georgia", position: "WR", targets: 3, receptions: 2, receivingYards: 30, startDate: "2024-09-01T18:00:00.000Z" },
    { name: "New WR1", team: "Georgia", position: "WR", targets: 12, receptions: 8, receivingYards: 120, startDate: "2024-10-05T18:00:00.000Z" },
    { name: "TE Star", team: "Georgia", position: "TE", targets: 15, receptions: 10, receivingYards: 140, startDate: "2024-10-05T18:00:00.000Z" },
  ];
  const wr = identifyWr1({ team: "Georgia", playerGameRows, kickoffTimestamp: kickoff, week: 7 });
  assert.equal(wr.player_name, "New WR1");
  assert.notEqual(wr.player_name, "TE Star");
});

test("QB attempts/completions/yards coherent; RB and WR coherent", () => {
  const game = withV2(baseGame());
  const roles = identifyGamePlayerRoles(game, {
    identityAsOf: "2024-10-12T12:00:00.000Z",
    playerGameRows: [
      { name: "Away QB", team: "Georgia", position: "QB", passingAttempts: 30, passingYards: 240, startDate: "2024-10-05T18:00:00.000Z" },
      { name: "Home QB", team: "Alabama", position: "QB", passingAttempts: 28, passingYards: 250, startDate: "2024-10-05T18:00:00.000Z" },
      { name: "Away RB", team: "Georgia", position: "RB", rushingAttempts: 18, rushingYards: 80, startDate: "2024-10-05T18:00:00.000Z" },
      { name: "Home RB", team: "Alabama", position: "RB", rushingAttempts: 16, rushingYards: 70, startDate: "2024-10-05T18:00:00.000Z" },
      { name: "Away WR", team: "Georgia", position: "WR", targets: 9, receptions: 6, receivingYards: 85, startDate: "2024-10-05T18:00:00.000Z" },
      { name: "Home WR", team: "Alabama", position: "WR", targets: 10, receptions: 7, receivingYards: 95, startDate: "2024-10-05T18:00:00.000Z" },
    ],
  });
  const proj = projectCfbPlayerV1(game, { roles });
  for (const side of ["away", "home"]) {
    const qb = proj.players[side].QB1;
    assert.ok(qb.completions.projection <= qb.attempts.projection + 0.05);
    assert.ok(qb.passing_yards.projection / qb.attempts.projection > 3);
    assert.ok(qb.passing_yards.projection / qb.attempts.projection < 14);
    const rb = proj.players[side].RB1;
    assert.ok(rb.rushing_yards.projection / Math.max(rb.carries.projection, 0.1) > 1.5);
    const wr = proj.players[side].WR1;
    assert.ok(wr.receiving_yards.projection > 0);
    assert.ok(wr.receptions.projection > 0);
  }
  assert.ok(proj.coherence);
  assert.ok(proj.coherence.away.OTHER_RUSHING);
  assert.ok(proj.coherence.home.OTHER_RECEIVING);
});

test("market thresholds cannot alter player or game projections", () => {
  const game = withV2(baseGame());
  const base = projectCfbPlayerV1(game);
  const v2a = game.cfbFbisV2.home;
  const mutated = withV2({
    ...baseGame(),
    pinSpread: -14.5,
    pinTotal: 72.5,
    odds: { pinSpread: -3, pinTotal: 40, dkSpread: -7, fdSpread: -6.5 },
    prizePicks: { passing_yards: 999 },
    noVig: { consensus: 0.9 },
  });
  const again = projectCfbPlayerV1(mutated);
  assert.equal(mutated.cfbFbisV2.home, v2a);
  const ind = assertMarketIndependence(base, again);
  assert.equal(ind.ok, true, ind.diffs.join(","));

  const prop = base.players.home.QB1.passing_yards;
  const at45 = probabilityAtThreshold(prop, 245);
  const at99 = probabilityAtThreshold(prop, 400);
  assert.equal(at45.projection, prop.projection);
  assert.equal(at99.projection, prop.projection);
  assert.ok(at45.probabilityOver > at99.probabilityOver);
});

test("PrizePicks/NoVig interface status is research-only without fabricated feeds", () => {
  const status = detectPropFeedStatus();
  assert.equal(status.prizePicks.automated, false);
  assert.equal(status.noVig.automated, false);
  assert.equal(status.noVig.mayEnterIndependentModel, false);
  const built = buildPropMarketRecord({
    gameId: "g-1",
    playerName: "Home QB",
    marketType: "passing_yards",
    line: 250.5,
    source: PROP_SOURCES.PRIZEPICKS,
  });
  assert.equal(built.ok, true);
  const game = withV2(baseGame());
  const proj = projectCfbPlayerV1(game);
  const cmp = compareProjectionToMarket(proj.players.home.QB1.passing_yards, built.record);
  assert.equal(cmp.ok, true);
  assert.equal(cmp.projectionUnchanged, true);
  assert.equal(cmp.decision_eligible, false);
  assert.equal(cmp.prizePicks.conventionalEv, null);
  const tags = tagPropCorrelations([
    { game_id: "g-1", team: "Alabama", market_type: "passing_yards" },
    { game_id: "g-1", team: "Alabama", market_type: "receiving_yards" },
  ]);
  assert.equal(tags.autoRecommend, false);
  assert.ok(tags.tags.some((t) => t.tag.includes("qb_pass_yards")));
});

test("week-bounded CORE indexing rejects undated future weeks", () => {
  const rows = [
    { team: "Alabama", throughWeek: 3, throughSeasonType: "regular", rating: 0.2, offense: 0.3, defense: -0.1 },
    { team: "Alabama", throughWeek: 6, throughSeasonType: "regular", rating: 0.25, offense: 0.35, defense: -0.12 },
    { team: "Alabama", throughWeek: 8, throughSeasonType: "regular", rating: 0.4, offense: 0.5, defense: -0.2 },
  ];
  const idx = indexCoreByTeam(rows, { maxWeek: 6, seasonType: "regular" });
  assert.equal(idx.alabama.throughWeek, 6);
  assert.equal(idx.alabama.rating, 0.25);
  const picked = selectCoreThroughWeek(rows, { team: "Alabama", maxWeek: 5, seasonType: "regular" });
  assert.equal(picked.throughWeek, 3);
});

test("regularized prior does not invent zeros for missing ratings", () => {
  const empty = regularizePreseasonPrior({});
  assert.equal(empty.priorOff, null);
  assert.equal(empty.priorDef, null);
  const partial = regularizePreseasonPrior({ spOffense: 34, spDefense: 18, fpi: 12 });
  assert.ok(partial.priorOff != null);
  assert.ok(partial.hash);
});

test("attachCfbPlayerV1 is deterministic and shadow-only", () => {
  const game = withV2(baseGame());
  const a = attachCfbPlayerV1([game]);
  const b = attachCfbPlayerV1([game]);
  assert.equal(a.meta.canQualify, false);
  assert.equal(
    a.games[0].cfbPlayerV1.players.home.QB1.passing_yards.projection,
    b.games[0].cfbPlayerV1.players.home.QB1.passing_yards.projection
  );
  assert.ok(deriveTeamEnvironment(game, "home").expectedPlays > 0);
});

test("CFBD request estimate keeps customer page fanout at zero", () => {
  const est = estimateRequestCount({ seasons: 4, weeks: 15 });
  assert.equal(est.customerPageFanout, 0);
  assert.ok(est.historicalBackfillSeasons4.estimate > 100);
});

test("missing player data widens uncertainty; no fake zero projections for named markets", () => {
  const game = withV2(baseGame({ week: 1 }));
  const proj = projectCfbPlayerV1(game, {
    feeds: { identityAsOf: "2024-08-30T12:00:00.000Z" },
  });
  // Uncertain roles still produce distributional projections (not fabricated player ids required)
  assert.ok(proj.players.home.QB1.passing_yards.sigma > 40);
  assert.notEqual(proj.players.home.QB1.passing_yards.projection, null);
  assert.ok(["HIGH", "MEDIUM", "LOW"].includes(proj.players.home.QB1.passing_yards.uncertainty_state));
});

test("flattenGamesPlayersResponse expands nested CFBD /games/players", () => {
  const nested = [
    {
      id: 401,
      week: 2,
      teams: [
        {
          team: "Auburn",
          categories: [
            {
              name: "passing",
              types: [
                { name: "C/ATT", athletes: [{ id: "1", name: "Payton Thorne", stat: "14/27" }] },
                { name: "YDS", athletes: [{ id: "1", name: "Payton Thorne", stat: "165" }] },
              ],
            },
          ],
        },
      ],
    },
  ];
  const gamesById = new Map([["401", "2024-09-07T19:00:00.000Z"]]);
  const flat = flattenGamesPlayersResponse(nested, { gamesById, season: 2024 });
  assert.equal(flat.length, 1);
  assert.equal(flat[0].team, "Auburn");
  assert.equal(flat[0].name, "Payton Thorne");
  assert.equal(flat[0].passingAttempts, 27);
  assert.equal(flat[0].passingCompletions, 14);
  assert.equal(flat[0].passingYards, 165);
  assert.equal(flat[0].startDate, "2024-09-07T19:00:00.000Z");
  assert.equal(flat[0].position, "QB");
});

test("QB1 role scoring is team-scoped to prior player-game rows", () => {
  const kick = "2024-09-14T19:00:00.000Z";
  const rows = [
    {
      team: "Auburn",
      name: "Payton Thorne",
      athleteId: "a1",
      position: "QB",
      passingAttempts: 30,
      passingYards: 250,
      startDate: "2024-09-07T19:00:00.000Z",
      gameId: "g-aub",
    },
    {
      team: "Alabama",
      name: "Jalen Milroe",
      athleteId: "a2",
      position: "QB",
      passingAttempts: 40,
      passingYards: 400,
      startDate: "2024-09-07T23:00:00.000Z",
      gameId: "g-ala",
    },
  ];
  const qb = identifyQb1({
    team: "Auburn",
    playerGameRows: rows,
    kickoffTimestamp: kick,
    week: 3,
    identityAsOf: "2024-09-14T18:59:00.000Z",
  });
  assert.equal(qb.player_name, "Payton Thorne");
  assert.notEqual(qb.player_name, "Jalen Milroe");
});
