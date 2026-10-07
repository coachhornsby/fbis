import test from "node:test";
import assert from "node:assert/strict";

import { buildTennisResearchSlate, toBoardGame } from "../functions/lib/todayBoard.js";

function fakeDb(rows) {
  const official = rows.map(row => {
    row.surface ||= "hard"; row.tournament ||= "Shanghai";
    const e={match_id:row.canonical_event_id,tour:row.tour,source:row.tour.toUpperCase()+"_OFFICIAL",match_time:row.event_start_time,completion_state:"SCHEDULED",surface:row.surface,tournament_name:row.tournament,observed_at:row.decision_timestamp,player1_id:"p1",player2_id:"p2",p1_id:"p1",p2_id:"p2",p1_name:row.player1,p2_name:row.player2,p1_tour:row.tour,p2_tour:row.tour,p1_country:"RUS",p2_country:"JPN",p1_rank:row.player1==="Roman Safiullin"?79:null,p2_rank:row.player2==="Shintaro Mochizuki"?123:null,p1_points:row.player1==="Roman Safiullin"?744:null,p2_points:row.player2==="Shintaro Mochizuki"?491:null,p1_headshot:row.player1==="Roman Safiullin"?"https://a.espncdn.com/roman.png":null,p2_headshot:row.player2==="Shintaro Mochizuki"?"https://a.espncdn.com/mochi.png":null};
    row.context_json=JSON.stringify({eventProof:{matchId:e.match_id,source:e.source,observedAt:e.observed_at,player1Id:"p1",player2Id:"p2",startTime:e.match_time,surface:e.surface,tournament:e.tournament_name}});
    return e;
  });
  return {prepare(sql){return {bind(){return {async all(){return {results:sql.includes("FROM tennis_official_matches")?official:sql.includes("WITH ranked AS")?rows:[]};}};}};}};
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
    decision_timestamp: "2099-10-05T15:00:00Z",
    event_start_time: "2099-10-06T04:00:00Z",
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
    spread_player1_line: -3.5,
    spread_player2_line: 3.5,
    spread_player1_price: -108,
    spread_player2_price: -112,
    spread_player1_no_vig: 0.495,
    spread_player2_no_vig: 0.505,
    spread_ticket_pct: 47,
    spread_money_pct: 58,
    spread_money_ticket_gap: 11,
    total_line: 22.5,
    over_price: -105,
    under_price: -115,
    over_no_vig_prob: 0.49,
    under_no_vig_prob: 0.51,
    total_ticket_pct: 62,
    total_money_pct: 54,
    total_money_ticket_gap: -8,
    market_observed_at: "2099-10-05T14:55:00Z",
    market_collected_at: "2099-10-05T14:56:00Z",
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

  const slate = await buildTennisResearchSlate("2099-10-05", {
    DB: fakeDb(rows),
    fetchImpl,
  });

  assert.equal(calls, 0);
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
  assert.equal(game.market.reference.spreadDetail.home, -3.5);
  assert.equal(game.market.reference.spreadDetail.awayPrice, -112);
  assert.equal(game.market.reference.totalDetail.line, 22.5);
  assert.equal(game.market.reference.totalDetail.overPrice, -105);
  assert.ok(game.actionIntel.publicSplits.markets.some(x => x.market === "SPREAD" && x.moneyTicketGap === 11));
  assert.ok(game.actionIntel.publicSplits.markets.some(x => x.market === "TOTAL" && x.moneyTicketGap === -8));
  assert.equal(game.tennisProjection.surface, "hard");
  assert.equal(game.tennisProjection.tournament, "Shanghai");
  assert.equal(game.actionIntel.publicSplits.ticketPct, 61);
  assert.equal(game.actionIntel.publicSplits.moneyPct, 72);

  const board = toBoardGame(game, "tennis");
  assert.equal(board.home.rank, 79);
  assert.equal(board.away.rank, 123);
  assert.equal(board.home.logo, "https://a.espncdn.com/roman.png");
  assert.equal(board.tennisProjection.marketPriorP1, 0.742);
  assert.equal(board.projTotal, null);
  assert.equal(board.projMargin, null);
  assert.equal(board.market.reference.available, true);
  assert.equal(board.home.countryCode,"RUS");
  assert.equal(board.home.headshotUrl,"https://a.espncdn.com/roman.png");
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
    decision_timestamp: "2099-10-05T15:00:00Z",
    event_start_time: "2099-10-06T03:00:00Z",
    snapshot_type: "DECISION",
  }];
  const slate = await buildTennisResearchSlate("2099-10-05", {
    DB: fakeDb(rows),
    fetchImpl: async () => { throw new Error("rankings down"); },
  });
  assert.equal(slate.games.length, 1);
  assert.equal(slate.games[0].home.fullName, "Player One");
  assert.equal(slate.games[0].home.rank, null);
  assert.equal(slate.games[0].home.logo, null);
});


test("tennis win probabilities never masquerade as projected total games", async () => {
  const rows = [{
    canonical_event_id: "tennis:action:prob-contract",
    tour: "wta", player1: "Player One", player2: "Player Two",
    pure_model_id: "TENNIS-FBIS-v2-CONTEXT", pure_p1: 0.461,
    market_prior_p1: 0.45, market_v2_p1: 0.46, model_edge: 0.011,
    decision_timestamp: "2099-10-05T15:00:00Z", event_start_time: "2099-10-06T03:00:00Z",
    snapshot_type: "DECISION", total_line: 20.5
  }];
  const slate = await buildTennisResearchSlate("2099-10-05", {
    DB: fakeDb(rows),
    fetchImpl: async () => ({ ok: true, async json() { return { rankings: [] }; } }),
  });
  const board = toBoardGame(slate.games[0], "tennis");
  assert.equal(board.model?.projTotal, undefined);
  assert.equal(board.projTotal, null);
  assert.equal(board.tennisProjection.projectedTotalGames, undefined);
  assert.equal(board.market.reference.total, 20.5);
});
