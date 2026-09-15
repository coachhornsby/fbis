import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeActionPropMarket,
  toBoardPlayerMarket,
  attachActionPlayerPropsToGames,
  playerMarketsFromActionPropList,
} from "../functions/lib/boardActionProps.js";
import { attachActionIntelToGames } from "../functions/lib/boardActionIntel.js";
import { normalizeBoardGame } from "../src/features/playerProps/buildPlayerPropsBoard.js";

test("ACTION MLB market aliases include batter_* labels", () => {
  assert.equal(canonicalizeActionPropMarket("batter_hits"), "hits");
  assert.equal(canonicalizeActionPropMarket("player_hits"), "hits");
  assert.equal(canonicalizeActionPropMarket("batter_home_runs"), "home_runs");
  assert.equal(canonicalizeActionPropMarket("rushing_yards"), "rushing_yards");
});

test("toBoardPlayerMarket accepts player field and stays research-only", () => {
  const m = toBoardPlayerMarket({
    player: "Aaron Judge",
    market: "batter_hits",
    line: 1.5,
    overOdds: -115,
    underOdds: -105,
    book: "draftkings",
  });
  assert.equal(m.playerName, "Aaron Judge");
  assert.equal(m.marketCanonical, "hits");
  assert.equal(m.canQualify, false);
  assert.equal(m.decisionEligible, false);
  assert.equal(m.canAuthorizeWager, false);
  assert.ok(m.reasonCodes.includes("SHADOW_ONLY"));
});

test("attachActionPlayerPropsToGames prefers ACTION shadow props over Parlay", async () => {
  const props = [
    {
      playerName: "Aaron Judge",
      market: "hits",
      line: 1.5,
      overOdds: -115,
      underOdds: -105,
      book: "draftkings",
    },
  ];
  const db = {
    prepare(sql) {
      const s = String(sql);
      return {
        bind() {
          return this;
        },
        async all() {
          if (s.includes("action_market_book_observations")) return { results: [] };
          if (s.includes("shadow_market_observations")) {
            return {
              results: [
                {
                  fbis_event_id: "mlb_1",
                  research_fields_json: JSON.stringify({ playerProps: props }),
                  collected_at: "2026-09-15T12:00:00.000Z",
                  match_confidence: "EXACT",
                },
              ],
            };
          }
          return { results: [] };
        },
      };
    },
  };
  const games = [
    {
      id: "mlb_1",
      sport: "mlb",
      playerMarkets: [{ playerName: "Parlay Guy", marketCanonical: "hits", line: 1.5 }],
    },
  ];
  const out = await attachActionPlayerPropsToGames(games, db);
  assert.equal(out.attached, 1);
  assert.equal(out.source, "action");
  assert.equal(out.fromShadow, 1);
  assert.equal(out.games[0].playerMarkets[0].playerName, "Aaron Judge");
  assert.equal(out.games[0].playerMarkets[0].canQualify, false);
  assert.equal(out.games[0].playerPropsSource, "action-shadow-research");
});

test("attachActionIntelToGames wires ACTION playerMarkets onto board games", async () => {
  const props = [
    {
      playerName: "Shohei Ohtani",
      market: "pitcher_strikeouts",
      line: 6.5,
      overOdds: -120,
      underOdds: -110,
      book: "fanduel",
    },
  ];
  const db = {
    prepare(sql) {
      const s = String(sql);
      return {
        bind() {
          return this;
        },
        async all() {
          if (s.includes("action_market_book_observations")) return { results: [] };
          if (s.includes("shadow_market_observations") && s.includes("fbis_event_id IN")) {
            // Intel join + props shadow read share this table.
            if (s.includes("research_fields_json") && !s.includes("consensus_json")) {
              return {
                results: [
                  {
                    fbis_event_id: "mlb_2",
                    research_fields_json: JSON.stringify({ playerProps: props }),
                    collected_at: "2026-09-15T12:00:00.000Z",
                    match_confidence: "EXACT",
                  },
                ],
              };
            }
            return {
              results: [
                {
                  fbis_event_id: "mlb_2",
                  sport: "mlb",
                  match_confidence: "EXACT",
                  collected_at: "2026-09-15T12:00:00.000Z",
                  consensus_json: JSON.stringify({ spreadHome: -1.5, total: 8.5 }),
                  public_betting_json: JSON.stringify({
                    spreadHome: { ticketsPercent: 42, moneyPercent: 58 },
                  }),
                  best_odds_json: null,
                  line_movement_json: null,
                  research_fields_json: JSON.stringify({ playerProps: props }),
                  decision_eligible: 0,
                  can_qualify: 0,
                  can_authorize_wager: 0,
                },
              ],
            };
          }
          return { results: [] };
        },
      };
    },
  };
  const out = await attachActionIntelToGames(
    [{ id: "mlb_2", sport: "mlb", away: { abbr: "LAD" }, home: { abbr: "SD" } }],
    db
  );
  assert.equal(out.attached, 1);
  assert.equal(out.playerPropsAttached, 1);
  assert.equal(out.games[0].playerMarkets[0].playerName, "Shohei Ohtani");
  assert.equal(out.games[0].playerMarkets[0].marketCanonical, "strikeouts");
  assert.equal(out.games[0].playerMarkets[0].canQualify, false);
  assert.equal(out.games[0].actionIntel.canQualify, false);
});

test("normalizeBoardGame does not promote Parlay convictions after ACTION check", () => {
  const game = normalizeBoardGame({
    id: "mlb_3",
    playerPropsChecked: true,
    propConvictions: [
      {
        playerName: "Parlay Only",
        market: "hits",
        line: 1.5,
        price: -110,
        book: "parlayplay",
      },
    ],
  });
  assert.equal(game.playerMarkets, undefined);
});

test("playerMarketsFromActionPropList maps list rows", () => {
  const markets = playerMarketsFromActionPropList([
    {
      playerName: "Patrick Mahomes",
      market: "passing_yards",
      line: 275.5,
      overOdds: -110,
      underOdds: -110,
      book: "pinnacle",
    },
  ]);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].marketCanonical, "passing_yards");
  assert.equal(markets[0].decisionEligible, false);
});
