import test from "node:test";
import assert from "node:assert/strict";
import {
  FBIS_PLAYER_MARKETS,
  buildPlayerPropsBoard,
  formatMarketLabel,
  withFbisPropAnalytics,
  rankPropConviction,
  sortPropsByConviction,
  groupPlayerPropRows,
  normalizeBoardGame,
} from "../src/features/playerProps/buildPlayerPropsBoard.js";

test("supported FBIS player markets cover QB/RB/WR model set", () => {
  for (const id of [
    "passing_yards",
    "passing_attempts",
    "completions",
    "rushing_yards",
    "rushing_attempts",
    "receptions",
    "receiving_yards",
  ]) {
    assert.ok(FBIS_PLAYER_MARKETS.includes(id), id);
  }
});

test("player props board never invents decision eligibility or model authority", () => {
  const board = buildPlayerPropsBoard({
    date: "2026-09-13",
    games: [
      {
        id: "cfb-1",
        sport: "cfb",
        away: { abbr: "OHIO" },
        home: { abbr: "TEX" },
        playerMarkets: [
          {
            playerName: "Test QB",
            team: "OHIO",
            position: "QB",
            marketCanonical: "passing_yards",
            line: 249.5,
            overOdds: -110,
            underOdds: -105,
            book: "draftkings",
            decisionEligible: true, // upstream claim must be stripped by domain
          },
        ],
      },
    ],
  });

  assert.equal(board.readiness.modelAuthorized, false);
  assert.equal(board.readiness.decisionEligible, false);
  assert.equal(board.readiness.classification, "RESEARCH_READY");
  assert.equal(board.counts.rows, 1);
  assert.equal(board.rows[0].decisionEligible, false);
  assert.equal(board.rows[0].modelAuthorized, false);
  assert.equal(board.rows[0].surfaceStatus, "RESEARCH");
  assert.equal(board.rows[0].supportedMarket, true);
  assert.equal(board.counts.decisionEligible, 0);
});

test("unsupported novelty markets are excluded by default but counted", () => {
  const board = buildPlayerPropsBoard({
    games: [
      {
        id: "nfl-1",
        sport: "nfl",
        away: { abbr: "KC" },
        home: { abbr: "BUF" },
        playerMarkets: [
          {
            playerName: "Star WR",
            marketCanonical: "receiving_yards",
            line: 72.5,
            overOdds: -115,
          },
          {
            playerName: "Star WR",
            marketCanonical: "anytime_td",
            line: 0.5,
            overOdds: 140,
          },
        ],
      },
    ],
  });

  assert.equal(board.counts.supportedRows, 1);
  assert.equal(board.counts.unsupportedRows, 1);
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].marketCanonical, "receiving_yards");
  assert.equal(board.counts.byMarket.receiving_yards, 1);

  const all = buildPlayerPropsBoard(
    {
      games: [
        {
          id: "nfl-1",
          sport: "nfl",
          playerMarkets: [
            { playerName: "A", marketCanonical: "receiving_yards", line: 1 },
            { playerName: "A", marketCanonical: "anytime_td", line: 0.5 },
          ],
        },
      ],
    },
    { supportedOnly: false },
  );
  assert.equal(all.rows.length, 2);
  assert.equal(all.rows.filter((r) => !r.supportedMarket).length, 1);
});

test("empty slate stays empty — no invented Top props", () => {
  const board = buildPlayerPropsBoard({ games: [] });
  assert.equal(board.rows.length, 0);
  assert.equal(board.counts.rows, 0);
  assert.equal(board.counts.eventsWithProps, 0);
  assert.deepEqual(
    board.counts.byMarket,
    Object.fromEntries(FBIS_PLAYER_MARKETS.map((id) => [id, 0])),
  );
});

test("propConvictions normalize into research-only player markets", () => {
  const game = normalizeBoardGame({
    id: "x",
    propConvictions: [
      {
        playerName: "RB1",
        team: "TEX",
        position: "RB",
        market: "rushing_yards",
        marketLabel: "Rush Yards",
        line: 68.5,
        price: -110,
        book: "fanduel",
      },
    ],
  });
  assert.equal(game.playerMarkets.length, 1);
  assert.equal(game.playerMarkets[0].marketCanonical, "rushing_yards");
  assert.equal(game.playerMarkets[0].decisionEligible, false);
  assert.ok(game.playerMarkets[0].reasonCodes.includes("PROP_CONVICTION_RESEARCH_ONLY"));

  const board = buildPlayerPropsBoard({ games: [{ id: "x", sport: "cfb", ...game }] });
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].surfaceStatus, "RESEARCH");
});

