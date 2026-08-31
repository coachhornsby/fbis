import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  unwrapCfbdResponse,
  cfbdConfigured,
  cfbdPublicMeta,
  buildCfbdCatalog,
  buildCfbFeatureCatalog,
  mergePriorCatalog,
  loadCfbFeatureFeeds,
  loadCfbPrior,
  eloToPower,
  CFBD_ELO_CENTER,
  CFBD_ELO_PER_POINT,
} from "../functions/lib/cfbd.js";
import { CFB_PRIOR_VERSION, CFB_PRIOR_VERSION_CFBD, freezePrior, hasTeamSpecificPrior, priorForTeam } from "../functions/lib/cfbPrior.js";
import { projectCfbGame, cfbBettingAllowed, classifyCfbState, PROJECTION_STATES } from "../functions/lib/cfbModel.js";
import { freezeFromGame } from "../functions/lib/projLedger.js";
import { listTeams, enrichTeam } from "../functions/lib/teams.js";
import { recommendBundle } from "../functions/lib/slateEngine.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";
import { resetCacheMem } from "../functions/lib/cache.js";

const FAKE_KEY = "test-cfbd-key-not-real";

function jsonFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(routes)) {
      if (u.includes(needle)) {
        const status = body && body.__status ? body.__status : 200;
        const payload = body && body.__status ? { message: body.message || "error" } : body;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => payload,
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({ message: "not found" }) };
  };
}

describe("CFBD unwrap", () => {
  it("reads a bare array", () => {
    const { data } = unwrapCfbdResponse([{ team: "Alabama", rating: 28 }]);
    assert.equal(data.length, 1);
    assert.equal(data[0].team, "Alabama");
  });

  it("unwraps { data: [] } and { data: { items } }", () => {
    assert.equal(unwrapCfbdResponse({ data: [{ team: "A" }, { team: "B" }] }).data.length, 2);
    assert.equal(unwrapCfbdResponse({ meta: { asOf: "t" }, data: { items: [{ team: "A" }] } }).data.length, 1);
  });

  it("does not treat an error object as ratings", () => {
    const { data, error } = unwrapCfbdResponse({ message: "Unauthorized" });
    assert.equal(data, null);
    assert.equal(error, "Unauthorized");
  });
});

describe("CFBD missing key fail-soft", () => {
  it("reports configured false and keeps v1 fallback", async () => {
    resetCacheMem();
    assert.equal(cfbdConfigured({}), false);
    const loaded = await loadCfbPrior({});
    assert.equal(loaded.meta.configured, false);
    assert.equal(loaded.meta.fallback, true);
    assert.equal(loaded.version, CFB_PRIOR_VERSION);
    assert.ok(priorForTeam({ espnId: "194", name: "Ohio State" }, loaded.catalog));
    const dump = JSON.stringify(loaded);
    assert.equal(dump.includes("CFBD_API_KEY"), false);
    assert.equal(dump.includes("Bearer"), false);
  });
});

describe("CFBD 401 fallback", () => {
  it("falls back to ESPN FPI+SRS without inventing ratings", async () => {
    resetCacheMem();
    const fetchFn = jsonFetch({
      "/ratings/sp": { __status: 401, message: "Unauthorized" },
      "/ratings/fpi": { __status: 401, message: "Unauthorized" },
      "/ratings/srs": { __status: 401, message: "Unauthorized" },
      "/ratings/elo": { __status: 401, message: "Unauthorized" },
      "/talent": { __status: 401, message: "Unauthorized" },
      "/player/returning": { __status: 401, message: "Unauthorized" },
      "/teams": { __status: 401, message: "Unauthorized" },
    });
    const loaded = await loadCfbPrior({ CFBD_API_KEY: FAKE_KEY }, { fetchFn });
    assert.equal(loaded.meta.configured, true);
    assert.equal(loaded.meta.fallback, true);
    assert.equal(loaded.meta.httpStatus, 401);
    assert.equal(loaded.version, CFB_PRIOR_VERSION);
    const dump = JSON.stringify(loaded);
    assert.equal(dump.includes(FAKE_KEY), false);
    assert.equal(dump.includes("Bearer"), false);
  });
});

