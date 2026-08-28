import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveTeam, enrichTeam, logoForCanonicalId, verifiedNflAbbr, verifiedCfbSchool, identityFromName, displayTeamIdentity, teamDisplayName } from "../functions/lib/teams.js";
import { namesMatch } from "../functions/lib/match.js";
import { attachMarketLabels, TEAM_MATCH_UNRESOLVED, isAmbiguousLastWord, canPriceMarket } from "../functions/lib/marketLabels.js";
import { projectCfbGame, buildCfbFeatureVector, classifyCfbState, cfbBettingAllowed, PROJECTION_STATES, CFB_BLOCKED_MESSAGE } from "../functions/lib/cfbModel.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";
import { duplicateProjectionDiagnostic, cfbSlateDiagnostics, cfbOosMetrics } from "../functions/lib/cfbDiagnostics.js";
import { hasTeamSpecificPrior, priorForTeam, CFB_PRIOR_VERSION } from "../functions/lib/cfbPrior.js";
import { freezeFromGame } from "../functions/lib/projLedger.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";

function labeledGame(homeQuery, awayQuery, extras = {}) {
  const home = enrichTeam("cfb", homeQuery);
  const away = enrichTeam("cfb", awayQuery);
  return attachMarketLabels({
    sport: "cfb",
    home,
    away,
    odds: {
      spread: extras.spread ?? -7,
      pinSpread: extras.spread ?? -7,
      pinSpreadHomePrice: -110,
      pinSpreadAwayPrice: -110,
      pinHomeMl: extras.homeMl ?? -179,
      pinAwayMl: extras.awayMl ?? 155,
      pinTotal: extras.total ?? 54.5,
      pinOverPrice: -110,
      pinUnderPrice: -110,
      homeBookName: extras.homeBook,
      awayBookName: extras.awayBook,
    },
  });
}

