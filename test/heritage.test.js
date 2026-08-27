import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HERITAGE_FIXTURE_PASTE,
  parseHeritageSlip,
  parseHeritageTicket,
  validateRiskToWin,
  expectedToWin,
  normalizeHeritageMarket,
  americanPrice,
  pointLine,
  stripMarkdownLinks,
  decodeEntities,
  expectedProfit,
} from "../functions/lib/heritageSlip.js";
import {
  matchExecutedBet,
  attributeRecommendation,
  attachPinnacleClv,
  settleExecutedBet,
  immutableConflict,
  summarizeExecutedBets,
  decoratePreview,
  OPERATOR_ONLY,
} from "../functions/lib/executedBets.js";
import { selectClose, selectPinAtOrBefore, packPinOddsRows, isPostStart, CLV_UNAVAILABLE, clvTracker } from "../functions/lib/closeCapture.js";
import { parseBetsPreview } from "../functions/api/bets.js";

describe("Heritage five-ticket fixtures", () => {
  const parsed = parseHeritageSlip(HERITAGE_FIXTURE_PASTE, { yearHint: 2026 });

  it("parses five tickets: $10 risk, $9.98 to-win, 4 ML + 1 RL", () => {
    assert.equal(parsed.n, 5);
    assert.equal(parsed.totalRisk, 10);
    assert.equal(parsed.totalToWin, 9.98);
    assert.equal(parsed.ml, 4);
    assert.equal(parsed.spread, 1);
    assert.equal(parsed.total, 0);
    const ids = parsed.tickets.map((t) => t.externalTicketId);
    assert.deepEqual(ids, ["G10904318", "G10904312", "G10904306", "G10904299", "G10902289"]);
  });

  it("keeps ML execution_line null and price American", () => {
    const lad = parsed.tickets.find((t) => t.externalTicketId === "G10904318");
    assert.equal(lad.market, "ML");
    assert.equal(lad.period, "FULL_GAME");
    assert.equal(lad.executionLine, null);
    assert.equal(lad.executionPrice, 107);
    assert.equal(lad.selectedTeam, "Los Angeles Dodgers");
    assert.equal(lad.sourceEventId, "198257191");
    assert.equal(lad.heritageCurrentPrice, 107);
  });

  it("treats Brewers -1.5 as a run line, never American odds", () => {
    const mil = parsed.tickets.find((t) => t.externalTicketId === "G10904306");
    assert.equal(mil.market, "SPREAD");
    assert.equal(mil.executionLine, -1.5);
    assert.equal(mil.executionPrice, -107);
    assert.equal(americanPrice(-1.5), null);
    assert.equal(pointLine(-1.5), -1.5);
  });

  it("stores Rockies Heritage current +126 separately from Pin CLV", () => {
    const col = parsed.tickets.find((t) => t.externalTicketId === "G10902289");
    assert.equal(col.executionPrice, 109);
    assert.equal(col.heritageCurrentPrice, 126);
    const clv = attachPinnacleClv({ ...col, gameId: "x", selectedSide: "AWAY" }, [], "2026-08-27T18:00:00Z");
    assert.equal(clv.heritageCurrent.price, 126);
    assert.equal(clv.clv, null);
    assert.match(clv.heritageCurrent.note, /not Pinnacle CLV/i);
  });

  it("does not classify fixtures as CONVICTION / qualified / FBIS-HC-v1", () => {
    for (const t of parsed.tickets) {
      const attr = attributeRecommendation({ ...t, gameId: "none", executedAt: t.executedAt }, { snapshots: [], strategyTickets: [] });
      assert.equal(attr.conviction, false);
      assert.equal(attr.qualified, false);
      assert.equal(attr.recommended, false);
      assert.equal(attr.label, OPERATOR_ONLY);
    }
  });
});