describe("CFBD ratings cover more than AP25", () => {
  it("builds team-specific priors for a full FBS sample, not a poll of 25", () => {
    const fbs = listTeams("cfb").filter((t) => t.classification === "FBS").slice(0, 40);
    assert.ok(fbs.length > 25);
    const sp = fbs.map((t, i) => ({
      year: 2025,
      team: t.school,
      rating: 20 - i * 0.4,
      offense: { rating: 38 - i * 0.3 },
      defense: { rating: 18 + i * 0.2, ranking: i + 1 },
    }));
    const built = buildCfbdCatalog({ sp, year: 2025, asOf: "2026-08-27T00:00:00.000Z" });
    assert.ok(built.nTeams > 25);
    assert.ok(built.fbs > 25);
    const osu = priorForTeam({ espnId: "194", name: "Ohio State" });
    const uab = priorForTeam({ espnId: "5", name: "UAB" });
    assert.ok(hasTeamSpecificPrior(osu));
    assert.ok(hasTeamSpecificPrior(uab));
    const merged = mergePriorCatalog(built);
    assert.ok(Object.keys(merged.byEspnId).length > 25);
    const cfbdOsu = merged.byEspnId["194"] || priorForTeam({ espnId: "194" }, merged);
    assert.ok(cfbdOsu);
    assert.ok(hasTeamSpecificPrior(cfbdOsu));
  });
});

describe("CFBD freeze stores prior fields", () => {
  it("freezes version, source, asOf, and CFBD ratings on the snapshot", () => {
    const asOf = "2026-08-27T12:00:00.000Z";
    const catalog = mergePriorCatalog(
      buildCfbdCatalog({
        sp: [
          { team: "Ohio State", rating: 26.1, offense: { rating: 42.2 }, defense: { rating: 14.8, ranking: 2 } },
          { team: "Michigan", rating: 18.4, offense: { rating: 36.1 }, defense: { rating: 17.9, ranking: 8 } },
        ],
        fpi: [
          { team: "Ohio State", fpi: 24.2 },
          { team: "Michigan", fpi: 16.1 },
        ],
        srs: [
          { team: "Ohio State", rating: 22.0 },
          { team: "Michigan", rating: 15.5 },
        ],
        elo: [
          { team: "Ohio State", elo: 2100 },
          { team: "Michigan", elo: 1850 },
        ],
        talent: [{ school: "Ohio State", talent: 980 }],
        returning: [{ team: "Ohio State", percentPPA: 0.62 }],
        teams: [
          { school: "Ohio State", classification: "fbs" },
          { school: "Michigan", classification: "fbs" },
        ],
        year: 2025,
        asOf,
      })
    );
    const proj = projectCfbGame(
      { home: { name: "Ohio State", espnId: "194" }, away: { name: "Michigan", espnId: "130" } },
      { rankings: { byTeam: new Map() }, form: new Map(), catalog, priorMeta: catalog }
    );
    assert.equal(proj.priorVersion, CFB_PRIOR_VERSION_CFBD);
    assert.equal(proj.homeEst.priorFrozen.version, CFB_PRIOR_VERSION_CFBD);
    assert.equal(proj.homeEst.priorFrozen.sp, 26.1);
    assert.ok(proj.homeEst.priorFrozen.fpi != null);
    assert.ok(proj.homeEst.priorFrozen.srs != null);
    assert.ok(proj.homeEst.priorFrozen.elo != null);
    assert.equal(proj.homeEst.priorFrozen.asOf, asOf);
    assert.match(String(proj.homeEst.priorFrozen.source), /cfbd/);
    const frozen = freezeFromGame("2026-08-29", {
      id: "cfbd-1",
      sport: "cfb",
      start: new Date(Date.now() + 3 * 3600000).toISOString(),
      home: enrichTeam("cfb", { name: "Ohio State" }),
      away: enrichTeam("cfb", { name: "Michigan" }),
      model: { projHome: proj.home, projAway: proj.away, pHomeFinal: 0.6, layers: { score: 0.6 } },
      cfb: proj,
      quality: { score: proj.dataQuality, flags: proj.flags },
    });
    assert.equal(frozen.uncertainty.homePriorFrozen.version, CFB_PRIOR_VERSION_CFBD);
    assert.equal(frozen.uncertainty.homePriorFrozen.sp, 26.1);
    assert.equal(frozen.uncertainty.homePriorFrozen.asOf, asOf);
    const dump = JSON.stringify(frozen);
    assert.equal(dump.includes(FAKE_KEY), false);
    assert.equal(dump.includes("CFBD_API_KEY"), false);
    assert.equal(dump.includes("Bearer"), false);
    assert.ok(proj.home !== proj.away);
  });
});

