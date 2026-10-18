import test from "node:test";
import assert from "node:assert/strict";
import { hydrateTennisBoardMarkets } from "../functions/lib/tennisBoardMarkets.js";
import { tennisProjectionDisplay } from "../src/lib/tennisCardPresentation.js";

const now = Date.parse("2026-10-18T10:05:00Z");
const evidence = {
  status: "RESEARCH_REFERENCE_ONLY",
  latestCapturedAt: "2026-10-18T06:08:08.891Z",
  offers: [
    { source: "PinnOdds", marketFamily: "moneyline", period: "full_game", side: "home", decimalOdds: 1.99, capturedAt: "2026-10-18T06:08:08.891Z" },
    { source: "PinnOdds", marketFamily: "moneyline", period: "full_game", side: "away", decimalOdds: 1.9, capturedAt: "2026-10-18T06:08:08.891Z" },
    { source: "PinnOdds", marketFamily: "spread", period: "full_game", side: "home", line: -1.5, decimalOdds: 1.42, capturedAt: "2026-10-18T06:08:08.891Z" },
    { source: "PinnOdds", marketFamily: "spread", period: "full_game", side: "away", line: 1.5, decimalOdds: 3.04, capturedAt: "2026-10-18T06:08:08.891Z" },
  ],
};

test("tennis board hydration preserves research market and attaches PinnOdds moneyline/no-vig", () => {
  const game = hydrateTennisBoardMarkets({
    id: "wta_aad9dcde0e1aa966aca1d0bb",
    sport: "tennis",
    home: { name: "Maja Chwalinska" },
    away: { name: "Sonay Kartal" },
    market: { reference: { available: false, moneyline: { home: null, away: null }, noVig: null } },
    tennisProjection: {
      eventIntegrity: { valid: true },
      player1WinProb: 0.2013,
      player2WinProb: 0.7987,
      decisionTimestamp: "2026-10-18T01:02:53.548Z",
    },
  }, evidence);
  assert.equal(game.market.reference.available, true);
  assert.equal(game.market.reference.provider, "PinnOdds");
  assert.ok(game.market.reference.noVig.home > 0.4 && game.market.reference.noVig.home < 0.6);
  assert.ok(game.market.venueOffers.some((o) => o.source === "PinnOdds" && o.marketFamily === "moneyline"));
  assert.equal(game.pinnoddsResearch, undefined); // hydration does not invent evidence itself
});

test("tennis gap uses PinnOdds book prior when snapshot no-vig is missing", () => {
  const game = {
    home: { name: "Maja Chwalinska" },
    away: { name: "Sonay Kartal" },
    tennisProjection: {
      eventIntegrity: { valid: true },
      player1WinProb: 0.2013,
      player2WinProb: 0.7987,
      decisionTimestamp: "2026-10-18T01:02:53.548Z",
    },
    pinnoddsResearch: evidence,
    market: { reference: { noVig: null, observedAt: null }, venueOffers: evidence.offers },
  };
  const display = tennisProjectionDisplay(game, now);
  assert.equal(display.valid, true);
  assert.equal(display.comparable, true);
  assert.equal(display.marketSource, "PinnOdds");
  assert.ok(Number.isFinite(display.edgeAway) && display.edgeAway > 0);
});

test("snapshot no-vig still requires contemporaneous clocks", () => {
  const game = {
    home: { name: "Player One" },
    away: { name: "Player Two" },
    tennisProjection: {
      eventIntegrity: { valid: true },
      player1WinProb: 0.61,
      player2WinProb: 0.39,
      decisionTimestamp: "2026-10-13T12:00:00Z",
    },
    market: { reference: { observedAt: "2026-10-18T10:00:00Z", noVig: { home: 0.57, away: 0.43 } } },
  };
  assert.equal(tennisProjectionDisplay(game, now).edgeHome, null);
});