describe("TEAM IDENTITY", () => {
  it("uses verified NFL abbreviations, not initials", () => {
    const cases = [
      ["Pittsburgh Steelers", "PIT"],
      ["Buffalo Bills", "BUF"],
      ["New England Patriots", "NE"],
      ["Carolina Panthers", "CAR"],
      ["San Francisco 49ers", "SF"],
      ["Las Vegas Raiders", "LV"],
      ["Washington Commanders", "WAS"],
      ["Baltimore Ravens", "BAL"],
      ["Jacksonville Jaguars", "JAX"],
      ["New York Giants", "NYG"],
      ["New York Jets", "NYJ"],
      ["Tampa Bay Buccaneers", "TB"],
      ["Los Angeles Rams", "LAR"],
      ["Los Angeles Chargers", "LAC"],
    ];
    for (const [name, abbr] of cases) {
      assert.equal(verifiedNflAbbr(name), abbr, name);
      const row = enrichTeam("nfl", { name });
      assert.equal(row.abbr, abbr, name);
      const invented = name.split(" ").map((p) => p[0]).join("").slice(0, 3).toUpperCase();
      if (invented !== abbr) assert.notEqual(row.abbr, invented, name);
    }
  });

  it("keeps full college school names for State / Tech / Forest", () => {
    const schools = [
      "Sacramento State",
      "Eastern Michigan",
      "Jacksonville State",
      "North Dakota State",
      "NC State",
      "Kansas State",
      "Colorado State",
      "Georgia Tech",
      "Louisiana Tech",
      "Texas Tech",
      "Virginia Tech",
      "Wake Forest",
    ];
    for (const school of schools) {
      const hit = resolveTeam("cfb", { name: school });
      assert.ok(hit, school);
      assert.equal(verifiedCfbSchool(school), hit.school);
      assert.match(hit.school, new RegExp(school.split(" ")[0], "i"));
      assert.notEqual(hit.school, "State");
      assert.notEqual(hit.school, "Tech");
      assert.notEqual(hit.school, "Forest");
    }
  });

  it("does not collapse NC State onto another State school", () => {
    const nc = resolveTeam("cfb", { name: "NC State" });
    const ksu = resolveTeam("cfb", { name: "Kansas State" });
    const jsu = resolveTeam("cfb", { name: "Jacksonville State" });
    const sac = resolveTeam("cfb", { name: "Sacramento State" });
    const ndsu = resolveTeam("cfb", { name: "North Dakota State" });
    const csu = resolveTeam("cfb", { name: "Colorado State" });
    assert.ok(nc && ksu && jsu && sac && ndsu && csu);
    const ids = new Set([nc.id, ksu.id, jsu.id, sac.id, ndsu.id, csu.id]);
    assert.equal(ids.size, 6);
    assert.equal(namesMatch("NC State", "Kansas State"), false);
    assert.equal(namesMatch("Jacksonville State", "Sacramento State"), false);
  });

  it("does not collapse Tech schools", () => {
    const gt = resolveTeam("cfb", { name: "Georgia Tech" });
    const lt = resolveTeam("cfb", { name: "Louisiana Tech" });
    const ttu = resolveTeam("cfb", { name: "Texas Tech" });
    const vt = resolveTeam("cfb", { name: "Virginia Tech" });
    assert.equal(new Set([gt.id, lt.id, ttu.id, vt.id]).size, 4);
    assert.equal(namesMatch("Georgia Tech", "Texas Tech"), false);
  });

  it("separates New York and Los Angeles NFL clubs", () => {
    assert.equal(verifiedNflAbbr("New York Giants"), "NYG");
    assert.equal(verifiedNflAbbr("New York Jets"), "NYJ");
    assert.equal(verifiedNflAbbr("Los Angeles Rams"), "LAR");
    assert.equal(verifiedNflAbbr("Los Angeles Chargers"), "LAC");
    assert.notEqual(resolveTeam("nfl", { name: "New York Giants" }).id, resolveTeam("nfl", { name: "New York Jets" }).id);
  });

  it("maps ESPN and Pinnacle names onto the same canonical id", () => {
    const espn = resolveTeam("nfl", { espnId: "23" });
    const pin = resolveTeam("nfl", { name: "Pittsburgh Steelers" });
    assert.equal(espn.id, pin.id);
    assert.equal(espn.abbr, "PIT");
    const ncsu = resolveTeam("cfb", { espnId: "152" });
    const parlay = resolveTeam("cfb", { name: "NC State Wolfpack" });
    assert.equal(ncsu.id, parlay.id);
  });

  it("unresolved participants fail closed", () => {
    const miss = enrichTeam("nfl", { name: "Springfield Atoms" });
    assert.equal(miss.canonicalId, null);
    assert.equal(miss.matchStatus, "unresolved");
    assert.equal(resolveTeam("cfb", { name: "State" }), null);
    assert.equal(resolveTeam("cfb", { name: "Tech" }), null);
    assert.equal(resolveTeam("cfb", { name: "Forest" }), null);
  });

  it("resolves Hawaii and Miami Ohio without collapsing Miami (FL)", () => {
    const haw = resolveTeam("cfb", { name: "Hawaii" });
    const hawOkina = resolveTeam("cfb", { name: "Hawai'i" });
    assert.ok(haw);
    assert.equal(haw.id, hawOkina.id);
    assert.equal(haw.abbr, "HAW");
    const moh = resolveTeam("cfb", { name: "Miami Ohio" });
    const mia = resolveTeam("cfb", { name: "Miami" });
    assert.ok(moh);
    assert.ok(mia);
    assert.notEqual(moh.id, mia.id);
    assert.equal(moh.espnId, "193");
    assert.equal(mia.espnId, "2390");
  });
});

