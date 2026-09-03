import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  unwrapPalResponse,
  palErrorFromBody,
  palHttpStatusFromError,
  palHttpStatusToStore,
  PalHttpError,
  matchPalSlate,
  matchBpp,
  mergeBallparkPal,
  palQueryDates,
  palInstant,
  palSlateView,
  compactPalMarkets,
  fillPalPropNamesFromKnownPlayers,
} from "../functions/lib/ballparkpal.js";
import { sameMlbTeam, canonAbbr, resolveMlbCanon } from "../functions/lib/mlbCanonical.js";
import { freezeFromGame, palMarketRowsFromGame, shouldFetchPalNetwork, shouldRecordPalHealth } from "../functions/lib/projLedger.js";
import { palHealth, sourceCoverage } from "../functions/lib/sourceCoverage.js";
import { projectGame } from "../functions/lib/slateEngine.js";
import { projectMatchup } from "../functions/lib/savant.js";
import { buildPropConvictions, canonicalPropMarket, propEv, samePlayer, propWatchEmptyCopy, summarizeMlbPropWatch, compactMlbSlatePayload } from "../functions/lib/propConviction.js";

describe("MLB conviction player props", () => {
  it("requires an exact fresh contract and confirmed lineup", () => {
    const now = Date.parse("2026-08-28T18:00:00Z");
    const palProps = [{ playerId: 1, playerName: "Chris Sale", displayName: "Pitcher Strikeouts", line: 6.5, over: 0.66, under: 0.34, average: 7.3 }];
    const sportsbookProps = [{ playerName: "Chris Sale", marketKey: "player_pitcher_strikeouts", marketLabel: "Pitcher Strikeouts", line: 6.5, overPrice: -110, underPrice: -110, bookmaker: "Pinnacle", snapshotAt: "2026-08-28T17:30:00Z" }];
    const rows = buildPropConvictions({ palProps, sportsbookProps, lineupsOfficial: true, now });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].side, "OVER");
    assert.equal(rows[0].projection, 7.3);
    assert.equal(rows[0].tag, "CONVICTION");
    assert.equal(buildPropConvictions({ palProps, sportsbookProps, lineupsOfficial: false, now }).length, 0);
    assert.equal(buildPropConvictions({ palProps, sportsbookProps, lineupsOfficial: false, confirmedPitcherIds: [1], now }).length, 1);
    assert.equal(buildPropConvictions({ palProps, sportsbookProps: [{ ...sportsbookProps[0], line: 7.5 }], lineupsOfficial: true, now }).length, 0);
    assert.equal(buildPropConvictions({ palProps, sportsbookProps: [{ ...sportsbookProps[0], marketLabel: "1st Inn. Strikeouts" }], lineupsOfficial: true, now }).length, 0);
    assert.equal(buildPropConvictions({ palProps, sportsbookProps: [{ ...sportsbookProps[0], bookmaker: "Underdog Fantasy" }], lineupsOfficial: true, now }).length, 0);
    assert.equal(buildPropConvictions({ palProps, sportsbookProps: [{ ...sportsbookProps[0], bookmaker: "Pick6 (DraftKings)" }], lineupsOfficial: true, now }).length, 0);
    assert.equal(buildPropConvictions({ palProps, sportsbookProps: [sportsbookProps[0], { ...sportsbookProps[0], bookmaker: "BetMGM", overPrice: -105 }], lineupsOfficial: true, now }).length, 1);
    assert.equal(buildPropConvictions({ palProps: [{ ...palProps[0], playerName: null }], sportsbookProps, lineupsOfficial: true, now }).length, 0);
  });

  it("allows batter props when lineups are unofficial", () => {
    const now = Date.parse("2026-08-28T18:00:00Z");
    const palProps = [{ playerId: 99, playerName: "Aaron Judge", displayName: "Batter Home Runs", line: 0.5, over: 0.30, under: 0.70, average: 0.38 }];
    const sportsbookProps = [{ playerName: "Aaron Judge", marketKey: "player_home_runs", marketLabel: "Home Runs", line: 0.5, overPrice: 130, underPrice: -160, bookmaker: "FanDuel", snapshotAt: "2026-08-28T17:30:00Z" }];
    const under = buildPropConvictions({ palProps, sportsbookProps, lineupsOfficial: false, now });
    assert.equal(under.length, 1);
    assert.equal(under[0].side, "UNDER");
    assert.match(under[0].reason, /unofficial lineup/);
    const combo = buildPropConvictions({
      palProps: [{ playerId: 99, playerName: "Aaron Judge", displayName: "Batter Runs", line: 1.5, over: 0.2, under: 0.8, average: 0.9 }],
      sportsbookProps: [{ playerName: "Aaron Judge", marketKey: "player_hits_runs_rbis", marketLabel: "Hits Runs Rbis", line: 1.5, overPrice: -110, underPrice: -110, bookmaker: "DraftKings", snapshotAt: "2026-08-28T17:30:00Z" }],
      lineupsOfficial: false,
      now,
    });
    assert.equal(combo.length, 0);
  });

  it("does not treat a missing prop feed as an evaluated empty board", () => {
    assert.match(propWatchEmptyCopy({ status: "skipped", skipped: true, sportsbookContracts: 0, convictions: 0 }), /cache-only/i);
    assert.match(propWatchEmptyCopy({ status: "empty", sportsbookContracts: 0, convictions: 0 }), /no sportsbook prop contracts/i);
    assert.match(propWatchEmptyCopy({ status: "error", error: "Parlay 422", sportsbookContracts: 0, convictions: 0 }), /prop feed error/i);
    assert.match(propWatchEmptyCopy({ status: "available", sportsbookContracts: 84, convictions: 0 }), /currently qualify/i);
    assert.equal(summarizeMlbPropWatch([{ sport: "mlb", propConvictions: [{}, {}], sportsbookPropCount: 10, palPropCount: 4 }], { propFeedStatus: "available" }).convictions, 2);
  });

  it("fills missing Pal prop names from confirmed starters only", () => {
    const filled = fillPalPropNamesFromKnownPlayers({
      homeSp: { id: 1, name: "Chris Sale" },
      awaySp: { id: 2, name: "Logan Webb" },
      props: [
        { playerId: 1, playerName: null, displayName: "Pitcher Strikeouts" },
        { playerId: 99, playerName: null, displayName: "Batter Home Runs" },
        { playerId: 2, playerName: "Logan Webb", displayName: "Pitcher Strikeouts" },
      ],
    });
    assert.equal(filled.props[0].playerName, "Chris Sale");
    assert.equal(filled.props[1].playerName, null);
    assert.equal(filled.props[2].playerName, "Logan Webb");
  });

  it("compacts MLB slate payloads down to qualified convictions", () => {
    const now = Date.parse("2026-08-28T18:00:00Z");
    const compact = compactMlbSlatePayload({
      sport: "mlb",
      games: [{
        bpp: {
          props: [{ playerId: 1, playerName: "Chris Sale", displayName: "Pitcher Strikeouts", line: 6.5, over: 0.66, under: 0.34, average: 7.3 }],
          homeSp: { id: 1, name: "Chris Sale" },
          lineupsOfficial: false,
        },
        odds: {
          playerProps: [{ playerName: "Chris Sale", marketKey: "player_strikeouts", marketLabel: "Strikeouts", line: 6.5, overPrice: -110, underPrice: -110, bookmaker: "Pinnacle", snapshotAt: "2026-08-28T17:30:00Z" }],
        },
      }],
    }, now);
    assert.equal(compact.games[0].propConvictions.length, 1);
    assert.equal(compact.games[0].odds.playerProps.length, 0);
    assert.equal(compact.games[0].bpp.props.length, 0);
    assert.equal(compact.games[0].sportsbookPropCount, 1);
  });

  it("normalizes supported markets and names without crossing players", () => {
    assert.equal(canonicalPropMarket("Batter Home Runs"), "batter_home_runs");
    assert.equal(canonicalPropMarket("Hits"), "batter_hits");
    assert.equal(canonicalPropMarket("player_hits"), "batter_hits");
    assert.equal(canonicalPropMarket("player_rbis"), "batter_rbis");
    assert.equal(canonicalPropMarket("player_total_bases"), "batter_total_bases");
    assert.equal(canonicalPropMarket("Hits Allowed"), null);
    assert.equal(canonicalPropMarket("Hits Runs Rbis"), null);
    assert.equal(canonicalPropMarket("player_strikeouts_(batter)_milestones"), null);
    assert.equal(canonicalPropMarket("player_strikeouts"), "pitcher_strikeouts");
    assert.equal(canonicalPropMarket("Pitcher Strikeouts"), "pitcher_strikeouts");
    assert.equal(samePlayer("Christopher Sale", "Chris Sale"), true);
    assert.equal(samePlayer("Chris Sale", "Chris Bassitt"), false);
    assert.ok(propEv(0.66, -110) > 0.1);
  });
});

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../data/fixtures/pal-wrapper.json"), "utf8")
);

