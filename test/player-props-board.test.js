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
  propProjectionStars,
} from "../src/features/playerProps/buildPlayerPropsBoard.js";

test("supported FBIS player markets cover pro football and MLB core markets", () => {
  for (const id of [
    "passing_yards",
    "passing_attempts",
    "completions",
    "rushing_yards",
    "receptions",
    "receiving_yards",
    "hits",
    "total_bases",
    "home_runs",
    "rbis",
    "strikeouts",
    "pitcher_outs",
    "points",
    "rebounds",
    "assists",
    "shots_on_goal",
    "saves",
  ]) {
    assert.ok(FBIS_PLAYER_MARKETS.includes(id), id);
  }
});

test("player props board never invents decision eligibility or model authority", () => {
  const board = buildPlayerPropsBoard({
    date: "2026-09-13",
    games: [
      {
        id: "nfl-1",
        sport: "nfl",
        away: { abbr: "KC" },
        home: { abbr: "BUF" },
        playerMarkets: [
          {
            playerName: "Test QB",
            team: "KC",
            position: "QB",
            marketCanonical: "passing_yards",
            line: 249.5,
            overOdds: -110,
            underOdds: -105,
            book: "draftkings",
            fbisProjection: 262.4,
            fbisSigma: 42,
            decisionEligible: true,
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

test("college player props are excluded from the product board", () => {
  const board = buildPlayerPropsBoard({
    games: [
      {
        id: "cfb-1",
        sport: "cfb",
        away: { abbr: "TEX" },
        home: { abbr: "OU" },
        playerMarkets: [
          {
            playerName: "College QB",
            marketCanonical: "passing_yards",
            line: 250.5,
            overOdds: -110,
          },
        ],
      },
    ],
  });
  assert.equal(board.rows.length, 0);
  assert.equal(board.allRows.length, 0);
});

test("player prop board hides market rows without an FBIS projection", () => {
  const board = buildPlayerPropsBoard({
    games: [
      {
        id: "mlb-1",
        sport: "mlb",
        away: { abbr: "NYY" },
        home: { abbr: "BOS" },
        playerMarkets: [
          {
            provider: "ACTION_APIFY",
            providerPlayerId: "action-judge",
            playerName: "Aaron Judge",
            team: "NYY",
            market: "total bases",
            marketCanonical: "total_bases",
            line: 1.5,
            overOdds: -115,
            underOdds: -105,
            book: "draftkings",
            fbisProjection: null,
          },
        ],
      },
    ],
  });
  assert.equal(board.rows.length, 0);
  assert.equal(board.allRows.length, 0);
  assert.equal(board.counts.hiddenWithoutProjection, 1);
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
            fbisProjection: 78.0,
          },
          {
            playerName: "Star WR",
            marketCanonical: "first_touchdown",
            line: 0.5,
            overOdds: 500,
            fbisProjection: 0.15,
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
            { playerName: "A", marketCanonical: "receiving_yards", line: 1, fbisProjection: 1.2 },
            { playerName: "A", marketCanonical: "first_touchdown", line: 0.5, fbisProjection: 0.2 },
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
        team: "BUF",
        position: "RB",
        market: "rushing_yards",
        marketLabel: "Rush Yards",
        line: 68.5,
        price: -110,
        book: "fanduel",
        projection: 74.0,
        sigma: 12,
      },
    ],
  });
  assert.equal(game.playerMarkets.length, 1);
  assert.equal(game.playerMarkets[0].marketCanonical, "rushing_yards");
  assert.equal(game.playerMarkets[0].decisionEligible, false);
  assert.ok(game.playerMarkets[0].reasonCodes.includes("PROP_CONVICTION_RESEARCH_ONLY"));

  const board = buildPlayerPropsBoard({ games: [{ id: "x", sport: "nfl", ...game }] });
  assert.equal(board.rows.length, 1);
  assert.equal(board.rows[0].surfaceStatus, "RESEARCH");
});

test("groupPlayerPropRows groups markets under one player key", () => {
  const groups = groupPlayerPropRows([
    {
      fbisPlayerId: null,
      providerPlayerId: "p9",
      playerName: "QB1",
      team: "BUF",
      eventId: "e1",
      marketCanonical: "passing_yards",
      line: 250.5,
    },
    {
      providerPlayerId: "p9",
      playerName: "QB1",
      team: "BUF",
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
        sport: "nfl",
        away: {
          abbr: "KC",
          name: "Kansas City Chiefs",
          logo: "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
        },
        home: {
          abbr: "BUF",
          name: "Buffalo Bills",
          logo: "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
        },
        playerMarkets: [
          {
            playerName: "Test QB",
            team: "BUF",
            marketCanonical: "passing_yards",
            line: 249.5,
            overOdds: -110,
            fbisProjection: 265.0,
            fbisSigma: 40,
          },
        ],
      },
    ],
  });
  assert.equal(board.rows[0].teamIdentity.abbr, "BUF");
  assert.equal(
    board.rows[0].teamIdentity.logo,
    "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
  );
  const grouped = groupPlayerPropRows(board.rows);
  assert.equal(grouped[0].teamIdentity.logo, board.rows[0].teamIdentity.logo);
});

test("formatMarketLabel turns snake_case into normal words", () => {
  assert.equal(formatMarketLabel("passing_yards"), "Pass Yards");
  assert.equal(formatMarketLabel("receiving_yards"), "Rec Yards");
  assert.equal(formatMarketLabel("total_bases"), "Total Bases");
  assert.equal(formatMarketLabel("first_touchdown"), "First Touchdown");
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


test("propProjectionStars uses sigma-normalized FBIS-vs-line distance", () => {
  assert.equal(propProjectionStars({ fbisProjection: 105, line: 100, fbisSigma: 20 }), 2);
  assert.equal(propProjectionStars({ fbisProjection: 113, line: 100, fbisSigma: 20 }), 4);
  assert.equal(propProjectionStars({ fbisProjection: 120, line: 100, fbisSigma: 20 }), 5);
});

test("propProjectionStars falls back to relative FBIS-vs-line distance", () => {
  assert.equal(propProjectionStars({ fbis_projection: 102, line: 100 }), 1);
  assert.equal(propProjectionStars({ fbis_projection: 108, line: 100 }), 3);
  assert.equal(propProjectionStars({ fbis_projection: 111, line: 100 }), 4);
  assert.equal(propProjectionStars({ fbis_projection: 116, line: 100 }), 5);
  assert.equal(propProjectionStars({ fbis_projection: null, line: 100 }), null);
});

test("generic projected prop rows carry FBIS-vs-line confidence stars", () => {
  const row = withFbisPropAnalytics({
    sport: "nfl",
    marketCanonical: "passing_yards",
    line: 250,
    fbisProjection: 280,
    fbisSigma: 40,
  });
  assert.equal(row.confidenceStars, 4);
  assert.equal(row.confidenceVersion, "fbis-prop-gap-stars-v1");
  assert.equal(row.confidenceSide, "MORE");
});


test("WNBA PrizePicks props use the common star system with canonical 3PT mapping", () => {
  const board = buildPlayerPropsBoard({
    games: [{
      id:"wnba-1", sport:"wnba",
      away:{abbr:"IND"}, home:{abbr:"LVA"},
      playerMarkets:[{
        playerName:"Shooter",
        team:"LVA",
        market:"3-PT Made",
        marketCanonical:"3_pt_made",
        line:2.5,
        fbisProjection:3.6,
        fbisSigma:1.0,
        propGate:"CLEAR",
        eligibleForCard:true,
      }],
    }],
  });
  assert.equal(board.rows.length,1);
  assert.equal(board.rows[0].marketCanonical,"three_pointers_made");
  assert.equal(board.rows[0].confidenceStars,5);
  assert.equal(board.rows[0].confidenceVersion,"fbis-prop-gap-stars-v1");
  assert.equal(board.rows[0].confidenceSide,"MORE");
});

test("WNBA authorized props keep the full generic 1-5 star range and card authority", () => {
  const board = buildPlayerPropsBoard({
    games:[{
      id:"wnba-open",sport:"wnba",away:{abbr:"IND"},home:{abbr:"LVA"},
      playerMarkets:[{
        playerName:"Star",
        team:"LVA",
        marketCanonical:"points",
        line:20.5,
        fbisProjection:28,
        fbisSigma:4,
        propGate:"CLEAR",
        decisionEligible:true,
        eligibleForCard:true,
        modelAuthorized:true,
      }],
    }],
  });
  assert.equal(board.rows.length,1);
  assert.equal(board.rows[0].confidenceStars,5);
  assert.equal(board.rows[0].confidenceSide,"MORE");
  assert.equal(board.rows[0].decisionEligible,true);
  assert.equal(board.rows[0].eligibleForCard,true);
  assert.equal(board.rows[0].modelAuthorized,true);
  assert.equal(board.readiness.classification,"ACTIVE");
  assert.equal(board.readiness.modelAuthorized,true);
  assert.equal(board.readiness.decisionEligible,true);
});


test("domain adapter preserves authorized WNBA prop flags", () => {
  const game = normalizeBoardGame({
    id:"wnba-domain", sport:"wnba",
    playerProjectionRows:[{
      playerId:"p1", playerName:"Guard", team:"LVA", market:"points",
      fbisProjection:24, fbisSigma:4, decisionEligible:true, eligibleForCard:true,
      canAuthorizeWager:true, propGate:"CLEAR", maturity:"ACTIVE",
    }],
    playerMarkets:[{
      providerPlayerId:"p1", playerName:"Guard", team:"LVA",
      marketCanonical:"points", line:20.5,
    }],
  });
  const board = buildPlayerPropsBoard({games:[game]});
  assert.equal(board.rows[0].decisionEligible,true);
  assert.equal(board.rows[0].modelAuthorized,true);
  assert.equal(board.rows[0].eligibleForCard,true);
  assert.equal(board.rows[0].propGate,"CLEAR");
});


test("live NFL props board hides rows below four stars outside San Francisco", () => {
  const board = buildPlayerPropsBoard({
    games:[{
      id:"nfl-g",sport:"nfl",away:{abbr:"DAL"},home:{abbr:"PHI"},
      playerMarkets:[
        {
          playerName:"QB Low",team:"DAL",marketCanonical:"passing_yards",
          targetRole:"QB1",line:250.5,fbisProjection:255,fbisSigma:45,
          roleConfidence:.9,propGate:"CLEAR",eligibleForCard:true,
          featureEvidence:{
            targetRole:true,targetRoleName:"QB1",recent5:true,snapShare:true,
            positionDefense:true,nextGen:true,opponentMatchup:true
          }
        },
        {
          playerName:"WR Two",team:"PHI",marketCanonical:"receptions",
          targetRole:"WR2",line:5.5,fbisProjection:3.0,fbisSigma:1.2,
          roleConfidence:.9,propGate:"CLEAR",eligibleForCard:true,
          featureEvidence:{
            targetRole:true,targetRoleName:"WR2",recent5:true,snapShare:true,
            positionDefense:true,nextGen:true,opponentMatchup:true
          }
        }
      ]
    }]
  },{supportedOnly:false,enforceNflDisplayPolicy:true});
  assert.deepEqual(board.rows.map(r=>r.playerName),["WR Two"]);
  assert.equal(board.rows[0].confidenceStars,5);
  assert.equal(board.counts.hiddenNflBelowFourStars,1);
});

test("live NFL props board always shows 49ers QB1 RB1 WR1 WR2 TE1 projections regardless of stars or PrizePicks line", () => {
  const roles=["QB1","RB1","WR1","WR2","TE1"];
  const positions={QB1:"QB",RB1:"RB",WR1:"WR",WR2:"WR",TE1:"TE"};
  const markets={QB1:"passing_yards",RB1:"rushing_yards",WR1:"receiving_yards",WR2:"receptions",TE1:"receiving_yards"};
  const playerProjectionRows=roles.map((role,i)=>({
    playerId:"sf-"+role,playerName:"SF "+role,team:"SF",position:positions[role],
    market:markets[role],targetRole:role,
    fbisProjection:100+i,fbisSigma:20,roleConfidence:.9,
    featureEvidence:{
      targetRole:true,targetRoleName:role,recent5:true,snapShare:true,
      positionDefense:true,nextGen:true,opponentMatchup:true
    },
    propGate:"CLEAR",eligibleForCard:true
  }));
  const board=buildPlayerPropsBoard({
    games:[{
      id:"sf-game",sport:"nfl",
      away:{abbr:"DEN"},home:{abbr:"SF",name:"San Francisco 49ers"},
      playerProjectionRows,
      playerMarkets:[]
    }]
  },{supportedOnly:false,enforceNflDisplayPolicy:true});
  assert.equal(board.rows.length,5);
  assert.deepEqual(new Set(board.rows.map(r=>r.targetRole)),new Set(roles));
  assert.ok(board.rows.every(r=>r.displayMode==="TEAM_PROJECTION" || r.displayMode==="QUALIFIED_EDGE"));
  assert.equal(board.counts.visible49ersRoleProjections,5);
});

test("49ers low-star projection is informational rather than a recommendation", () => {
  const board=buildPlayerPropsBoard({
    games:[{
      id:"sf-low",sport:"nfl",away:{abbr:"DEN"},home:{abbr:"SF",name:"San Francisco 49ers"},
      playerMarkets:[{
        playerName:"SF WR1",team:"SF",marketCanonical:"receptions",targetRole:"WR1",
        line:5.5,fbisProjection:5.0,fbisSigma:2.0,roleConfidence:.9,
        propGate:"CLEAR",eligibleForCard:true,
        featureEvidence:{
          targetRole:true,targetRoleName:"WR1",recent5:true,snapShare:true,
          positionDefense:true,nextGen:true,opponentMatchup:true
        }
      }]
    }]
  },{supportedOnly:false,enforceNflDisplayPolicy:true});
  assert.equal(board.rows.length,1);
  assert.ok(board.rows[0].confidenceStars<4);
  assert.equal(board.rows[0].displayMode,"TEAM_PROJECTION");
  assert.equal(board.rows[0].recommendationEligible,false);
});
