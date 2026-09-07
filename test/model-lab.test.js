import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateModelRows, pairedModelComparison, modelLeaderboard } from "../functions/lib/modelLab.js";

function row({ game, model, ph, pa, ah, aa, sport = "cbb", market = 0 }) {
  return {
    sport,
    game_id: game,
    model_id: model,
    proj_home: ph,
    proj_away: pa,
    proj_margin: ph - pa,
    proj_total: ph + pa,
    actual_home: ah,
    actual_away: aa,
    market_informed: market,
  };
}

describe("FBIS model laboratory", () => {
  it("evaluates score, margin and total errors from frozen predictions", () => {
    const rows = [
      row({ game: "1", model: "A", ph: 80, pa: 70, ah: 78, aa: 72 }),
      row({ game: "2", model: "A", ph: 74, pa: 70, ah: 75, aa: 69 }),
    ];
    const out = evaluateModelRows(rows, { sport: "cbb" });
    assert.equal(out.n, 2);
    assert.equal(out.total.mae, 0);
    assert.equal(out.margin.mae, 3);
    assert.equal(out.team.home.mae, 1.5);
    assert.equal(out.team.away.mae, 1.5);
  });

  it("compares champion and challenger only on identical graded games", () => {
    const champion = [
      row({ game: "1", model: "champ", ph: 80, pa: 70, ah: 78, aa: 72 }),
      row({ game: "2", model: "champ", ph: 74, pa: 70, ah: 75, aa: 69 }),
    ];
    const challenger = [
      row({ game: "1", model: "chall", ph: 79, pa: 71, ah: 78, aa: 72 }),
      row({ game: "3", model: "chall", ph: 90, pa: 60, ah: 65, aa: 64 }),
    ];
    const out = pairedModelComparison(champion, challenger, { sport: "cbb" });
    assert.equal(out.n, 1);
    assert.ok(out.delta.marginMae < 0);
    assert.equal(out.delta.totalMae, 0);
  });

  it("excludes market-informed models from the independent leaderboard by default", () => {
    const rows = [
      row({ game: "1", model: "independent", ph: 79, pa: 71, ah: 78, aa: 72 }),
      row({ game: "1", model: "market", ph: 78, pa: 72, ah: 78, aa: 72, market: 1 }),
    ];
    const defaultBoard = modelLeaderboard(rows, { sport: "cbb" });
    assert.deepEqual(defaultBoard.map((r) => r.modelId), ["independent"]);
    const withMarket = modelLeaderboard(rows, { sport: "cbb", includeMarketInformed: true });
    assert.deepEqual(withMarket.map((r) => r.modelId), ["market", "independent"]);
  });
});