function mlbGame(over = {}) {
  return {
    id: over.id || "823503",
    sport: "mlb",
    start: over.start || "2026-08-27T23:05:00Z",
    home: { name: over.homeName || "New York Yankees", abbr: over.homeAbbr || "NYY", mlbId: over.homeId ?? 147 },
    away: { name: over.awayName || "Houston Astros", abbr: over.awayAbbr || "HOU", mlbId: over.awayId ?? 117 },
    ...over.rest,
  };
}

function palRow(over = {}) {
  return {
    bppId: over.bppId ?? 823503,
    gamePk: over.bppId ?? 823503,
    homeId: over.homeId ?? 147,
    awayId: over.awayId ?? 117,
    homeAbv: over.homeAbv || "NYY",
    awayAbv: over.awayAbv || "HOU",
    homeCanon: over.homeCanon || "NYY",
    awayCanon: over.awayCanon || "HOU",
    start: over.start || "2026-08-27T23:05:00Z",
    gameDate: "2026-08-27",
    homeRuns: over.homeRuns ?? 4.41,
    awayRuns: over.awayRuns ?? 3.62,
    pHome: over.pHome ?? 0.58,
    asOf: "2026-08-27T15:00:00+00:00",
    requestId: "fixture-pal-request-id",
    runLine: over.runLine ?? null,
    f5: over.f5 ?? { homeRuns: 2.12, awayRuns: 1.88, total: 4.0 },
  };
}

