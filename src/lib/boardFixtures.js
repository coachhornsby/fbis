/**
 * Visual / sort QA fixtures for the intelligence board.
 * Injected only when ?boardQa=1 — never alters live slate logic by default.
 */

function team(partial) {
  return {
    abbr: partial.abbr || "TBD",
    name: partial.name || partial.abbr || "Team",
    fullName: partial.fullName || partial.name || partial.abbr || "Team",
    school: partial.school || partial.name || null,
    record: partial.record || null,
    logo: partial.logo || null,
    score: partial.score ?? null,
  };
}

function baseGame(partial) {
  const projAway = partial.projAway ?? 21;
  const projHome = partial.projHome ?? 28;
  return {
    id: partial.id,
    sport: partial.sport || "cfb",
    start: partial.start,
    startCt: partial.start,
    status: partial.status || { detail: "Scheduled", live: false, completed: false },
    venue: partial.venue || "Fixture Stadium",
    away: team(partial.away),
    home: team(partial.home),
    projAway,
    projHome,
    projMargin: Number.isFinite(projHome - projAway) ? projHome - projAway : null,
    projAwayScore: projAway,
    projHomeScore: projHome,
    projectionKind: "FBIS",
    projectionState: partial.projectionState || "COMPLETE",
    model: {
      projAway,
      projHome,
      projMargin: projHome - projAway,
      recipe: { engine: "fixture" },
    },
    spread: partial.spread ?? -6.5,
    pinSpread: partial.pinSpread ?? partial.spread ?? -6.5,
    ticketPct: partial.ticketPct ?? null,
    moneyPct: partial.moneyPct ?? null,
    odds: {
      pinPresent: partial.pinPresent ?? true,
      softSource: partial.softSource || "sharpapi",
      spread: partial.spread ?? -6.5,
      total: partial.total ?? 52.5,
      homeMl: partial.homeMl ?? -250,
      awayMl: partial.awayMl ?? 210,
      pinSpread: partial.pinSpread ?? partial.spread ?? -6.5,
      pinTotal: partial.total ?? 52.5,
      pinHomeMl: partial.homeMl ?? -250,
      pinAwayMl: partial.awayMl ?? 210,
      softSpreadHomePrice: -110,
      softSpreadAwayPrice: -110,
      softOverPrice: -110,
      softUnderPrice: -110,
    },
    cfb: {
      bettingAllowed: partial.blocked ? false : true,
      blockReason: partial.blocked ? "Fixture blocked — missing team evidence" : null,
      projectionState: partial.projectionState || (partial.early ? "PRIOR_ONLY" : "COMPLETE"),
      dataQuality: partial.dataQuality ?? (partial.early ? 42 : 78),
      flags: partial.early ? ["early_season", "prior_only", "form_missing"] : [],
    },
    awaySp: partial.awaySp || null,
    homeSp: partial.homeSp || null,
    savant: partial.savant || null,
    rec: partial.rec || null,
    lean: partial.lean || null,
    qualificationBlocked: Boolean(partial.blocked),
    ...partial.extra,
  };
}