test("groupPlayerPropRows groups markets under one player key", () => {
  const groups = groupPlayerPropRows([
    {
      fbisPlayerId: null,
      providerPlayerId: "p9",
      playerName: "QB1",
      team: "OHIO",
      eventId: "e1",
      marketCanonical: "passing_yards",
      line: 250.5,
    },
    {
      providerPlayerId: "p9",
      playerName: "QB1",
      team: "OHIO",
      eventId: "e1",
      marketCanonical: "passing_attempts",
      line: 32.5,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].markets.length, 2);
  assert.equal(groups[0].providerPlayerId, "p9");
});


test("player props rows attach team logo from event sides", () => {
  const board = buildPlayerPropsBoard({
    games: [
      {
        id: "g1",
        sport: "cfb",
        away: {
          abbr: "ORE",
          name: "Oregon",
          logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png",
        },
        home: {
          abbr: "OSU",
          name: "Ohio State",
          logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/194.png",
        },
        playerMarkets: [
          {
            playerName: "Will Howard",
            team: "OSU",
            marketCanonical: "passing_yards",
            line: 249.5,
            overOdds: -110,
          },
        ],
      },
    ],
  });
  assert.equal(board.rows[0].teamIdentity.abbr, "OSU");
  assert.equal(
    board.rows[0].teamIdentity.logo,
    "https://a.espncdn.com/i/teamlogos/ncaa/500/194.png",
  );
  const grouped = groupPlayerPropRows(board.rows);
  assert.equal(grouped[0].teamIdentity.logo, board.rows[0].teamIdentity.logo);
});


test("formatMarketLabel turns snake_case into normal words", () => {
  assert.equal(formatMarketLabel("passing_yards"), "Pass Yards");
  assert.equal(formatMarketLabel("receiving_yards"), "Rec Yards");
  assert.equal(formatMarketLabel("anytime_td"), "Anytime TD");
  assert.equal(formatMarketLabel(""), "Player Prop");
});


test("withFbisPropAnalytics derives More/Less probability from projection + sigma + line", () => {
  const row = withFbisPropAnalytics({
    line: 249.5,
    fbisProjection: 262.4,
    fbisSigma: 42,
  });
  assert.equal(row.fbisProjection, 262.4);
  assert.ok(row.probabilityOver > 0.5);
  assert.ok(row.probabilityUnder < 0.5);
  assert.ok(row.projectionDelta > 0);
  assert.equal(row.edge, null);
});

test("withFbisPropAnalytics does not invent a projection", () => {
  const row = withFbisPropAnalytics({ line: 249.5, overOdds: -110 });
  assert.equal(row.fbisProjection, null);
  assert.equal(row.probabilityOver, null);
  assert.equal(row.probabilityUnder, null);
});


test("sorts props by conviction / mispricing descending", () => {
  const rows = sortPropsByConviction([
    withFbisPropAnalytics({ playerName: "Soft", line: 100, fbisProjection: 101, fbisSigma: 40 }),
    withFbisPropAnalytics({ playerName: "Hot", line: 249.5, fbisProjection: 290, fbisSigma: 35 }),
    withFbisPropAnalytics({ playerName: "Blank", line: 70, overOdds: -110 }),
  ]);
  assert.equal(rows[0].playerName, "Hot");
  assert.equal(rows[0].convictionTier, "CONVICTION");
  assert.equal(rows[0].convictionLean, "MORE");
  assert.equal(rows[rows.length - 1].playerName, "Blank");
  assert.equal(rows[rows.length - 1].convictionTier, "NONE");
});

test("rankPropConviction stays null when FBIS has no read", () => {
  const rank = rankPropConviction({ line: 50, overOdds: -110 });
  assert.equal(rank.convictionScore, -1);
  assert.equal(rank.convictionTier, "NONE");
  assert.equal(rank.convictionLean, null);
});