describe("LOGOS", () => {
  it("selects logos by canonical ID, not fuzzy names", () => {
    const pit = logoForCanonicalId("nfl-23");
    const sf = logoForCanonicalId("nfl-25");
    assert.ok(pit.logo.includes("pit") || pit.logo.includes("23"));
    assert.notEqual(pit.logo, sf.logo);
    const nc = logoForCanonicalId(resolveTeam("cfb", { name: "NC State" }).id);
    const ksu = logoForCanonicalId(resolveTeam("cfb", { name: "Kansas State" }).id);
    assert.notEqual(nc.logo, ksu.logo);
    assert.match(nc.name, /NC State/i);
  });

  it("uses full team name for alt text and has a fallback badge abbr", () => {
    const row = enrichTeam("nfl", { name: "Buffalo Bills" });
    assert.equal(row.fullName, "Buffalo Bills");
    assert.equal(row.abbr, "BUF");
    assert.ok(row.logo);
    const miss = enrichTeam("nfl", { name: "No Such Club" });
    assert.equal(miss.logo === "" || miss.canonicalId == null, true);
    assert.ok(miss.abbr === "—" || miss.matchStatus === "unresolved");
  });

  it("similar names do not share the wrong logo", () => {
    const rams = enrichTeam("nfl", { name: "Los Angeles Rams" });
    const chargers = enrichTeam("nfl", { name: "Los Angeles Chargers" });
    assert.notEqual(rams.canonicalId, chargers.canonicalId);
    assert.notEqual(rams.logo, chargers.logo);
  });
});

describe("MARKET LABELS", () => {
  it("prints the exact full school on each spread side", () => {
    const g = labeledGame({ name: "North Dakota State" }, { name: "Jacksonville State" }, { spread: -7 });
    assert.equal(g.marketLabels.ok, true);
    assert.match(g.marketLabels.spreadHome.label, /North Dakota State -7/);
    assert.match(g.marketLabels.spreadAway.label, /Jacksonville State \+7/);
    assert.equal(isAmbiguousLastWord("State"), true);
    assert.ok(!isAmbiguousLastWord("North Dakota State"));
  });

  it("keeps opposite spread points and same total points", () => {
    const g = labeledGame({ name: "Georgia Tech" }, { name: "Wake Forest" }, { spread: -6.5, total: 54.5 });
    assert.equal(g.marketLabels.spreadHome.point, -6.5);
    assert.equal(g.marketLabels.spreadAway.point, 6.5);
    assert.equal(g.marketLabels.totalOver.label, "Over 54.5");
    assert.equal(g.marketLabels.totalUnder.label, "Under 54.5");
    assert.match(g.marketLabels.mlHome.label, /Georgia Tech/);
    assert.match(g.marketLabels.spreadHome.label, /Georgia Tech/);
    assert.ok(!/^Tech(?:\s|$)/.test(g.marketLabels.spreadHome.label.replace(/Georgia Tech/, "")));
    assert.match(g.marketLabels.spreadAway.label, /Wake Forest/);
  });

  it("full NFL moneyline labels for LA clubs", () => {
    const home = enrichTeam("nfl", { name: "Los Angeles Rams" });
    const away = enrichTeam("nfl", { name: "Los Angeles Chargers" });
    const g = attachMarketLabels({
      sport: "nfl",
      home,
      away,
      odds: { pinHomeMl: -179, pinAwayMl: 155 },
    });
    assert.match(g.marketLabels.mlHome.label, /Los Angeles Rams -179/);
    assert.match(g.marketLabels.mlAway.label, /Los Angeles Chargers \+155/);
  });

  it("unresolved market cannot calculate an edge", () => {
    const g = attachMarketLabels({
      sport: "cfb",
      home: { name: "State", abbr: "ST" },
      away: { name: "Tech", abbr: "TE" },
      odds: { spread: -7, pinSpread: -7, pinHomeMl: -110, pinAwayMl: -110 },
    });
    assert.equal(g.marketUnresolved, true);
    assert.equal(g.marketLabels.spreadHome.label, TEAM_MATCH_UNRESOLVED);
    assert.equal(g.marketLabels.spreadHome.price, null);
    assert.equal(canPriceMarket(g), false);
    const rec = recommendBundle("cfb", g, { layers: { market: 0.7 }, projMargin: 21, projTotal: 55 });
    assert.equal(rec.qualified, null);
    assert.equal(rec.blocked, true);
  });
});