describe("Heritage parser robustness", () => {
  it("validates risk vs to-win examples", () => {
    assert.equal(expectedToWin(2, 107), 2.14);
    assert.ok(validateRiskToWin(2, 1.94, -103).ok);
    assert.ok(validateRiskToWin(2, 1.87, -107).ok);
    assert.ok(validateRiskToWin(2, 1.85, -108).ok);
    assert.ok(validateRiskToWin(2, 2.18, 109).ok);
    assert.equal(validateRiskToWin(2, 9, -110).ok, false);
  });

  it("normalizes Game Winner / Run Line / F5", () => {
    assert.equal(normalizeHeritageMarket("Game / Game Winner").market, "ML");
    assert.equal(normalizeHeritageMarket("Game / Run Line").market, "SPREAD");
    assert.equal(normalizeHeritageMarket("Game / Total").market, "TOTAL");
    assert.equal(normalizeHeritageMarket("First 5 / Game Winner").period, "F5");
    assert.equal(normalizeHeritageMarket("prop / player").unsupported, true);
  });

  it("handles blanks, markdown, HTML entities, and extra spacing", () => {
    const text = `
G10904318 | Aug 27 10:06

Los Angeles Dodgers (Y Yamamoto R) vs Atlanta Braves (C Sale L)
Game / Game Winner / Los Angeles Dodgers (Y Yamamoto R)
Risk: $2.00@ +107
To win: $2.14
Current Line: Los Angeles Dodgers +107

[Los Angeles Dodgers](https://example.com/event/198257191)

G10909999 | Aug 27 11:00
St.&nbsp;Louis Cardinals vs Chicago Cubs
Game / Game Winner / St. Louis Cardinals
Risk: $2.00 @ -110
To win: $1.82
`;
    const parsed = parseHeritageSlip(text, { yearHint: 2026 });
    assert.equal(parsed.n, 2);
    assert.ok(parsed.tickets[0].sourceEventId === "198257191" || parsed.tickets[0].rawText.includes("198257191"));
    assert.ok(decodeEntities("St.&nbsp;Louis").includes("St."));
    assert.ok(stripMarkdownLinks("[x](https://a/event/1)").includes("https://a/event/1"));
  });

  it("flags duplicate ticket IDs in one paste", () => {
    const dup = `${HERITAGE_FIXTURE_PASTE}\n\n${parseHeritageSlip(HERITAGE_FIXTURE_PASTE).tickets[0].rawText}`;
    const parsed = parseHeritageSlip(dup, { yearHint: 2026 });
    assert.ok(parsed.tickets.some((t) => t.duplicateInPaste));
  });
});