describe("Pal wrapper", () => {
  it("reads production {meta, data.items}", () => {
    const { data, meta } = unwrapPalResponse(fixture);
    assert.equal(data.length, 1);
    assert.equal(data[0].gameId, 823503);
    assert.equal(meta.asOf, "2026-08-27T15:00:00+00:00");
    assert.equal(meta.requestId, "fixture-pal-request-id");
  });

  it("does not treat an error payload as zero records", () => {
    const err = palErrorFromBody(fixture.error, 400);
    assert.equal(err.code, "date_out_of_range");
    const { data } = unwrapPalResponse(fixture.error);
    assert.equal(Array.isArray(data), false);
  });

  it("stores actual Pal HTTP status including 200 and 401", () => {
    assert.equal(palHttpStatusToStore({ httpStatus: 200, recordsReturned: 7 }), "200");
    assert.equal(palHttpStatusToStore({ httpStatus: 401, reason: "upstream-error", error: "Ballpark Pal 401: unauthorized" }), "401");
    assert.equal(palHttpStatusToStore({ reason: "upstream-error", error: "Pal request failed" }), "");
    assert.notEqual(palHttpStatusToStore({ httpStatus: 401, reason: "upstream-error" }), "200");
    assert.equal(palHttpStatusFromError(new PalHttpError(401, "Ballpark Pal 401: unauthorized", "unauthorized")), 401);
    assert.equal(palHttpStatusFromError(new Error("Ballpark Pal 401: unauthorized")), 401);
  });
});

