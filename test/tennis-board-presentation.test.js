import test from "node:test";
import assert from "node:assert/strict";

import { buildTennisResearchSlate, toBoardGame } from "../functions/lib/todayBoard.js";

function fakeDb(rows) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async all() {
              return { results: rows };
            },
          };
        },
      };
    },
  };
}

function rankingPayload(name, rank, points, id, headshot) {
  return {
    rankings: [{
      ranks: [{
        current: rank,
        points,
        athlete: { id, displayName: name, headshot },
      }],
    }],
  };
}

test("tennis TODAY cards carry full identity, rankings, headshots, market lines and ACTION splits", async () => {
  const rows = [{
    canonical_event_id: "tennis:action:114596",
    tour: "atp",
    player1: "Roman Safiullin",
    player2: "Shintaro Mochizuki",
    pure_model_id: "TENNIS-FBIS-v2-CONTEXT",
    pure_p1: 0.804,
    market_prior_p1: 0.74,
    market_v2_p1: 0.77,
    model_edge: 0.064,
    market_json: JSON.stringify({ source: "multibook-consensus", quotes: [] }),
    action_json: JSON.stringify({ trackedBetCount: 428 }),
    decision_timestamp: "2026-10-05T15:00:00Z",
    event_start_time: "2026-10-06T04:00:00Z",
    snapshot_type: "DECISION",
    market_provider: "ACTION_APIFY",
    sportsbook: "consensus",
    player1_price: -285,
    player2_price: 235,
    player1_no_vig_prob: 0.742,
    player2_no_vig_prob: 0.258,
    public_ticket_pct: 61,
    public_money_pct: 72,
    money_minus_ticket_pct: 11,
    market_observed_at: "2026-10-05T14:55:00Z",
    market_collected_at: "2026-10-05T14:56:00Z",
    tournament: "Shanghai",
    surface: "hard",
    indoor: 0,
    court_speed_index: 1.04,
  }];

  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const isWta = String(url).includes("/wta/");
    const payload = isWta
      ? rankingPayload("WTA Placeholder", 1, 10000, "w1", "https://a.espncdn.com/w1.png")
      : {
          rankings: [{
            ranks: [
              { current: 79, points: 744, athlete: { id: "r1", displayName: "Roman Safiullin", headshot: "https://a.espncdn.com/roman.png" } },
              { current: 123, points: 491, athlete: { id: "m1", displayName: "Shintaro Mochizuki", headshot: "https://a.espncdn.com/mochi.png" } },
            ],
          }],
        };
    return { ok: true, async json() { return payload; } };
  };

  const slate = await buildTennisResearchSlate("2026-10-05", {
    DB: fakeDb(rows),
    fetchImpl,
  });

  assert.equal(calls, 2);
  assert.equal(slate.games.length, 1);
  const game = slate.games[0];
  assert.equal(game.home.fullName, "Roman Safiullin");
  assert.equal(game.away.fullName, "Shintaro Mochizuki");
  assert.equal(game.home.rank, 79);
  assert.equal(game.home.rankingPoints, 744);
  assert.equal(game.home.logo, "https://a.espncdn.com/roman.png");
  assert.equal(game.away.rank, 123);
  assert.equal(game.away.rankingPoints, 491);
  assert.equal(game.market.reference.moneyline.home, -285);
  assert.equal(game.market.reference.moneyline.away, 235);
  assert.equal(game.market.reference.noVig.home, 0.742);
  assert.equal(game.tennisProjection.surface, "hard");
  assert.equal(game.tennisProjection.tournament, "Shanghai");
  assert.equal(game.actionIntel.publicSplits.ticketPct, 61);
  assert.equal(game.actionIntel.publicSplits.moneyPct, 72);

  const board = toBoardGame(game, "tennis");
  assert.equal(board.home.rank, 79);
  assert.equal(board.away.rank, 123);
  assert.equal(board.home.logo, "https://a.espncdn.com/roman.png");
  assert.equal(board.tennisProjection.marketPriorP1, 0.742);
  assert.equal(board.referenceMarketAvailable, true);
  assert.equal(board.marketUnavailable, true);
});

test("tennis ranking/headshot enrichment fails open", async () => {
  const rows = [{
    canonical_event_id: "tennis:action:2",
    tour: "wta",
    player1: "Player One",
    player2: "Player Two",
    pure_model_id: "TENNIS-FBIS-v2-CONTEXT",
    pure_p1: 0.6,
    market_prior_p1: null,
    market_v2_p1: null,
    model_edge: null,
    market_json: null,
    action_json: null,
    decision_timestamp: "2026-10-05T15:00:00Z",
    event_start_time: "2026-10-06T03:00:00Z",
    snapshot_type: "DECISION",
  }];
  const slate = await buildTennisResearchSlate("2026-10-05", {
    DB: fakeDb(rows),
    fetchImpl: async () => { throw new Error("rankings down"); },
  });
  assert.equal(slate.games.length, 1);
  assert.equal(slate.games[0].home.fullName, "Player One");
  assert.equal(slate.games[0].home.rank, null);
  assert.equal(slate.games[0].home.logo, null);
});
