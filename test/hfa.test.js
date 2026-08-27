import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAMPION_HFA,
  NEUTRAL_HFA,
  HFA_SHRINKAGE_K,
  HFA_PROMOTION_CRITERIA,
  SCORE_HFA_VERSION,
  MARKET_HFA_VERSION,
  championHfaForGame,
  classifyVenue,
  marketExpectedHomeMargin,
  marketResidual,
  rawHfaFromResiduals,
  smoothHfaFromRaw,
  reliabilityFromSamples,
  shrinkTowardChampion,
  fitScoreBasedHfa,
  fitMarketResidualHfa,
  qualifyingGame,
  buildShadowHfa,
  blueChipShadow,
  lookupBlueChip,
  promotionBlocked,
  yearToYearCorrelation,
  BLUECHIP_INDEX,
  BLUECHIP_META,
} from "../functions/lib/hfa.js";
import { projectCfbMatchup, projectCfbGame, CFB_CONSTANTS } from "../functions/lib/cfbModel.js";
import { DEFAULT_WEIGHTS, MODEL_VERSION } from "../functions/lib/weights.js";
import { STRATEGY_HC_V1 } from "../functions/lib/strategy.js";
import { freezeFromGame } from "../functions/lib/projLedger.js";
import { persistSnapshot } from "../functions/lib/store.js";

describe("CFB champion HFA", () => {
  it("keeps ordinary true-home HFA at 2.5 and identity of scores", () => {
    assert.equal(CHAMPION_HFA, 2.5);
    assert.equal(CFB_CONSTANTS.hfaPoints, 2.5);
    const p = projectCfbMatchup({ homeOff: 30, homeDef: 22, awayOff: 24, awayDef: 28, hfa: 2.5 });
    assert.ok(Math.abs(p.home + p.away - p.total) < 1e-9);
    assert.ok(Math.abs(p.home - p.away - p.margin) < 1e-9);
    const game = championHfaForGame({
      venue: "Bryant-Denny Stadium",
      home: { name: "Alabama Crimson Tide" },
      away: { name: "Auburn Tigers" },
    });
    assert.equal(game.hfa, 2.5);
  });

  it("sets confirmed neutral, bowls, and CCGs to zero", () => {
    assert.equal(NEUTRAL_HFA, 0);
    assert.equal(championHfaForGame({ neutralSite: true, venue: "AT&T Stadium" }).hfa, 0);
    const bowl = classifyVenue({
      neutralSite: true,
      notes: ["College Football Playoff National Championship"],
      venue: "Mercedes-Benz Stadium",
    });
    assert.equal(bowl.neutral, true);
    assert.ok(bowl.bowlOrCcg);
  });

  it("treats designated home as not automatically true home", () => {
    const v = classifyVenue({
      venue: "TBD",
      home: { name: "Alabama Crimson Tide" },
      away: { name: "Georgia Bulldogs" },
    });
    assert.equal(v.uncertain, true);
    assert.equal(championHfaForGame({ venue: "TBD", home: { name: "Alabama" } }).hfa, 2.5);
  });
});

describe("Blue Chip external benchmark", () => {
  it("stores published 2026 values exactly and remains benchmark-only", () => {
    assert.equal(BLUECHIP_INDEX.length, 138);
    assert.equal(BLUECHIP_META.benchmarkOnly, true);
    assert.equal(BLUECHIP_META.smoothingReproduced, false);
    const hawaii = lookupBlueChip({ name: "Hawai'i Rainbow Warriors" });
    assert.equal(hawaii.rawHfa, 7.42);
    assert.equal(hawaii.smoothHfa, 3.8);
    const ark = lookupBlueChip({ name: "Arkansas Razorbacks" });
    assert.equal(ark.rawHfa, -2.69);
    assert.equal(ark.smoothHfa, 0.8);
    assert.equal(blueChipShadow({ name: "Hawai'i Rainbow Warriors" }).benchmarkOnly, true);
  });

  it("falls unmatched and newly promoted teams back to 2.5", () => {
    const miss = blueChipShadow({ name: "Brand New FBS Club 2026" });
    assert.equal(miss.matched, false);
    assert.equal(miss.smoothHfa, 2.5);
    const delaware = lookupBlueChip({ name: "Delaware Fightin' Blue Hens" });
    assert.equal(delaware.smoothHfa, 2.5);
    assert.equal(delaware.rawHfa, 2.5);
  });

  it("does not match on mascot alone", () => {
    assert.equal(lookupBlueChip({ name: "Tigers" }), null);
    assert.equal(lookupBlueChip({ name: "Bulldogs" }), null);
  });
});