describe("CFBD safety gates", () => {
  it("league-average-only still cannot qualify", () => {
    const proj = projectCfbGame(
      { home: { name: "A", abbr: "AAA" }, away: { name: "B", abbr: "BBB" } },
      { rankings: { byTeam: new Map() }, form: new Map() }
    );
    assert.equal(proj.projectionState, PROJECTION_STATES.LEAGUE_AVERAGE_ONLY);
    assert.equal(proj.bettingAllowed, false);
    const rec = recommendBundle(
      "cfb",
      {
        sport: "cfb",
        home: { name: "A" },
        away: { name: "B" },
        cfb: proj,
        odds: { spread: -24, total: 50, pinHomeMl: -200, pinAwayMl: 170, pinSpreadHomePrice: -110, pinSpreadAwayPrice: -110, pinOverPrice: -110, pinUnderPrice: -110 },
        model: { layers: { score: 0.9, market: 0.55 }, projMargin: 21, projTotal: 70 },
      },
      { layers: { score: 0.9, market: 0.55 }, projMargin: 21, projTotal: 70 },
      DEFAULT_WEIGHTS
    );
    assert.equal(rec.qualified, null);
    assert.equal(rec.blocked, true);
    assert.equal(cfbBettingAllowed(PROJECTION_STATES.LEAGUE_AVERAGE_ONLY, proj.homeEst, proj.awayEst), false);
    assert.equal(classifyCfbState(proj.homeEst, proj.awayEst), PROJECTION_STATES.LEAGUE_AVERAGE_ONLY);
  });

  it("marks FCS as provisional and does not invent Elo points without a documented scale", () => {
    assert.equal(eloToPower(CFBD_ELO_CENTER), 0);
    assert.equal(eloToPower(CFBD_ELO_CENTER + CFBD_ELO_PER_POINT), 1);
    const built = buildCfbdCatalog({
      srs: [{ team: "North Dakota State", rating: 12, classification: "fcs" }],
      teams: [{ school: "North Dakota State", classification: "fcs" }],
      year: 2025,
      asOf: "2026-08-27T00:00:00.000Z",
    });
    const row = Object.values(built.byEspnId)[0];
    assert.ok(row);
    assert.equal(row.classification, "FCS");
    assert.equal(row.provisional, true);
    const frozen = freezePrior(row, { version: CFB_PRIOR_VERSION_CFBD, asOf: row.asOf });
    assert.equal(frozen.classification, "FCS");
    assert.equal(frozen.provisional, true);
    assert.equal(JSON.stringify(frozen).includes(FAKE_KEY), false);
  });
});

