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
  orderExchangeResearchCards,
  buildVenueComparisonRows,
  groupExchangePlayerStatCards,
  normalizeBoardGame,
  propProjectionStars,
  selectFreeMirrorReferenceRows,
} from "../src/features/playerProps/buildPlayerPropsBoard.js";

test("free mirror references remain visible without model projections", () => {
  const rows = [{ provider:"PRIZEPICKS_FREE_MIRROR",sport:"cfb",fbisEventId:"12345",
    playerName:"College QB",marketCanonical:"passing_yards",line:249.5,
    fbisProjection:null,decisionEligible:true,canQualify:true,canAuthorizeWager:true },
    { provider:"PRIZEPICKS_FREE_MIRROR",sport:"nfl",playerName:"NFL QB",marketCanonical:"passing_yards",line:250.5 },
    { provider:"ACTION",sport:"cfb",playerName:"Other",marketCanonical:"passing_yards",line:150.5 }];
  const college=selectFreeMirrorReferenceRows(rows,{sportFilter:"cfb"});
  assert.equal(college.length,1);
  assert.equal(college[0].fbisProjection,null);
  assert.equal(college[0].displayMode,"MIRROR_REFERENCE_ONLY");
  assert.equal(college[0].decisionEligible,false);
  assert.equal(college[0].canQualify,false);
  assert.equal(college[0].canAuthorizeWager,false);
  assert.equal(college[0].recommendationEligible,false);
  assert.equal(selectFreeMirrorReferenceRows(rows,{sportFilter:"all"}).length,2);
  assert.equal(selectFreeMirrorReferenceRows(rows,{sportFilter:"nba"}).length,0);
});

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
  assert.equal(propProjectionStars({ fbisProjection: 113, line: 100, fbisSigma: 20 }), 3);
  assert.equal(propProjectionStars({ fbisProjection: 120, line: 100, fbisSigma: 20 }), 3);
});

test("propProjectionStars falls back to relative FBIS-vs-line distance", () => {
  assert.equal(propProjectionStars({ fbis_projection: 102, line: 100 }), 1);
  assert.equal(propProjectionStars({ fbis_projection: 108, line: 100 }), 3);
  assert.equal(propProjectionStars({ fbis_projection: 111, line: 100 }), 3);
  assert.equal(propProjectionStars({ fbis_projection: 116, line: 100 }), 3);
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
  assert.equal(row.confidenceStars, 3);
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
  assert.equal(board.rows[0].confidenceStars,3);
  assert.equal(board.rows[0].confidenceVersion,"fbis-prop-gap-stars-v1");
  assert.equal(board.rows[0].confidenceSide,"MORE");
});