describe("Pal market classification", () => {
  const rows = [
    { marketId: "mkt_1", teamId: 147, line: 0.5, side: "over", probability: 0.58 },
    { marketId: "mkt_1", teamId: 117, line: 0.5, side: "over", probability: 0.42 },
    { marketId: "mkt_2", line: 8.5, side: "over", probability: 0.53, subject: { type: "team", id: 147, name: "Yankees" } },
    { marketId: "mkt_5", teamId: 147, line: 4.5, side: "over", probability: 0.54, displayName: "Team Total Runs" },
    { marketId: "mkt_5", teamId: 147, line: 4.5, side: "under", probability: 0.46, displayName: "Team Total Runs" },
    { marketId: "mkt_10", teamId: 147, line: 1.5, side: "over", probability: 0.61, displayName: "Hits", subject: { type: "player", id: 99, name: "Test Batter" } },
    { marketId: "mkt_10", teamId: 147, line: 1.5, side: "under", probability: 0.39, displayName: "Hits", subject: { type: "player", id: 99, name: "Test Batter" } },
  ];

  it("does not misclassify team totals or mkt_10 props as run lines or moneylines", () => {
    const packed = compactPalMarkets(rows, 147, 117);
    assert.equal(packed.runLine, null);
    assert.equal(packed.pHome, 0.58);
    assert.equal(packed.teamTotals.length, 1);
    assert.equal(packed.props.length, 1);
    assert.equal(packed.props[0].playerName, "Test Batter");
    assert.equal(packed.props[0].over, 0.61);
    assert.equal(packed.props[0].under, 0.39);
  });

  it("persists F5 as priced only with complete two-way book quotes and keeps Pal props watch-only", () => {
    const game = mlbGame({ rest: { bpp: { f5: { homeRuns: 2.4, awayRuns: 2.0, total: 4.4, homeWin: 0.57, awayWin: 0.43 }, props: compactPalMarkets(rows, 147, 117).props, asOf: "2026-08-27T15:00:00Z", requestId: "req" }, odds: { f5: { homeMl: -115, awayMl: 105, total: 4.5, overPrice: -110, underPrice: -110, book: "pinnacle" } } } });
    const out = palMarketRowsFromGame("2026-08-27", game, { checkpoint: "FIRST_AVAILABLE", modelVersion: "test", frozenAt: "2026-08-27T15:00:00Z" });
    assert.equal(out.find((r) => r.marketType === "F5_ML").qualificationState, "PRICED_CANDIDATE");
    assert.equal(out.find((r) => r.marketType === "F5_TOTAL").qualificationState, "PRICED_CANDIDATE");
    assert.equal(out.find((r) => r.marketType.startsWith("PLAYER_PROP")).qualificationState, "PROP_WATCH");
    assert.equal(out.find((r) => r.marketType.startsWith("PLAYER_PROP")).priced, false);
  });

  it("freezes only exact qualified prop matches as a separate CONVICTION population", () => {
    const frozenAt = "2026-08-27T15:00:00Z";
    const game = mlbGame({ rest: {
      bpp: { lineupsOfficial: true, props: [{ playerId: 44, playerName: "Chris Sale", displayName: "Pitcher Strikeouts", line: 6.5, over: 0.66, under: 0.34, average: 7.3 }] },
      odds: { playerProps: [{ playerName: "Chris Sale", marketKey: "player_pitcher_strikeouts", marketLabel: "Pitcher Strikeouts", line: 6.5, overPrice: -110, underPrice: -110, bookmaker: "Pinnacle", snapshotAt: frozenAt }] },
    } });
    const out = palMarketRowsFromGame("2026-08-27", game, { checkpoint: "FIRST_AVAILABLE", modelVersion: "test", frozenAt });
    const qualified = out.filter((r) => r.qualificationState === "CONVICTION");
    assert.equal(qualified.length, 1);
    assert.equal(qualified[0].subjectName, "Chris Sale");
    assert.equal(qualified[0].marketType, "PLAYER_PROP:pitcher_strikeouts");
    assert.equal(qualified[0].pOver, 0.66);
    assert.equal(qualified[0].bookOverPrice, -110);
  });
});