/** One card per decision tier + stress cases for layout QA. */
export function boardQaFixtureGames() {
  return [
    baseGame({
      id: "qa-conviction",
      start: "2026-09-13T19:00:00.000Z",
      away: {
        abbr: "ORE",
        name: "Oregon",
        fullName: "Oregon Ducks",
        record: "2-0",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png",
      },
      home: {
        abbr: "OSU",
        name: "Ohio State",
        fullName: "Ohio State Buckeyes",
        record: "2-0",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/194.png",
      },
      venue: "Ohio Stadium",
      projAway: 24.2,
      projHome: 31.8,
      rec: {
        qualified: true,
        tag: "CONVICTION",
        pick: "Ohio State -6.5",
        market: "SPREAD",
        ev: 0.091,
        evPct: 9.1,
        book: "DK/FD",
        softBenchmark: true,
      },
      ticketPct: 38,
      moneyPct: 61,
      pinSpread: -6.5,
      openingSpread: -5.5,
      spread: -6.5,
    }),
    baseGame({
      id: "qa-qualified",
      start: "2026-09-13T16:30:00.000Z",
      away: {
        abbr: "ALA",
        name: "Alabama",
        fullName: "Alabama Crimson Tide",
        record: "1-1",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/333.png",
      },
      home: {
        abbr: "UGA",
        name: "Georgia",
        fullName: "Georgia Bulldogs",
        record: "2-0",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/61.png",
      },
      venue: "Sanford Stadium",
      projAway: 27.1,
      projHome: 29.4,
      pinPresent: true,
      rec: {
        qualified: true,
        tag: "STRONG",
        pick: "Over 55.5",
        market: "TOTAL",
        ev: 0.054,
        evPct: 5.4,
        book: "Pinnacle",
      },
      ticketPct: 54,
      moneyPct: 47,
      pinSpread: -3.0,
      openingSpread: -2.5,
      spread: -3.0,
    }),
    baseGame({
      id: "qa-lean",
      start: "2026-09-13T23:00:00.000Z",
      early: true,
      away: {
        abbr: "WSU",
        name: "Washington State",
        fullName: "Washington State Cougars",
        record: "0-2",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/265.png",
      },
      home: {
        abbr: "KSU",
        name: "Kansas State",
        fullName: "Kansas State Wildcats",
        record: "2-0",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/2306.png",
      },
      venue: "Bill Snyder Family Stadium",
      projAway: 17,
      projHome: 35.6,
      lean: {
        tag: "LEAN",
        pick: "Kansas State -17.5",
        market: "SPREAD",
        ev: 0.021,
        evPct: 2.1,
        book: "DK/FD",
        softBenchmark: true,
        reason: "PRIOR_ONLY CFB projection — value signal only",
      },
      ticketPct: 72,
      moneyPct: 58,
      pinSpread: -17.5,
      openingSpread: -16.5,
      spread: -17.5,
    }),
    baseGame({
      id: "qa-pass-long-names",
      start: "2026-09-13T20:00:00.000Z",
      away: {
        abbr: "MASS",
        name: "UMass",
        fullName: "Massachusetts Minutemen",
        record: "0-3",
        logo: null,
      },
      home: {
        abbr: "NICH",
        name: "Nicholls",
        fullName: "Nicholls State Colonels",
        record: "1-1",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/2447.png",
      },
      venue: "Manning Field at John L. Guidry Stadium",
      projAway: 19.4,
      projHome: 22.1,
      dataQuality: 61,
      spread: null,
      total: null,
      homeMl: null,
      awayMl: null,
      extra: {
        odds: {
          pinPresent: false,
          softSource: "sharpapi",
          spread: null,
          total: null,
          homeMl: null,
          awayMl: null,
        },
      },
    }),
    baseGame({
      id: "qa-blocked",
      start: "2026-09-13T17:00:00.000Z",
      blocked: true,
      away: {
        abbr: "FCS",
        name: "FCS Visitor",
        fullName: "Very Long FCS School Name University Fighting Something",
        record: null,
        logo: null,
      },
      home: {
        abbr: "FBS",
        name: "FBS Host",
        fullName: "Another Extremely Long Host University Name Bulldogs",
        record: "1-0",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/99.png",
      },
      venue: "Neutral Site TBD",
      dataQuality: 18,
      early: true,
    }),
    (() => {
      const g = baseGame({
        id: "qa-mlb-sidebyside",
        sport: "mlb",
        start: "2026-09-13T23:40:00.000Z",
        away: {
          abbr: "TOR",
          name: "Blue Jays",
          fullName: "Toronto Blue Jays",
          record: "78-64",
          logo: "https://a.espncdn.com/i/teamlogos/mlb/500/tor.png",
        },
        home: {
          abbr: "DET",
          name: "Tigers",
          fullName: "Detroit Tigers",
          record: "82-60",
          logo: "https://a.espncdn.com/i/teamlogos/mlb/500/det.png",
        },
        venue: "Comerica Park",
        projAway: 3.8,
        projHome: 4.6,
        pinPresent: false,
        awaySp: { name: "Kevin Gausman", last: "Gausman", record: "12-8" },
        homeSp: { name: "Tarik Skubal", last: "Skubal", record: "14-4" },
        savant: { awaySpEra: 3.72, homeSpEra: 2.41 },
        rec: {
          tag: "STANDARD",
          pick: "Detroit Tigers",
          market: "ML",
          ev: 0.041,
          evPct: 4.1,
          book: "DK/FD",
          softBenchmark: true,
        },
      });
      delete g.cfb;
      return g;
    })(),
  ];
}