test("WNBA authorization alone does not unlock premium confidence without calibration", () => {
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
  assert.equal(board.rows[0].confidenceStars,3);
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


test("live NFL props board hides uncalibrated sub-4-star rows outside San Francisco", () => {
  const board = buildPlayerPropsBoard({
    games:[{
      id:"nfl-g",sport:"nfl",away:{abbr:"DAL"},home:{abbr:"PHI"},
      playerMarkets:[
        {
          playerName:"QB Low",team:"DAL",marketCanonical:"passing_yards",
          targetRole:"QB1",line:250.5,fbisProjection:255,fbisSigma:45,
          roleConfidence:.9,propGate:"CLEAR",eligibleForCard:true,propCalibrationValidated:true,
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
  assert.deepEqual(board.rows.map(r=>r.playerName),[]);
  assert.equal(board.counts.hiddenNflBelowFourStars,2);
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


test("visible tennis cards require a real headshot URL", () => {
  const board = buildPlayerPropsBoard({
    games:[{
      id:"tennis:pp:g1",sport:"tennis",
      away:{abbr:"Opponent",name:"Opponent"},
      home:{abbr:"Player",name:"Player"},
      playerMarkets:[
        {
          playerName:"With Photo",marketCanonical:"total_games",line:22.5,
          fbisProjection:23.4,fbisSigma:3.1,imageUrl:"https://static.prizepicks.com/player.png"
        },
        {
          playerName:"No Photo",marketCanonical:"total_games_won",line:11.5,
          fbisProjection:12.2,fbisSigma:2.0,imageUrl:null
        }
      ]
    }]
  },{supportedOnly:false});
  assert.equal(board.rows.length,1);
  assert.equal(board.rows[0].playerName,"With Photo");
  assert.equal(board.counts.hiddenTennisWithoutHeadshot,1);
  assert.ok(board.rows.every(r=>r.sport!=="tennis"||Boolean(r.imageUrl)));
});


test("PrizePicks Demon/Goblin star cap is platform-wide on non-NFL player props", () => {
  const standard=withFbisPropAnalytics({
    sport:"wnba",
    marketCanonical:"points",
    line:20.5,
    fbisProjection:30,
    fbisSigma:4,
    odds_tier:"standard",
    propGate:"CLEAR",
    eligibleForCard:true,
  });
  const demon=withFbisPropAnalytics({
    sport:"wnba",
    marketCanonical:"points",
    line:30.5,
    fbisProjection:20,
    fbisSigma:4,
    odds_tier:"demon",
    propGate:"CLEAR",
    eligibleForCard:true,
  });
  assert.equal(standard.confidenceStars,3);
  assert.ok(demon.confidenceStars<=2);
  assert.equal(demon.prizePicksEconomics.status,"ALTERNATE_TIER_PAYOUT_UNPRICED");
});


test("explicit calibrated prop probability can unlock premium stars", () => {
  const row=withFbisPropAnalytics({
    sport:"wnba",
    marketCanonical:"points",
    line:20.5,
    fbisProjection:30,
    fbisSigma:4,
    propCalibrationValidated:true,
    propGate:"CLEAR",
    eligibleForCard:true,
  });
  assert.equal(row.confidenceStars,3);
  // Generic raw-gap path remains capped; premium tiers require a validated
  // sport/market confidence grader rather than a calibration flag alone.
});


test("unvalidated MLB supplemental props stay visible but cannot present as conviction", () => {
  const board=buildPlayerPropsBoard({
    games:[{
      id:"mlb-research",sport:"mlb",away:{abbr:"NYY"},home:{abbr:"BOS"},
      playerProjectionRows:[{
        playerId:"p1",playerName:"Test Hitter",team:"NYY",position:"RF",
        market:"hits",fbisProjection:1.8,fbisSigma:.5,maturity:"RESEARCH_UNVALIDATED",
        propGate:"CLEAR",eligibleForCard:false,decisionEligible:false,canAuthorizeWager:false
      }],
      playerMarkets:[{
        providerPlayerId:"p1",playerName:"Test Hitter",team:"NYY",
        marketCanonical:"hits",line:.5
      }]
    }]
  },{supportedOnly:false});
  assert.equal(board.rows.length,1);
  assert.equal(board.rows[0].confidenceStars,1);
  assert.equal(board.rows[0].convictionTier,"WATCH");
  assert.equal(board.rows[0].recommendationEligible,false);
  assert.equal(board.rows[0].modelAuthorized,false);
});


test("MLB model-only prop rows remain visible before a market line posts", () => {
  const board=buildPlayerPropsBoard({
    games:[{
      id:"mlb-model-only",sport:"mlb",away:{abbr:"NYY"},home:{abbr:"BOS"},
      playerProjectionRows:[{
        playerId:"p1",playerName:"Test Hitter",team:"NYY",position:"RF",
        market:"total_bases",fbisProjection:1.7,fbisSigma:.8,
        maturity:"RESEARCH_UNVALIDATED",propGate:"CLEAR",
        eligibleForCard:false,decisionEligible:false,canAuthorizeWager:false
      }],
      playerMarkets:[]
    }]
  },{supportedOnly:false});
  assert.equal(board.rows.length,1);
  assert.equal(board.rows[0].line,null);
  assert.equal(board.rows[0].displayMode,"MODEL_PROJECTION");
  assert.equal(board.rows[0].recommendationEligible,false);
  assert.equal(board.counts.visibleMlbProjectionOnly,1);
  assert.equal(board.policy.mlbProjectionOnlyRowsVisible,true);
});

test("exchange cards show actual mapped contracts before unpaired NBA research",()=>{
 const model=Array.from({length:150},(_,i)=>({id:'model-'+i,provider:null,fbis_projection:15,
  canonicalEventId:'G1',start_time:'2026-10-20T19:00Z'}));
 const markets=[
  ...Array.from({length:70},(_,i)=>({id:'b-'+i,provider:'Kalshi',contractId:'KXB'+i,identityVerified:true,
   canonicalEventId:'BOS-DET',start_time:'2026-10-20T19:00Z',player_name:'Boston-'+i,marketAvailable:false})),
  ...Array.from({length:70},(_,i)=>({id:'n-'+i,provider:'Kalshi',contractId:'KXN'+i,identityVerified:true,
   canonicalEventId:'NY-PHI',start_time:'2026-10-20T23:00Z',player_name:'NY-'+i,marketAvailable:false})),
  ...Array.from({length:70},(_,i)=>({id:'s-'+i,provider:'Kalshi',contractId:'KXS'+i,identityVerified:true,
   canonicalEventId:'SA-OKC',start_time:'2026-10-21T01:30Z',player_name:'SAS-'+i,marketAvailable:false})),
 ];
 const shown=orderExchangeResearchCards([...model,...markets],100);
 assert.equal(shown.length,100);
 assert.ok(shown.every(r=>r.contractId&&r.identityVerified===true));
 assert.deepEqual(new Set(shown.map(r=>r.canonicalEventId)),new Set(['BOS-DET','NY-PHI','SA-OKC']));
 assert.ok(shown.filter(r=>r.canonicalEventId==='BOS-DET').length>=30);
 assert.ok(shown.filter(r=>r.canonicalEventId==='NY-PHI').length>=30);
 assert.ok(shown.filter(r=>r.canonicalEventId==='SA-OKC').length>=30);
 assert.equal(orderExchangeResearchCards([...model,...markets],0).length,0);
});
test("exchange order never upgrades an unqualified contract into a verified market",()=>{
 const r={id:'one',contractId:'KXNBA',provider:'Kalshi',identityVerified:true,
  marketAvailable:false,priceVerified:false,canQualify:false,canAuthorizeWager:false};
 const a=orderExchangeResearchCards([r],100);
 assert.equal(a.length,1);assert.equal(a[0],r);assert.equal(a[0].marketAvailable,false);
 assert.equal(a[0].canAuthorizeWager,false);
 const onlyModel={id:'model',provider:null,fbis_projection:10};
 assert.equal(orderExchangeResearchCards([onlyModel,r],1)[0],r);
 const fakeContract={id:'fake',provider:'Kalshi',contractId:'KX',identityVerified:false};
 assert.equal(orderExchangeResearchCards([fakeContract,onlyModel],2)[0],onlyModel);
});

test("paired exchange card uses exact event, player, stat, line, period and stat side",()=>{
 const base={id:'k',provider:'Kalshi',contractId:'KXNBA',identityVerified:true,sport:'nba',
 canonicalEventId:'event-1',canonicalPlayerId:'nba:espn:123',canonical_market:'points',
 line:24.5,period:'full_game',statSide:'over',side:'yes',
 settlementTerms:'identical contract rules',settlementScope:'full game',dnpSettlement:'FAIR_PRICE',
 observedAsk:.48,priceVerified:false,marketAvailable:false,canAuthorizeWager:false};
 const other={...base,id:'p',provider:'Polymarket',contractId:'US-PROP',observedAsk:.56};
 const combined=buildVenueComparisonRows([base,other]);
 assert.equal(combined.length,1);
 assert.equal(combined[0].venueComparison.providerCount,2);
 assert.equal(combined[0].venueComparison.priceComparisonStatus,'QUOTE_CLOCK_OR_EXECUTION_UNVERIFIED');
 assert.equal(combined[0].venueComparison.priceDifferenceDollars,null);
 assert.equal(combined[0].canAuthorizeWager,false);
 assert.equal(combined[0].venueComparison.venues.find(v=>v.provider==='Polymarket').price,.56);
});
test("difference is published only with identical settlement and verified current executable asks",()=>{
 const k={id:'k',provider:'Kalshi',contractId:'K',identityVerified:true,sport:'nba',
 canonicalEventId:'event-1',canonicalPlayerId:'nba:espn:123',canonical_market:'rebounds',
 line:7.5,period:'full_game',statSide:'under',side:'no',
 settlementTerms:'exact equal terms',settlementScope:'full game',dnpSettlement:'VOID',
 purchaseAsk:.41,priceVerified:true,fresh:true,marketAvailable:true};
 const p={...k,id:'p',provider:'Polymarket',contractId:'P',purchaseAsk:.49};
 const good=buildVenueComparisonRows([k,p]);
 assert.equal(good.length,1);assert.equal(good[0].venueComparison.priceDifferenceDollars,.08);
 assert.equal(good[0].venueComparison.cheaperProvider,'Kalshi');
 for(const variant of [{...p,settlementTerms:'Different terms'}, {...p,dnpSettlement:'FAIR_PRICE'},
  {...p,line:8.5}, {...p,canonicalEventId:'other game'}, {...p,statSide:'over'}]){
  const result=buildVenueComparisonRows([k,variant]);
  assert.equal(result.some(r=>r.venueComparison?.priceDifferenceDollars!=null),false);
 }
});
test("model-only props keep their projection with no fabricated exchange quote",()=>{
 const model={id:'model',sport:'nba',canonicalEventId:'e',canonicalPlayerId:'p',canonical_market:'points',fbis_projection:22};
 const result=buildVenueComparisonRows([model]);
 assert.equal(result.length,1);assert.equal(result[0],model);assert.equal(result[0].venueComparison,undefined);
});

test('unified market cards collapse exact over/under Kalshi legs without losing asks',()=>{
 const common={sport:'nba',canonicalEventId:'game-1',canonicalPlayerId:'nba:espn:123',
  canonical_market:'points',line:24.5,period:'full_game',identityVerified:true,
  provider:'Kalshi',fbis_projection:27.8,canAuthorizeWager:false};
 const over={...common,id:'K-YES',contractId:'K-Y',statSide:'over',side:'yes',observedAsk:.55,observedDepth:18};
 const under={...common,id:'K-NO',contractId:'K-N',statSide:'under',side:'no',observedAsk:.48,observedDepth:11};
 const paired=buildVenueComparisonRows([over,under]);
 const cards=groupExchangePlayerStatCards(paired);
 assert.equal(cards.length,1);
 assert.equal(cards[0].fbis_projection,27.8);
 assert.equal(cards[0].line,24.5);
 assert.equal(cards[0].venueComparison.groupedContractSides,2);
 assert.equal(cards[0].venueComparison.marketSides.over.venues[0].price,.55);
 assert.equal(cards[0].venueComparison.marketSides.under.venues[0].price,.48);
 assert.equal(cards[0].venueComparison.marketSides.over.priceDifferenceDollars,null);
 assert.equal(cards[0].canAuthorizeWager,false);
});
test('different thresholds, events and players stay on separate stat cards',()=>{
 const base={provider:'Kalshi',sport:'nba',canonicalEventId:'g',canonicalPlayerId:'nba:espn:9',
  canonical_market:'rebounds',period:'full_game',line:8.5,identityVerified:true,statSide:'over',
  contractId:'k-over',side:'yes',observedAsk:.3};
 const variants=[{...base,id:'1'},{...base,id:'2',contractId:'b',statSide:'under',side:'no',line:9.5},
  {...base,id:'3',contractId:'c',statSide:'under',side:'no',canonicalEventId:'g2'},
  {...base,id:'4',contractId:'d',statSide:'under',side:'no',canonicalPlayerId:'nba:espn:10'}];
 assert.equal(groupExchangePlayerStatCards(buildVenueComparisonRows(variants)).length,4);
});
test('three-provider-side duplicates are not discarded or labeled qualified',()=>{
 const k={id:'k',provider:'Kalshi',sport:'nfl',canonicalEventId:'e',canonicalPlayerId:'nfl:nflverse:1',
  canonical_market:'receptions',period:'full_game',line:4.5,identityVerified:true,statSide:'over',
  side:'yes',contractId:'k1',observedAsk:.48};
 const k2={...k,id:'k2',contractId:'k2',observedAsk:.51};
 const n={...k,id:'n',contractId:'n',statSide:'under',side:'no'};
 const cards=groupExchangePlayerStatCards(buildVenueComparisonRows([k,k2,n]));
 assert.equal(cards.length,3);
 assert.ok(cards.every(c=>c.canAuthorizeWager!==true));
});

test('Global Gamma source reference spread is visible but never treated as qualified executable price gap',()=>{
 const k={id:'k',provider:'Kalshi',contractId:'KXNBA-9',identityVerified:true,sport:'nba',
  canonicalEventId:'401909088',canonicalPlayerId:'nba:espn:4684742',canonical_market:'points',
  line:9.5,period:'full_game',statSide:'over',side:'yes',observedAsk:.55,
  settlementTerms:'fair-market-value on inactive',settlementScope:'KALSHI_GAME',dnpSettlement:'FAIR_PRICE',
  priceVerified:false,marketAvailable:false,canAuthorizeWager:false};
 const p={...k,id:'p',provider:'Polymarket',contractId:'nba-bos-det-points-ausar-9pt5',
  observedAsk:null,observedReferencePrice:.45,priceKind:'DISPLAY_REFERENCE_NOT_ASK',
  settlementScope:'GAMMA_NBA_FULL_GAME_OT',dnpSettlement:'NO_IF_INACTIVE',settlementTerms:'Resolves No if DNP'};
 const [r]=buildVenueComparisonRows([k,p]);
 assert.equal(r.venueComparison.providerCount,2);
 assert.equal(r.venueComparison.referenceDifferenceDollars,-.10);
 assert.equal(r.venueComparison.priceDifferenceDollars,null);
 assert.equal(r.venueComparison.settlementEquivalent,false);
 assert.equal(r.venueComparison.venues.find(v=>v.provider==='Polymarket').priceKind,'DISPLAY_REFERENCE_NOT_ASK');
 assert.equal(r.venueComparison.canAuthorizeWager,false);
});