describe("Heritage matching, attribution, CLV, settlement", () => {
  const lad = parseHeritageTicket(HERITAGE_FIXTURE_PASTE.split(/G10904312/)[0], { yearHint: 2026 });

  it("requires both teams; mascot/one-team is unmatched", () => {
    const games = [
      { id: "1", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Atlanta Braves", abbr: "ATL" }, away: { name: "Los Angeles Dodgers", abbr: "LAD" } },
    ];
    const hit = matchExecutedBet(lad, games);
    assert.equal(hit.status, "matched");
    const one = matchExecutedBet(lad, [
      { id: "2", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Atlanta Braves", abbr: "ATL" }, away: { name: "Miami Marlins", abbr: "MIA" } },
    ]);
    assert.equal(one.status, "unmatched");
  });

  it("marks ambiguous when two games both fit", () => {
    const games = [
      { id: "a", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Atlanta Braves", abbr: "ATL" }, away: { name: "Los Angeles Dodgers", abbr: "LAD" } },
      { id: "b", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Los Angeles Dodgers", abbr: "LAD" }, away: { name: "Atlanta Braves", abbr: "ATL" } },
    ];
    assert.equal(matchExecutedBet(lad, games).status, "ambiguous");
  });

  it("attributes only a freeze at or before execution", () => {
    const ticket = { ...lad, gameId: "g1", selectedSide: "AWAY", executedAt: "2026-08-27T15:06:00Z" };
    const late = attributeRecommendation(ticket, {
      snapshots: [{ gameId: "g1", frozenAt: "2026-08-27T16:00:00Z", projHome: 4, checkpoint: "CLOSE" }],
      strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "AWAY", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-08-27T16:01:00Z" }],
    });
    assert.equal(late.recommended, false);
    assert.equal(late.label, OPERATOR_ONLY);
    const early = attributeRecommendation(ticket, {
      snapshots: [{ gameId: "g1", frozenAt: "2026-08-27T14:00:00Z", projHome: 4, checkpoint: "MORNING", modelVersion: "FBIS-v1.3" }],
      strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "AWAY", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-08-27T14:01:00Z" }],
    });
    assert.equal(early.conviction, true);
    assert.equal(early.recommended, true);
    const noSide = attributeRecommendation({ ...ticket, selectedSide: null }, {
      snapshots: [{ gameId: "g1", frozenAt: "2026-08-27T14:00:00Z", projHome: 4, checkpoint: "MORNING" }],
      strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "HOME", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-08-27T14:01:00Z" }],
    });
    assert.equal(noSide.recommended, false);
    assert.equal(noSide.label, OPERATOR_ONLY);
  });

  it("never uses post-kickoff Pin as close or Heritage current as Pin close", () => {
    const start = "2026-08-27T18:00:00Z";
    const snaps = [
      { market: "ml", period: "fg", side: "AWAY", price: 105, noVig: 0.48, capturedAt: "2026-08-27T14:00:00Z", line: null },
      { market: "ml", period: "fg", side: "AWAY", price: 120, noVig: 0.45, capturedAt: "2026-08-27T19:00:00Z", line: null, rejectedPostStart: true },
    ];
    const close = selectClose(snaps, { start, market: "ML", period: "fg", side: "AWAY" });
    assert.equal(close.close.capturedAt, "2026-08-27T14:00:00Z");
    assert.equal(isPostStart("2026-08-27T19:00:00Z", start), true);
    const packed = packPinOddsRows({
      id: "g",
      start,
      odds: { pinHomeMl: -115, pinAwayMl: 105 },
    }, { capturedAt: "2026-08-27T19:00:00Z" });
    assert.equal(packed.rejectedPostStart, true);
    assert.ok(packed.rows.every((r) => r.rejectedPostStart === 1));
  });

  it("uses Heritage risk/to-win for settlement, F5 scores for F5", () => {
    const ml = { market: "ML", selectedSide: "HOME", riskAmount: 2, toWinAmount: 2.14, potentialPayout: 4.14, period: "FULL_GAME" };
    const won = settleExecutedBet(ml, { status: { completed: true }, home: { score: 5 }, away: { score: 3 }, actualHome: 5, actualAway: 3 });
    assert.equal(won.result, "WON");
    assert.equal(won.profit, 2.14);
    const lost = settleExecutedBet(ml, { status: { completed: true }, actualHome: 1, actualAway: 4, home: { score: 1 }, away: { score: 4 } });
    assert.equal(lost.result, "LOST");
    assert.equal(lost.profit, -2);
    const push = settleExecutedBet(ml, { status: { completed: true }, actualHome: 2, actualAway: 2, home: { score: 2 }, away: { score: 2 } });
    assert.equal(push.result, "PUSH");
    assert.equal(push.profit, 0);
    const f5 = settleExecutedBet(
      { market: "F5 ML", period: "F5", selectedSide: "HOME", riskAmount: 2, toWinAmount: 1.8, potentialPayout: 3.8 },
      { f5Score: { home: 3, away: 1, complete: true } }
    );
    assert.equal(f5.result, "WON");
    assert.equal(expectedProfit("VOID", 2, 2), 0);
  });

  it("conflicts when the same ticket ID has different immutable fields", () => {
    assert.equal(
      immutableConflict(
        { selectedSide: "HOME", executionPrice: 107, riskAmount: 2, executedAt: "a" },
        { selectedSide: "AWAY", executionPrice: 107, riskAmount: 2, executedAt: "a" }
      ),
      true
    );
    assert.equal(
      immutableConflict(
        { selectedSide: "HOME", executionPrice: 107, riskAmount: 2, executedAt: "a" },
        { selectedSide: "HOME", executionPrice: 107, riskAmount: 2, executedAt: "a" }
      ),
      false
    );
  });

  it("summaries are null at N=0 rather than zero-filled win rate", () => {
    const empty = summarizeExecutedBets([]);
    assert.equal(empty.bets, 0);
    assert.equal(empty.record, null);
    assert.equal(empty.profit, null);
    assert.equal(empty.roi, null);
    assert.equal(empty.avgClv, null);
    assert.match(empty.message, /No imported Heritage bets/);
  });

  it("parse preview does not write", async () => {
    const preview = await parseBetsPreview({}, HERITAGE_FIXTURE_PASTE, 2026);
    assert.equal(preview.wrote, false);
    assert.equal(preview.n, 5);
    assert.equal(preview.totalRisk, 10);
    assert.equal(preview.totalToWin, 9.98);
    assert.equal(preview.ml, 4);
    assert.equal(preview.spread, 1);
    const decorated = await decoratePreview(preview.tickets[0], { games: [], existing: [], snapshots: [] });
    assert.equal(decorated.matchStatus, "unmatched");
    assert.ok(!decorated.attribution?.qualified);
  });

  it("CLV tracker reports unavailable at N=0", () => {
    const t = clvTracker([]);
    assert.equal(t.unavailable, true);
    assert.equal(t.message, CLV_UNAVAILABLE);
    assert.equal(selectPinAtOrBefore([], { at: "2026-08-27T15:00:00Z", start: "2026-08-27T18:00:00Z", market: "ML", side: "HOME" }), null);
  });
});