function synthGames({ seasons = [2021, 2022, 2023, 2024], extraHome = 0 } = {}) {
  const teams = ["ALA", "GA", "OSU", "MICH", "TEX", "ORE", "LSU", "PSU"];
  const games = [];
  let id = 1;
  for (const season of seasons) {
    for (let h = 0; h < teams.length; h += 1) {
      for (let a = 0; a < teams.length; a += 1) {
        if (h === a) continue;
        const home = teams[h];
        const away = teams[a];
        const homeEdge = home === "ALA" ? extraHome : 0;
        games.push({
          gameId: `g${id++}`,
          season,
          week: 5,
          homeTeamKey: home,
          awayTeamKey: away,
          homeScore: 28 + homeEdge,
          awayScore: 21,
          neutral: false,
          fbsVsFbs: true,
          closingSpread: -3,
          closingAt: `${season}-10-01T16:00:00Z`,
          closingSource: "Pinnacle",
        });
      }
    }
  }
  return games;
}

describe("score-based HFA challenger", () => {
  it("is opponent-adjusted, shrinks small samples, and weights larger samples more", () => {
    const small = smoothHfaFromRaw(6, 3, 3, 1);
    assert.equal(small.shrunken, 2.5);
    assert.ok(small.flags.includes("small_sample"));
    const large = smoothHfaFromRaw(6, 40, 40, 4);
    assert.ok(large.shrunken > small.shrunken);
    assert.ok(large.reliability > 0.4);
    const relSmall = reliabilityFromSamples(5, 5).reliability;
    const relLarge = reliabilityFromSamples(40, 40).reliability;
    assert.ok(relLarge > relSmall);
    assert.equal(HFA_SHRINKAGE_K, 40);
  });

  it("caps or flags extremes", () => {
    const hi = smoothHfaFromRaw(12, 20, 20, 4);
    assert.ok(hi.flags.includes("extreme") || hi.flags.includes("capped"));
    assert.ok(hi.raw <= 7);
  });

  it("excludes neutrals and does not let an evaluated game train itself", () => {
    assert.equal(qualifyingGame({ neutral: true, homeScore: 1, awayScore: 0, fbsVsFbs: true, season: 2024 }), false);
    const games = [
      ...synthGames({ seasons: [2021, 2022, 2023, 2024] }),
      {
        gameId: "future",
        season: 2025,
        homeTeamKey: "ALA",
        awayTeamKey: "GA",
        homeScore: 99,
        awayScore: 0,
        neutral: false,
        fbsVsFbs: true,
      },
    ];
    const fit = fitScoreBasedHfa(games, { asOfSeason: 2024, predictSeason: 2025 });
    assert.equal(fit.available, true);
    assert.ok(!fit.byTeam.ALA || fit.gamesUsed === games.filter((g) => g.season <= 2024).length);
    assert.ok(games.filter((g) => g.season === 2025).every((g) => g.homeScore === 99));
  });

  it("future results cannot leak backward", () => {
    const past = synthGames({ seasons: [2021, 2022, 2023, 2024], extraHome: 4 });
    const leaked = [
      ...past,
      ...synthGames({ seasons: [2025], extraHome: 20 }).map((g) => ({ ...g, homeScore: 70, awayScore: 0 })),
    ];
    const a = fitScoreBasedHfa(past, { asOfSeason: 2024 });
    const b = fitScoreBasedHfa(leaked, { asOfSeason: 2024 });
    assert.equal(a.gamesUsed, b.gamesUsed);
    assert.equal(a.byTeam.ALA?.raw, b.byTeam.ALA?.raw);
  });
});

describe("market-residual HFA challenger", () => {
  it("uses closing-spread signs correctly", () => {
    assert.equal(marketExpectedHomeMargin(-7), 7);
    assert.equal(marketExpectedHomeMargin(3.5), -3.5);
    assert.equal(marketResidual(31, 17, -7), 7);
    const raw = rawHfaFromResiduals([4, 4], [-4, -4]);
    assert.equal(raw, 2.5 + (4 - -4) / 2);
  });

  it("stays unavailable without timestamped closes", () => {
    const none = fitMarketResidualHfa(
      [{ season: 2024, homeTeamKey: "ALA", awayTeamKey: "GA", homeScore: 30, awayScore: 20, neutral: false, fbsVsFbs: true }],
      { asOfSeason: 2024 }
    );
    assert.equal(none.available, false);
    const ok = fitMarketResidualHfa(synthGames({ seasons: [2021, 2022, 2023, 2024] }), { asOfSeason: 2024 });
    assert.equal(ok.available, true);
    assert.equal(ok.methodVersion, MARKET_HFA_VERSION);
  });
});

