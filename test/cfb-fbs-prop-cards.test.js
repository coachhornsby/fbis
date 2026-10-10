import test from "node:test";
import assert from "node:assert/strict";
import { annotateCfbFbsMatchups } from "../functions/lib/cfbFbsPlayerScope.js";
import { identifyWr1, identifyWr2, PLAYER_ROLES } from "../functions/lib/cfbPlayerIdentity.js";
import { attachCfbPlayerV1 } from "../functions/lib/cfbPlayerModel.js";
import { toBoardGame } from "../functions/lib/todayBoard.js";
import { buildPlayerPropsBoard } from "../src/features/playerProps/buildPlayerPropsBoard.js";

const cutoff = "2026-10-17T19:00:00Z";
const asOf = "2026-10-16T14:00:00Z";
const teams = [
  { team_id: "cfb:espn:333", school_name: "Alabama", subdivision: "FBS" },
  { team_id: "cfb:espn:888", school_name: "Georgia", subdivision: "FBS" },
  { team_id: "cfb:espn:777", school_name: "FCS College", subdivision: "FCS" },
];
const game = () => ({
  id: "fbs-game", sport: "cfb", start: cutoff, season: 2026, week: 7,
  away: { espnId: "333", name: "Alabama", abbr: "ALA" },
  home: { espnId: "888", name: "Georgia", abbr: "UGA" },
  cfbFbisV2: { ok: true, modelId: "CFB-FBIS-v2", home: 30, away: 24, margin: 6, total: 54 },
  model: { projectionKind: "FBIS", projHome: 30, projAway: 24, projMargin: 6, projTotal: 54 },
  projectionKind: "FBIS", featureCutoffOk: true,
});

function role(role, id, team) {
  return { role, player_id: id, player_name: `${team} ${role} Player`, team,
    role_confidence: 0.86, state: "PRIMARY", identity_as_of: asOf,
    selection: { method: "prior-games", sample_size: 4 } };
}
function fixtures() {
  const roles = { roles: {}, kickoff_timestamp: cutoff };
  const playerHistory = {};
  for (const [side, team] of [["away", "Alabama"], ["home", "Georgia"]]) {
    roles.roles[side] = {};
    playerHistory[side] = {};
    for (const r of PLAYER_ROLES) {
      const id = `${side}-${r}`;
      roles.roles[side][r] = role(r, id, team);
      playerHistory[side][r] = {
        playerId: id, sample_size: 4, sourceAsOf: asOf,
        passAttempts: 30, compPct: .65, ypa: 8.1, rushAttempts: 5,
        rushYpc: 4, carries: 13, ypc: 4.5,
        targets: r === "WR2" ? 5 : 8, targetShare: r === "WR2" ? .14 : .23,
        catchRate: .64, ypt: 8.3,
      };
    }
  }
  return { roles, playerHistory };
}

test("FBS eligibility requires verified ESPN IDs; FCS games fail closed", () => {
  const a = annotateCfbFbsMatchups([game()], teams)[0];
  assert.equal(a.cfbFbsMatchup, true);
  assert.equal(a.cfbFbsScope, "FBS_V_FBS");
  const b = annotateCfbFbsMatchups([{ ...game(), home: { espnId: "777", name: "FCS College" } }], teams)[0];
  assert.equal(b.cfbFbsMatchup, false);
  assert.equal(annotateCfbFbsMatchups([game()], [])[0].cfbFbsMatchup, false);
});