describe("CFB SAFETY", () => {
  it("both teams missing team-specific inputs → LEAGUE_AVERAGE_ONLY", () => {
    const proj = projectCfbGame(
      { home: { name: "A", abbr: "AAA" }, away: { name: "B", abbr: "BBB" } },
      { rankings: { byTeam: new Map() }, form: new Map() }
    );
    assert.equal(proj.projectionState, PROJECTION_STATES.LEAGUE_AVERAGE_ONLY);
    assert.equal(proj.bettingAllowed, false);
    assert.equal(proj.blockReason, CFB_BLOCKED_MESSAGE);
    assert.ok(proj.flags.includes("league_average_only"));
    assert.ok(proj.flags.includes("home_team_prior_missing"));
    assert.ok(proj.flags.includes("away_team_prior_missing"));
  });

  it("league-average-only cannot qualify, show LOG, or create a strategy ticket", () => {
    const game = {
      sport: "cfb",
      home: { name: "A", abbr: "AAA" },
      away: { name: "B", abbr: "BBB" },
      odds: { spread: -24, total: 50, pinHomeMl: -200, pinAwayMl: 170, pinSpreadHomePrice: -110, pinSpreadAwayPrice: -110, pinOverPrice: -110, pinUnderPrice: -110, pinPresent: true },
      cfb: projectCfbGame({ home: { name: "A" }, away: { name: "B" } }, { rankings: { byTeam: new Map() }, form: new Map() }),
    };
    game.model = { layers: { score: 0.8, market: 0.55 }, projMargin: 21, projTotal: 70 };
    const rec = recommendBundle("cfb", game, game.model, DEFAULT_WEIGHTS);
    assert.equal(rec.qualified, null);
    assert.equal(rec.lean, null);
    assert.equal(rec.blocked, true);
    assert.equal(game.cfb.bettingAllowed, false);
  });

  it("classifies PRIOR_ONLY, PARTIAL, and COMPLETE", () => {
    const home = { name: "Ohio State", espnId: "194", rank: 1 };
    const away = { name: "Michigan", espnId: "130", rank: 8 };
    const priorOnly = projectCfbGame({ home, away }, { rankings: { byTeam: new Map() }, form: new Map() });
    assert.equal(priorOnly.projectionState, PROJECTION_STATES.PRIOR_ONLY);
    assert.equal(priorOnly.homeEst.teamSpecificPrior, true);
    const form = new Map([
      ["id:194", { games: 4, pointsFor: 140, pointsAgainst: 60 }],
      ["id:130", { games: 4, pointsFor: 120, pointsAgainst: 80 }],
    ]);
    const complete = projectCfbGame({ home, away }, { rankings: { byTeam: new Map() }, form });
    assert.equal(complete.projectionState, PROJECTION_STATES.COMPLETE);
    const partial = projectCfbGame(
      { home, away: { name: "Unknown FCS", abbr: "ZZZ" } },
      { rankings: { byTeam: new Map() }, form: new Map() }
    );
    assert.equal(partial.projectionState, PROJECTION_STATES.PARTIAL);
    assert.equal(cfbBettingAllowed(PROJECTION_STATES.PARTIAL, partial.homeEst, partial.awayEst), false);
    assert.equal(classifyCfbState(complete.homeEst, complete.awayEst), PROJECTION_STATES.COMPLETE);
  });

  it("applies feature vector adjustments for EPA/transfer/QB/coaching", () => {
    const featureCatalog = {
      byEspnId: {
        "194": { espnId: "194", school: "Ohio State", epaNet: 0.35, transferNet: 6, qbTransferNet: 1, transferStarDelta: 8, coachTenure: 6, newCoach: false, returningPct: 63 },
        "130": { espnId: "130", school: "Michigan", epaNet: 0.12, transferNet: -2, qbTransferNet: -1, transferStarDelta: -3, coachTenure: 0, newCoach: true, returningPct: 49 },
      },
      bySchool: {},
    };
    const qbSignals = {
      "194": { starterKnown: true, starterName: "Elite Transfer", starterTransfer: true, starterClass: 4, qbDepth: 4 },
      "130": { starterKnown: true, starterName: "Freshman QB", starterTransfer: false, starterClass: 1, qbDepth: 3 },
    };
    const game = {
      home: { name: "Ohio State", espnId: "194", rank: 1 },
      away: { name: "Michigan", espnId: "130", rank: 8 },
    };
    const proj = projectCfbGame(game, { rankings: { byTeam: new Map() }, form: new Map(), featureCatalog, qbSignals });
    assert.ok(proj.homeEst.featureVector.used.includes("epa"));
    assert.ok(proj.homeEst.featureVector.used.includes("qb"));
    assert.ok(proj.homeEst.off > proj.homeEst.offBase);
    assert.ok(proj.awayEst.off < proj.awayEst.offBase);
    assert.equal(proj.features.summary.homeUsed.includes("transfer"), true);
    assert.equal(proj.flags.includes("feature_sparse"), false);
  });

  it("buildCfbFeatureVector fails soft when features are missing", () => {
    const fv = buildCfbFeatureVector({ name: "Unknown", espnId: "999999" }, { featureCatalog: { byEspnId: {}, bySchool: {} }, qbSignals: {} });
    assert.equal(Array.isArray(fv.missing), true);
    assert.ok(fv.missing.includes("epa_missing"));
    assert.equal(fv.used.length, 0);
    assert.equal(typeof fv.offAdj, "number");
    assert.equal(typeof fv.defAdj, "number");
  });

  it("duplicate-projection warning when an implausible share of the slate is identical", () => {
    const games = Array.from({ length: 10 }, (_, i) => ({
      cfb: { home: 27.8, away: 25.3 },
      id: String(i),
    }));
    games.push({ cfb: { home: 31, away: 17 }, id: "x" });
    const diag = duplicateProjectionDiagnostic(games);
    assert.equal(diag.warn, true);
    assert.match(diag.message, /CFB MODEL WARNING/);
    const slate = cfbSlateDiagnostics(games.map((g) => ({ ...g, projectionState: "LEAGUE_AVERAGE_ONLY", cfb: { ...g.cfb, projectionState: "LEAGUE_AVERAGE_ONLY", bettingAllowed: false } })));
    assert.equal(slate.leagueAverageOnly, 11);
  });

  it("does not invent a giant edge from the generic fallback", () => {
    const proj = projectCfbGame(
      { home: { name: "A" }, away: { name: "B" }, odds: { spread: -24, total: 45 } },
      { rankings: { byTeam: new Map() }, form: new Map() }
    );
    assert.equal(proj.bettingAllowed, false);
    const rec = recommendBundle(
      "cfb",
      { sport: "cfb", home: { name: "A" }, away: { name: "B" }, cfb: proj, odds: { spread: -24, total: 45 }, model: { layers: { score: 0.9 }, projMargin: 24, projTotal: 53 } },
      { layers: { score: 0.9 }, projMargin: 24, projTotal: 53 }
    );
    assert.equal(rec.qualified, null);
  });

  it("team-specific prior differentiates FBS clubs", () => {
    const osu = priorForTeam({ espnId: "194", name: "Ohio State" });
    const uab = priorForTeam({ espnId: "5", name: "UAB" });
    assert.ok(hasTeamSpecificPrior(osu));
    assert.ok(hasTeamSpecificPrior(uab));
    const a = projectCfbGame({ home: { name: "Ohio State", espnId: "194" }, away: { name: "UAB", espnId: "5" } }, { rankings: { byTeam: new Map() }, form: new Map() });
    const b = projectCfbGame({ home: { name: "UAB", espnId: "5" }, away: { name: "Ohio State", espnId: "194" } }, { rankings: { byTeam: new Map() }, form: new Map() });
    assert.notEqual(`${a.away}-${a.home}`, `${b.away}-${b.home}`);
    assert.ok(a.home > a.away);
    assert.equal(a.priorVersion, CFB_PRIOR_VERSION);
  });

  it("freezes projection state on the immutable snapshot", () => {
    const proj = projectCfbGame({ home: { name: "Ohio State", espnId: "194" }, away: { name: "Michigan", espnId: "130" } }, { rankings: { byTeam: new Map() }, form: new Map() });
    const frozen = freezeFromGame("2026-08-29", {
      id: "c1",
      sport: "cfb",
      start: new Date(Date.now() + 3 * 3600000).toISOString(),
      home: enrichTeam("cfb", { name: "Ohio State" }),
      away: enrichTeam("cfb", { name: "Michigan" }),
      model: { projHome: proj.home, projAway: proj.away, pHomeFinal: 0.6, layers: { score: 0.6 } },
      cfb: proj,
      quality: { score: proj.dataQuality, flags: proj.flags },
    });
    assert.equal(frozen.projectionState, PROJECTION_STATES.PRIOR_ONLY);
    assert.equal(frozen.uncertainty.projectionState, PROJECTION_STATES.PRIOR_ONLY);
    assert.ok(frozen.uncertainty.homePriorFrozen);
    const oos = cfbOosMetrics([]);
    assert.equal(oos.n, 0);
  });
});