describe("CFBD public meta", () => {
  it("only exposes configured boolean, never a secret", () => {
    const meta = cfbdPublicMeta({
      configured: true,
      records: 134,
      asOf: "2026-08-27T00:00:00.000Z",
      CFBD_API_KEY: FAKE_KEY,
      Authorization: `Bearer ${FAKE_KEY}`,
    });
    assert.equal(meta.configured, true);
    assert.equal(meta.records, 134);
    const dump = JSON.stringify(meta);
    assert.equal(dump.includes(FAKE_KEY), false);
    assert.equal(dump.includes("Bearer"), false);
    assert.equal(dump.includes("CFBD_API_KEY"), false);
  });
});

describe("CFBD CFB feature feeds", () => {
  it("builds EPA/transfer/QB/coaching feature rows by team", () => {
    const catalog = buildCfbFeatureCatalog({
      year: 2026,
      asOf: "2026-08-28T00:00:00.000Z",
      epa: [
        { team: "Ohio State", offense: { overall: 0.31 }, defense: { overall: -0.12 } },
        { team: "Michigan", offense: { overall: 0.18 }, defense: { overall: -0.08 } },
      ],
      returning: [{ team: "Ohio State", percentPPA: 63 }],
      transfers: [
        { team: "Ohio State", direction: "incoming", position: "QB", stars: 4, playerId: "10", player: "Transfer Star" },
        { team: "Ohio State", direction: "incoming", position: "WR", stars: 3 },
        { team: "Michigan", direction: "outgoing", position: "QB", stars: 4 },
      ],
      qbHistory: [
        { playerId: "10", playerName: "Transfer Star", passingPpa: 0.29, successRate: 0.47, yardsPerAttempt: 8.4, gamesStarted: 12, passAttempts: 382 },
      ],
      coaches: [
        { team: "Ohio State", firstName: "Ryan", lastName: "Day", firstYear: 2019 },
        { team: "Michigan", firstName: "New", lastName: "Coach", firstYear: 2026 },
      ],
    });
    const osu = catalog.byEspnId["194"];
    const um = catalog.byEspnId["130"];
    assert.ok(osu);
    assert.ok(um);
    assert.equal(osu.epaNet, 0.43);
    assert.equal(osu.qbTransferNet, 1);
    assert.equal(osu.transferStarDelta, 7);
    assert.equal(osu.returningPct, 63);
    assert.equal(osu.qbPriorPpa, 0.29);
    assert.equal(osu.qbPriorYpa, 8.4);
    assert.equal(osu.qbPriorGamesStarted, 12);
    assert.equal(um.newCoach, true);
    assert.equal(um.qbTransferNet, -1);
  });

  it("loads feature feeds fail-soft without leaking secrets", async () => {
    resetCacheMem();
    const fetchFn = jsonFetch({
      "/ppa/teams": [
        { team: "Ohio State", offense: { overall: 0.28 }, defense: { overall: -0.09 } },
        { team: "Michigan", offense: { overall: 0.17 }, defense: { overall: -0.04 } },
      ],
      "/player/portal": [{ team: "Ohio State", direction: "incoming", position: "QB", stars: 5 }],
      "/coaches": [{ team: "Ohio State", firstYear: 2019, firstName: "Ryan", lastName: "Day" }],
      "/player/returning": [{ team: "Ohio State", percentPPA: 61 }],
      "/player/season/statistics": [{ playerId: "p1", player: "QB One", passingPpa: 0.25, yardsPerAttempt: 7.9 }],
    });
    const loaded = await loadCfbFeatureFeeds({ CFBD_API_KEY: FAKE_KEY }, { fetchFn, now: Date.parse("2026-08-28T12:00:00.000Z") });
    assert.equal(loaded.meta.configured, true);
    assert.ok(loaded.meta.endpoints.length >= 4);
    assert.ok(loaded.catalog.byEspnId["194"]);
    assert.equal(loaded.catalog.byEspnId["194"].qbTransferNet, 1);
    const dump = JSON.stringify(loaded);
    assert.equal(dump.includes(FAKE_KEY), false);
    assert.equal(dump.includes("Bearer"), false);
  });
});
