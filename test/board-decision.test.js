import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boardDecision,
  boardDecisionCounts,
  filterBoardGames,
  formatBoardDate,
  fbisProjection,
  glowClassForTier,
  marketDeltas,
  marketLines,
  sortBoardGames,
} from "../src/lib/boardDecision.js";
import { boardQaFixtureGames } from "../src/lib/boardFixtures.js";

function game(partial) {
  return {
    id: partial.id || "g1",
    start: partial.start || "2026-09-12T00:00:00.000Z",
    away: { abbr: "AWAY", name: "Away" },
    home: { abbr: "HOME", name: "Home" },
    model: partial.model || { projAway: 20, projHome: 24 },
    odds: partial.odds || { spread: -3.5, total: 46.5, pinPresent: true, pinSpread: -3.5, pinTotal: 46.5 },
    ...partial,
  };
}

describe("board decision sorting", () => {
  it("sorts conviction above qualified above lean above pass above blocked", () => {
    const games = [
      game({ id: "pass", start: "2026-09-12T18:00:00.000Z" }),
      game({ id: "lean", lean: { pick: "HOME", market: "ML" }, start: "2026-09-12T17:00:00.000Z" }),
      game({ id: "qual", rec: { tag: "STANDARD", pick: "HOME", market: "ML" }, start: "2026-09-12T19:00:00.000Z" }),
      game({ id: "conv", rec: { tag: "CONVICTION", pick: "AWAY", market: "ML" }, start: "2026-09-12T20:00:00.000Z" }),
      game({
        id: "block",
        qualificationBlocked: true,
        cfb: { bettingAllowed: false, blockReason: "missing" },
        start: "2026-09-12T16:00:00.000Z",
      }),
    ];
    const sorted = sortBoardGames(games).map((g) => g.id);
    assert.deepEqual(sorted, ["conv", "qual", "lean", "pass", "block"]);
  });

  it("maps STRONG/STANDARD qualified tags to QUALIFIED display tier", () => {
    assert.equal(boardDecision(game({ rec: { tag: "STRONG" } })).tier, "QUALIFIED");
    assert.equal(boardDecision(game({ rec: { tag: "STANDARD" } })).tier, "QUALIFIED");
    assert.equal(boardDecision(game({ rec: { tag: "CONVICTION" } })).tier, "CONVICTION");
  });

  it("blocked qualification outranks lean for board hierarchy", () => {
    const g = game({
      lean: { pick: "HOME", market: "ML" },
      cfb: { bettingAllowed: false, blockReason: "missing evidence" },
      qualificationBlocked: true,
    });
    assert.equal(boardDecision(g).tier, "BLOCKED");
  });

  it("sorts chronologically within the same decision tier", () => {
    const games = [
      game({ id: "late", rec: { tag: "STANDARD" }, start: "2026-09-12T23:00:00.000Z" }),
      game({ id: "early", rec: { tag: "STRONG" }, start: "2026-09-12T17:00:00.000Z" }),
      game({ id: "mid", rec: { tag: "STANDARD" }, start: "2026-09-12T20:00:00.000Z" }),
    ];
    assert.deepEqual(
      sortBoardGames(games).map((g) => g.id),
      ["early", "mid", "late"]
    );
  });
});

describe("board decision glow classes", () => {
  it("PASS gets no glow class; CONVICTION gets conviction class", () => {
    assert.equal(glowClassForTier("PASS"), "gc-glow-pass");
    assert.equal(glowClassForTier("CONVICTION"), "gc-glow-conviction");
    assert.equal(glowClassForTier("QUALIFIED"), "gc-glow-qualified");
    assert.equal(glowClassForTier("LEAN"), "gc-glow-lean");
    assert.equal(glowClassForTier("BLOCKED"), "gc-glow-blocked");
  });
});

describe("board date and projection display helpers", () => {
  it("formats prominent CT date/time", () => {
    const out = formatBoardDate("2026-09-12T00:00:00.000Z");
    assert.match(out.dateLine, /SEP/);
    assert.match(out.timeLine, /CT$/);
    assert.equal(typeof out.isToday, "boolean");
  });

  it("computes fair lines and deltas only from valid numbers", () => {
    const g = game({
      model: { projAway: 32.3, projHome: 27.8 },
      odds: { pinSpread: 5.5, pinTotal: 50.5, pinPresent: true },
    });
    const proj = fbisProjection(g);
    assert.equal(proj.available, true);
    assert.equal(Number(proj.fairHomeSpread.toFixed(1)), 4.5);
    assert.equal(Number(proj.fairTotal.toFixed(1)), 60.1);
    const d = marketDeltas(g);
    assert.equal(Number(d.spreadDelta.toFixed(1)), -1.0);
    assert.equal(Number(d.totalDelta.toFixed(1)), 9.6);
  });

  it("missing market or projection does not fabricate deltas", () => {
    const noMkt = marketDeltas(game({ odds: {} }));
    assert.equal(noMkt.spreadDelta, null);
    assert.equal(noMkt.totalDelta, null);
    const blocked = fbisProjection(
      game({ cfb: { projectionState: "LEAGUE_AVERAGE_ONLY" }, model: { projAway: 1, projHome: 2 } })
    );
    assert.equal(blocked.available, false);
  });

  it("counts and filters use actual tiers", () => {
    const games = [
      game({ id: "c", rec: { tag: "CONVICTION" } }),
      game({ id: "q", rec: { tag: "STANDARD" } }),
      game({ id: "l", lean: { pick: "X" } }),
      game({ id: "p" }),
      game({ id: "b", qualificationBlocked: true }),
    ];
    const counts = boardDecisionCounts(games);
    assert.equal(counts.CONVICTION, 1);
    assert.equal(counts.QUALIFIED, 1);
    assert.equal(counts.LEAN, 1);
    assert.equal(counts.PASS, 1);
    assert.equal(counts.BLOCKED, 1);
    assert.equal(filterBoardGames(games, "QUALIFIED").length, 1);
  });

  it("labels soft books when Pinnacle is absent", () => {
    const soft = marketLines(
      game({
        odds: {
          pinPresent: false,
          softSource: "sharpapi",
          spread: -3.5,
          total: 46.5,
          homeMl: -150,
          awayMl: 130,
        },
      })
    );
    assert.equal(soft.book, "DK/FD");
    assert.equal(soft.spread, -3.5);
  });

  it("QA fixtures exercise glow classes for every tier", () => {
    const byTier = Object.fromEntries(
      boardQaFixtureGames().map((g) => [boardDecision(g).tier, glowClassForTier(boardDecision(g).tier)])
    );
    assert.equal(byTier.CONVICTION, "gc-glow-conviction");
    assert.equal(byTier.QUALIFIED, "gc-glow-qualified");
    assert.equal(byTier.LEAN, "gc-glow-lean");
    assert.equal(byTier.PASS, "gc-glow-pass");
    assert.equal(byTier.BLOCKED, "gc-glow-blocked");
  });
});