export function boardQaEnabled(search = typeof window !== "undefined" ? window.location.search : "") {
  try {
    return new URLSearchParams(search).get("boardQa") === "1";
  } catch {
    return false;
  }
}

export function mergeBoardQaFixtures(games = [], search) {
  if (!boardQaEnabled(search)) return games;
  const live = Array.isArray(games) ? games : [];
  return [...boardQaFixtureGames(), ...live];
}

/**
 * Today / Player Props QA fixtures — opt-in via ?boardQa=1 only.
 * Never invents decision eligibility; research surface samples only.
 */
export function todayQaPlayerPropGames() {
  return [
    baseGame({
      id: "qa-player-props",
      start: "2026-09-13T19:00:00.000Z",
      away: {
        abbr: "ORE",
        name: "Oregon",
        fullName: "Oregon Ducks",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png",
      },
      home: {
        abbr: "OSU",
        name: "Ohio State",
        fullName: "Ohio State Buckeyes",
        logo: "https://a.espncdn.com/i/teamlogos/ncaa/500/194.png",
      },
      venue: "Ohio Stadium",
      projAway: 24.2,
      projHome: 31.8,
      extra: {
        playerMarkets: [
          {
            playerName: "Will Howard",
            team: "OSU",
            position: "QB",
            marketCanonical: "passing_yards",
            line: 249.5,
            overOdds: -110,
            underOdds: -110,
            book: "draftkings",
            providerPlayerId: "qa-wh",
            playerIdentityConfidence: "HIGH",
            fbisProjection: 288.0,
            fbisSigma: 36,
          },
          {
            playerName: "Will Howard",
            team: "OSU",
            position: "QB",
            marketCanonical: "passing_attempts",
            line: 32.5,
            overOdds: -115,
            underOdds: -105,
            book: "fanduel",
            providerPlayerId: "qa-wh",
            playerIdentityConfidence: "HIGH",
            fbisProjection: 34.1,
            fbisSigma: 5.2,
          },
          {
            playerName: "Quinshon Judkins",
            team: "OSU",
            position: "RB",
            marketCanonical: "rushing_yards",
            line: 78.5,
            overOdds: -108,
            underOdds: -112,
            book: "draftkings",
            providerPlayerId: "qa-qj",
            playerIdentityConfidence: "MEDIUM",
            fbisProjection: 64.0,
            fbisSigma: 18,
          },
          {
            playerName: "Jeremiah Smith",
            team: "OSU",
            position: "WR",
            marketCanonical: "receiving_yards",
            line: 72.5,
            overOdds: -110,
            underOdds: -110,
            book: "betmgm",
            providerPlayerId: "qa-js",
            playerIdentityConfidence: "HIGH",
            fbisProjection: 79.8,
            fbisSigma: 24,
          },
          {
            playerName: "Jeremiah Smith",
            team: "OSU",
            position: "WR",
            marketCanonical: "receptions",
            line: 5.5,
            overOdds: -120,
            underOdds: 100,
            book: "fanduel",
            providerPlayerId: "qa-js",
            playerIdentityConfidence: "HIGH",
            fbisProjection: 6.1,
            fbisSigma: 1.8,
          },
          {
            playerName: "Novelty Prop",
            team: "ORE",
            position: "WR",
            marketCanonical: "anytime_td",
            line: 0.5,
            overOdds: 145,
            book: "draftkings",
            providerPlayerId: "qa-nov",
            playerIdentityConfidence: "LOW",
          },
        ],
      },
    }),
  ];
}

export function mergeTodayQaFixtures(board = {}, search) {
  if (!boardQaEnabled(search)) return board;
  if (!board || typeof board !== "object") return board;
  const propFixtures = todayQaPlayerPropGames();
  const gameFixtures = boardQaFixtureGames();
  const games = Array.isArray(board.games) ? board.games : [];
  const withoutDup = games.filter((g) => !String(g?.id || "").startsWith("qa-"));
  return {
    ...board,
    games: [...gameFixtures, ...propFixtures, ...withoutDup],
  };
}