test("WR2 is distinct from WR1 and excludes future performance", () => {
  const rows = [];
  for (const [name, id, targets] of [["Target Leader", "wr-a", 11], ["Second Wideout", "wr-b", 6]]) {
    for (const date of ["2026-10-03T19:00:00Z", "2026-10-10T19:00:00Z"]) {
      rows.push({ name, athleteId: id, team: "Alabama", position: "WR",
        targets, receivingYards: targets * 10, receptions: targets - 2, startDate: date });
    }
  }
  rows.push({ name: "Future Star", athleteId: "future", team: "Alabama", position: "WR",
    targets: 30, receivingYards: 500, receptions: 23, startDate: "2026-10-24T19:00:00Z" });
  const args = { team: "Alabama", playerGameRows: rows, kickoffTimestamp: cutoff, identityAsOf: asOf };
  const wr1 = identifyWr1({ ...args, rosterRows: [], playerPpaRows: [], usageRows: [] });
  const wr2 = identifyWr2({ ...args, exclude: wr1 });
  assert.equal(wr1.player_name, "Target Leader");
  assert.equal(wr2.player_name, "Second Wideout");
  assert.notEqual(wr1.player_id, wr2.player_id);
  assert.equal(wr2.role, "WR2");
  assert.equal(wr2.selection.method, "second-receiver-prior-game-usage");
});

test("eight FBS role cards do not manufacture names or projection data", () => {
  const eligible = annotateCfbFbsMatchups([game()], teams)[0];
  const g = attachCfbPlayerV1([eligible], { fbsOnly: true }).games[0];
  assert.equal(g.cfbPlayerRoleCards.length, 8);
  assert.equal(g.playerProjectionRows.length, 0);
  assert.ok(g.cfbPlayerRoleCards.every((r) => r.state === "IDENTITY_OR_PIT_USAGE_UNAVAILABLE"
    && r.canAuthorizeWager === false && r.markets.length === 0));
  const board = toBoardGame(g, "cfb");
  assert.equal(board.cfbFbsMatchup, true);
  assert.equal(board.cfbPlayerRoleCards.length, 8);
  assert.equal(board.playerProjectionRows.length, 0);
});

test("PIT matched identity and usage enable all four role projection cards per team, research only", () => {
  const scoped = annotateCfbFbsMatchups([game()], teams)[0];
  const { roles, playerHistory } = fixtures();
  const g = attachCfbPlayerV1([scoped], { fbsOnly: true, roles, playerHistory }).games[0];
  assert.equal(g.cfbPlayerRoleCards.length, 8);
  assert.ok(g.cfbPlayerRoleCards.every((r) => r.state === "RESEARCH" && r.markets.length > 0));
  assert.ok(g.playerProjectionRows.some((r) => r.targetRole === "WR2" && r.market === "receiving_yards"));
  assert.ok(g.playerProjectionRows.some((r) => r.targetRole === "QB1" && r.market === "passing_attempts"));
  assert.ok(g.playerProjectionRows.every((r) => r.fbsMatchup && r.canAuthorizeWager === false));
  const board = toBoardGame(g, "cfb");
  const propBoard = buildPlayerPropsBoard({ date: "2026-10-17", games: [board] }, { sportFilter: "cfb" });
  assert.ok(propBoard.rows.some((r) => r.targetRole === "WR2" && r.line == null));
  assert.ok(propBoard.rows.every((r) => r.modelAuthorized !== true && r.recommendationEligible !== true));
});

test("wrong player history, missing history and future-as-of evidence fail closed", () => {
  const scoped = annotateCfbFbsMatchups([game()], teams)[0];
  const data = fixtures();
  data.playerHistory.away.WR2.playerId = "other-person";
  data.playerHistory.home.WR1.sourceAsOf = "2026-10-19T00:00:00Z";
  delete data.playerHistory.away.RB1;
  const g = attachCfbPlayerV1([scoped], { fbsOnly: true, ...data }).games[0];
  assert.equal(g.cfbPlayerRoleCards.find((r) => r.side === "away" && r.role === "WR2").state,
    "IDENTITY_OR_PIT_USAGE_UNAVAILABLE");
  assert.equal(g.cfbPlayerRoleCards.find((r) => r.side === "home" && r.role === "WR1").state,
    "IDENTITY_OR_PIT_USAGE_UNAVAILABLE");
  assert.equal(g.cfbPlayerRoleCards.find((r) => r.side === "away" && r.role === "RB1").state,
    "IDENTITY_OR_PIT_USAGE_UNAVAILABLE");
  assert.equal(attachCfbPlayerV1([{
    ...scoped, cfbFbsMatchup: false,
  }], { fbsOnly: true, ...fixtures() }).games[0].playerProjectionRows.length, 0);
});