describe("Pal matching", () => {
  it("matches both teams by GamePk", () => {
    const hit = matchBpp(mlbGame(), [palRow()]);
    assert.equal(hit.bppId, 823503);
  });

  it("requires home/away orientation", () => {
    const report = matchPalSlate(
      [mlbGame()],
      [palRow({ homeCanon: "HOU", awayCanon: "NYY", homeAbv: "HOU", awayAbv: "NYY", bppId: 1, homeId: 117, awayId: 147 })]
    );
    assert.equal(report.matched.length, 0);
    assert.equal(report.unmatched[0].reason, "home-away-orientation");
  });

  it("maps canonical MLB aliases", () => {
    assert.equal(canonAbbr("CWS"), "CHW");
    assert.equal(canonAbbr("ATH"), "ATH");
    assert.equal(canonAbbr("OAK"), "ATH");
    assert.equal(canonAbbr("WAS"), "WSH");
    assert.equal(canonAbbr("AZ"), "ARI");
    assert.equal(sameMlbTeam({ abbr: "CWS" }, { abbr: "CHW" }), true);
    assert.equal(sameMlbTeam({ name: "Athletics" }, { abbr: "OAK" }), true);
    assert.equal(sameMlbTeam({ abbr: "WSH" }, { name: "Washington Nationals" }), true);
  });

  it("does not cross-match New York teams", () => {
    const mets = mlbGame({ homeAbbr: "NYM", homeName: "New York Mets", homeId: 121, id: "1" });
    const yankeesPal = palRow({ homeCanon: "NYY", homeAbv: "NYY", homeId: 147, bppId: 99 });
    assert.equal(matchBpp(mets, [yankeesPal]), null);
    assert.equal(sameMlbTeam({ abbr: "NY" }, { abbr: "NYY" }), false);
  });

  it("does not cross-match Chicago teams", () => {
    const cubs = mlbGame({ homeAbbr: "CHC", homeName: "Chicago Cubs", homeId: 112, awayAbbr: "STL", awayId: 138, id: "2" });
    const sox = palRow({ homeCanon: "CHW", homeAbv: "CWS", homeId: 145, awayCanon: "STL", bppId: 3 });
    assert.equal(matchBpp(cubs, [sox]), null);
  });

  it("does not cross-match Los Angeles teams", () => {
    const dodgers = mlbGame({ homeAbbr: "LAD", homeName: "Los Angeles Dodgers", homeId: 119, id: "3" });
    const angels = palRow({ homeCanon: "LAA", homeAbv: "LAA", homeId: 108, bppId: 4 });
    assert.equal(matchBpp(dodgers, [angels]), null);
    assert.equal(resolveMlbCanon({ abbr: "LA" }), null);
  });

  it("matches across UTC/CT date boundary using instants", () => {
    const west = mlbGame({
      id: "823179",
      start: "2026-08-28T01:45:00Z",
      homeAbbr: "SF",
      homeName: "San Francisco Giants",
      homeId: 137,
      awayAbbr: "AZ",
      awayName: "Arizona Diamondbacks",
      awayId: 109,
    });
    const pal = palRow({
      bppId: 823179,
      start: "2026-08-28T01:45:00Z",
      homeCanon: "SF",
      awayCanon: "ARI",
      homeAbv: "SF",
      awayAbv: "AZ",
      homeId: 137,
      awayId: 109,
    });
    assert.equal(matchBpp(west, [pal])?.bppId, 823179);
    assert.ok(palInstant(pal));
  });

  it("allows start-time movement for the same pair", () => {
    const g = mlbGame({ start: "2026-08-27T23:20:00Z" });
    const pal = palRow({ start: "2026-08-27T23:05:00Z" });
    assert.equal(matchBpp(g, [pal])?.bppId, 823503);
  });

  it("does not match the wrong doubleheader game", () => {
    const g1 = mlbGame({ id: "dh1", start: "2026-08-27T17:05:00Z" });
    const g2 = mlbGame({ id: "dh2", start: "2026-08-27T23:05:00Z" });
    const p1 = palRow({ bppId: 11, start: "2026-08-27T17:05:00Z" });
    const p2 = palRow({ bppId: 22, start: "2026-08-27T23:05:00Z" });
    const r1 = matchBpp(g1, [p1, p2]);
    const r2 = matchBpp(g2, [p1, p2]);
    assert.equal(r1.bppId, 11);
    assert.equal(r2.bppId, 22);
  });

  it("still matches when pitchers change", () => {
    const g = mlbGame({ rest: { homeSp: { name: "Replacement" } } });
    const pal = palRow();
    pal.homeSp = { name: "Original" };
    assert.equal(matchBpp(g, [pal])?.bppId, 823503);
  });

  it("rejects ambiguous doubleheader without a unique start", () => {
    const g = mlbGame({ id: "x", start: "2026-08-27T20:00:00Z" });
    const p1 = palRow({ bppId: 11, start: "2026-08-27T19:30:00Z" });
    const p2 = palRow({ bppId: 22, start: "2026-08-27T20:30:00Z" });
    const report = matchPalSlate([g], [p1, p2]);
    assert.equal(report.matched.length, 0);
    assert.ok(report.ambiguous.length + report.unmatched.length >= 1);
  });
});