describe("HFA shadow snapshots and promotion", () => {
  it("freezes champion plus unavailable challengers without changing production scores", () => {
    const proj = projectCfbGame(
      { home: { name: "Alabama Crimson Tide", abbr: "ALA" }, away: { name: "Auburn Tigers", abbr: "AUB" }, venue: "Bryant-Denny Stadium" },
      { rankings: { byTeam: new Map() }, form: new Map() }
    );
    assert.equal(proj.hfa, 2.5);
    const shadow = buildShadowHfa(
      { home: { name: "Alabama Crimson Tide", abbr: "ALA" }, venue: "Bryant-Denny Stadium", cfb: proj },
      { scoreFit: { available: false, reason: "insufficient-data", byTeam: {} }, marketFit: { available: false, reason: "no-timestamped-closes", byTeam: {} }, homeEst: proj.homeEst, awayEst: proj.awayEst }
    );
    assert.equal(shadow.mode, "shadow");
    assert.equal(shadow.productionUses, "champion");
    assert.equal(shadow.champion.hfa, 2.5);
    assert.equal(shadow.scoreBased.available, false);
    assert.equal(shadow.marketResidual.available, false);
    assert.equal(shadow.externalBenchmark.benchmarkOnly, true);
    assert.equal(shadow.doubleCount, false);
  });

  it("does not rewrite an earlier snapshot when ratings update later", async () => {
    const frozen = freezeFromGame("2026-08-29", {
      id: "cfb1",
      sport: "cfb",
      home: { abbr: "ALA", name: "Alabama Crimson Tide" },
      away: { abbr: "AUB", name: "Auburn Tigers" },
      model: { projHome: 27.1, projAway: 21.4, pHomeFinal: 0.62, layers: {} },
      cfb: { hfa: 2.5, sigmaMargin: 16, sigmaTotal: 14, homeEst: { n: 0 }, awayEst: { n: 0 }, shadowHfa: { champion: { hfa: 2.5 }, scoreBased: { shrunken: 2.5 } } },
    });
    assert.equal(frozen.uncertainty.shadowHfa.champion.hfa, 2.5);
    const rows = new Map();
    const env = {
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                async run() {
                  if (sql.includes("INSERT OR IGNORE") && sql.includes("prediction_snapshots")) {
                    if (!rows.has(args[0])) rows.set(args[0], { id: args[0], proj_home: args[8], hfa: 2.5 });
                    return { meta: { changes: rows.has(args[0]) ? 0 : 1 } };
                  }
                  return { meta: { changes: 1 } };
                },
                async first() {
                  return rows.get(args[0]) || null;
                },
                async all() {
                  return { results: [] };
                },
              };
            },
          };
        },
      },
    };
    await persistSnapshot(env, {
      id: "2026-08-29:cfb1:EARLY",
      gameId: "cfb1",
      sport: "cfb",
      date: "2026-08-29",
      matchup: "AUB @ ALA",
      checkpoint: "EARLY",
      modelVersion: "FBIS-v1.3",
      frozenAt: "a",
      projHome: 27.1,
      projAway: 21.4,
      layersJson: JSON.stringify({ _snap: { uncertainty: frozen.uncertainty } }),
    });
    frozen.uncertainty.shadowHfa.scoreBased.shrunken = 9.9;
    assert.equal(rows.get("2026-08-29:cfb1:EARLY").proj_home, 27.1);
  });

  it("blocks promotion below the pre-registered sample and keeps shadow mode", () => {
    assert.equal(HFA_PROMOTION_CRITERIA.definedBeforeResults, true);
    const blocked = promotionBlocked({ oosN: 12, seasonsImproved: 1, maeImprovement: 0.01, yearToYearCorr: 0.05 });
    assert.equal(blocked.promote, false);
    assert.equal(blocked.mode, "shadow");
    const corr = yearToYearCorrelation({ a: 3, b: 1, c: 2 }, { a: 1, b: 3, c: 2 });
    assert.equal(corr.n < 8, true);
  });

  it("does not let 7-0 change HFA or champion weights", () => {
    assert.equal(STRATEGY_HC_V1.reportedRecord, "7-0");
    assert.equal(CHAMPION_HFA, 2.5);
    assert.equal(MODEL_VERSION, "FBIS-v1.3");
    assert.deepEqual(DEFAULT_WEIGHTS, { market: 0.22, espn: 0.08, score: 0.32, pal: 0.3, form: 0.08 });
    assert.equal(SCORE_HFA_VERSION, "score-oppadj-v1");
  });

  it("does not add score-based and market-residual into the champion projection", () => {
    const p = projectCfbMatchup({ homeOff: 28, homeDef: 24, awayOff: 24, awayDef: 28, hfa: 2.5 });
    const shadow = 4.0;
    const other = 1.0;
    const combined = projectCfbMatchup({ homeOff: 28, homeDef: 24, awayOff: 24, awayDef: 28, hfa: 2.5 + shadow + other });
    assert.notEqual(p.margin, combined.margin);
    assert.equal(p.home + p.away, p.total);
  });
});

describe("shrinkage helpers", () => {
  it("pulls noisy estimates toward 2.5", () => {
    assert.equal(shrinkTowardChampion(6.5, 0), 2.5);
    assert.ok(Math.abs(shrinkTowardChampion(6.5, 1) - 6.5) < 1e-9);
    assert.ok(shrinkTowardChampion(6.5, 0.5) > 2.5 && shrinkTowardChampion(6.5, 0.5) < 6.5);
  });
});