describe("NFL", () => {
  it("market-implied score is labeled Pinnacle and cannot qualify", () => {
    const home = enrichTeam("nfl", { name: "Pittsburgh Steelers" });
    const away = enrichTeam("nfl", { name: "Buffalo Bills" });
    const game = {
      sport: "nfl",
      projectionKind: "PINNACLE_IMPLIED",
      home,
      away,
      marketProjHome: 23.5,
      marketProjAway: 20.75,
      odds: { spread: -3, total: 44, pinHomeMl: -150, pinAwayMl: 130, pinPresent: true },
      model: { layers: { market: 0.58 }, projHome: null, projAway: null, projMargin: null },
    };
    const rec = recommendBundle("nfl", game, game.model, DEFAULT_WEIGHTS);
    assert.equal(rec.qualified, null);
    assert.equal(rec.blocked, true);
    assert.match(rec.blockReason, /no independent NFL model/i);
    assert.equal(game.projectionKind, "PINNACLE_IMPLIED");
    assert.equal(game.model.projHome, null);
  });
});

describe("identityFromName", () => {
  it("resolves Heritage MLB and NFL paste names", () => {
    assert.equal(identityFromName("Los Angeles Dodgers").abbr, "LAD");
    assert.equal(identityFromName("Pittsburgh Steelers").abbr, "PIT");
    assert.match(identityFromName("Los Angeles Dodgers").logo, /espncdn\.com\/i\/teamlogos\/mlb\//);
    assert.match(identityFromName("Detroit Tigers").logo, /espncdn\.com\/i\/teamlogos\/mlb\//);
    assert.match(displayTeamIdentity(null, "Philadelphia Phillies").logo, /espncdn\.com\/i\/teamlogos\/mlb\//);
    assert.equal(displayTeamIdentity({ name: "x" }, "New York Yankees").abbr, "NYY");
  });

  it("prefers MLB display name over city-only school", () => {
    const dodgers = identityFromName("Los Angeles Dodgers");
    assert.equal(dodgers.name, "Los Angeles Dodgers");
    assert.equal(teamDisplayName(dodgers), "Los Angeles Dodgers");
    assert.notEqual(teamDisplayName(dodgers), dodgers.school);
  });
});