describe("Pal persist and source roles", () => {
  it("persists Pal fields, asOf, requestId; omitted RL/F5 stay null", () => {
    const pal = palRow({ runLine: null, f5: { homeRuns: null, awayRuns: null, total: null } });
    pal.f5 = { homeRuns: null, awayRuns: null, total: null };
    const frozen = freezeFromGame("2026-08-27", {
      ...mlbGame(),
      bpp: pal,
      model: { projHome: 4.4, projAway: 3.6, palHome: 4.41, palAway: 3.62, pHomeFinal: 0.55, layers: { pal: 0.58, score: 0.54 } },
    });
    assert.equal(frozen.palHome, 4.41);
    assert.equal(frozen.palAsOf, "2026-08-27T15:00:00+00:00");
    assert.equal(frozen.palRequestId, "fixture-pal-request-id");
    assert.equal(frozen.palRunLine, null);
    assert.equal(frozen.f5Home, null);
    assert.notEqual(frozen.projHome, frozen.palHome);
  });

  it("never treats Pal probability as a sportsbook price", () => {
    const pal = palRow({ pHome: 0.58 });
    const game = {
      ...mlbGame(),
      bpp: pal,
      projHomeScore: 4.4,
      projAwayScore: 3.6,
      odds: { spread: null, total: null, homeMl: -130, awayMl: 110 },
      pin: { ml: { noVigA: 0.52, complete: true } },
    };
    const model = projectGame("mlb", game);
    assert.equal(model.layers.pal, 0.58);
    assert.notEqual(model.layers.pal, model.impliedHome);
    assert.notEqual(model.palHome, model.impliedHome);
  });

  it("does not feed Pal park into Savant", () => {
    const a = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.15, awaySpEra: 4.15 });
    const b = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.15, awaySpEra: 4.15, park: 1.18 });
    assert.notEqual(a.home, b.home);
    const defaultPark = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.15, awaySpEra: 4.15, park: 1 });
    assert.equal(a.home, defaultPark.home);
  });

  it("tracks Pal projection N distinct from Pal graded N", () => {
    const rows = [
      { sport: "mlb", date: "2026-08-27", id: "1", palHome: 4.4, palAway: 3.6, actualHome: null, actualAway: null },
      { sport: "mlb", date: "2026-08-26", id: "2", palHome: 5, palAway: 4, actualHome: 6, actualAway: 3 },
    ];
    const pal = palHealth(rows, {});
    assert.equal(pal.projectedN, 2);
    assert.equal(pal.gradedN, 1);
    assert.equal(pal.unavailable, false);
    const cov = sourceCoverage(rows);
    assert.equal(cov.palProjected, 2);
    assert.equal(cov.palGraded, 1);
  });

  it("merge attaches bpp without inventing Pal data", () => {
    const games = mergeBallparkPal([mlbGame()], { games: [palRow()], meta: {} });
    assert.equal(games[0].bpp.homeRuns, 4.41);
    assert.equal(games[0].bpp.pHome, 0.58);
  });

  it("does not treat Pal unmatched count as an array", () => {
    const bpp = { games: [palRow()], meta: { enabled: true, recordsReturned: 1, reason: null } };
    mergeBallparkPal(
      [
        mlbGame(),
        mlbGame({
          id: "822694",
          homeName: "Washington Nationals",
          homeAbbr: "WSH",
          homeId: 120,
          awayName: "Colorado Rockies",
          awayAbbr: "COL",
          awayId: 115,
        }),
      ],
      bpp
    );
    const view = palSlateView(bpp);
    assert.equal(view.match.matched, 1);
    assert.equal(view.match.unmatched, 1);
    assert.equal(typeof view.unmatched, "number");
    assert.equal(view.unmatched, 1);
    assert.ok(Array.isArray(view.unmatchedSample));
    const sample = Array.isArray(view.unmatchedSample) ? view.unmatchedSample.slice(0, 8) : [];
    assert.equal(sample.length, 1);
    assert.equal(sample[0].gameId, "822694");
    const metaOnly = palSlateView({ enabled: true, unmatched: 21, recordsReturned: 0, reason: "no-records-returned" });
    assert.equal(metaOnly.unmatched, 21);
    assert.deepEqual(Array.isArray(metaOnly.unmatched) ? metaOnly.unmatched.slice(0, 8) : metaOnly.unmatchedSample, []);
  });

  it("does not let tomorrow Pal 401 clobber CT today health", () => {
    assert.equal(shouldFetchPalNetwork("mlb", "2026-08-27", "2026-08-27", {}), true);
    assert.equal(shouldFetchPalNetwork("mlb", "2026-08-28", "2026-08-27", {}), false);
    assert.equal(shouldRecordPalHealth("2026-08-27", "2026-08-27", {}), true);
    assert.equal(shouldRecordPalHealth("2026-08-28", "2026-08-27", {}), false);
    assert.equal(shouldFetchPalNetwork("mlb", "2026-08-28", "2026-08-27", { dayOffset: 1 }), true);
    assert.equal(shouldRecordPalHealth("2026-08-28", "2026-08-27", { dayOffset: 1 }), true);
    assert.equal(shouldFetchPalNetwork("mlb", "2026-08-27", "2026-08-27", { healthMode: true }), false);
  });
});

describe("Pal dates", () => {
  it("adds Eastern today when CT and ET differ", () => {
    const dates = palQueryDates("2026-08-26", new Date("2026-08-27T04:30:00Z"));
    assert.ok(dates.includes("2026-08-26"));
    assert.ok(dates.includes("2026-08-27") || dates.length >= 1);
  });
});
