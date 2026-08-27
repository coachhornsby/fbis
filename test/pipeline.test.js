import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unwrapPalResponse } from "../functions/lib/ballparkpal.js";
import { classifyCheckpoint, pickCanonical, materiallyChanged } from "../functions/lib/checkpoints.js";
import { accuracyOf, freezeFromGame, collectBoards, harvestAll } from "../functions/lib/projLedger.js";
import { seriesStats, buildAccuracyPack } from "../functions/lib/accuracyReport.js";
import { fetchParlayOdds } from "../functions/lib/parlay.js";
import { resetCacheMem } from "../functions/lib/cache.js";
import { todayCT } from "../functions/lib/slateEngine.js";

describe("Pal unwrap", () => {
  it("reads data.items so games are not dropped", () => {
    const { data, meta } = unwrapPalResponse({
      meta: { asOf: "2026-08-26T12:00:00Z", requestId: "abc" },
      data: { items: [{ gameId: 1 }, { gameId: 2 }] },
    });
    assert.equal(data.length, 2);
    assert.equal(meta.requestId, "abc");
  });
});

describe("checkpoints", () => {
  it("classifies close inside 45 minutes", () => {
    const start = new Date(Date.now() + 20 * 60000).toISOString();
    assert.equal(classifyCheckpoint({ start }, Date.now()), "CLOSE");
  });

  it("prefers CLOSE over EARLY as canonical", () => {
    const rows = [
      { date: "2026-08-26", id: "1", checkpoint: "EARLY", frozenAt: "a" },
      { date: "2026-08-26", id: "1", checkpoint: "CLOSE", frozenAt: "b" },
    ];
    assert.equal(pickCanonical(rows)[0].checkpoint, "CLOSE");
  });

  it("detects material projection changes", () => {
    assert.equal(materiallyChanged({ projHome: 4.7 }, { projHome: 5.2 }), true);
    assert.equal(materiallyChanged({ projHome: 4.7 }, { projHome: 4.7 }), false);
  });
});

describe("accuracy", () => {
  it("keeps calibration for home p below 50%", () => {
    const row = {
      projHome: 4,
      projAway: 5,
      actualHome: 3,
      actualAway: 6,
      actualTotal: 9,
      pHomeFinal: 0.42,
      impliedHome: 0.45,
    };
    const acc = accuracyOf([row]);
    assert.ok(acc.calibrationHome.some((b) => b.n === 1 && b.bucket.startsWith("40")));
    assert.ok(acc.calibration.some((b) => b.n === 1));
  });

  it("tracks score winner and probability winner separately", () => {
    const row = {
      projHome: 5.2,
      projAway: 3.8,
      actualHome: 6,
      actualAway: 4,
      actualTotal: 10,
      pHomeFinal: 0.42,
    };
    const acc = accuracyOf([row]);
    assert.equal(acc.winnerHitScore, 1);
    assert.equal(acc.winnerHitProb, 0);
  });

  it("reports within-X total accuracy", () => {
    const acc = accuracyOf([
      { projHome: 4.5, projAway: 4.2, actualHome: 5, actualAway: 4, actualTotal: 9 },
    ]);
    assert.equal(acc.withinTotal1, 1);
    assert.ok(acc.withinTotal05 != null);
  });

  it("does not treat zero bias as zero error", () => {
    const st = seriesStats(
      [
        { actual: 10, proj: 6 },
        { actual: 6, proj: 10 },
      ],
      true
    );
    assert.equal(st.bias, 0);
    assert.equal(st.mae, 4);
    assert.ok(st.medianAbs > 0);
  });

  it("compares Pal, proprietary, and ensemble", () => {
    const pack = buildAccuracyPack(
      [
        {
          projHome: 4.8,
          projAway: 3.9,
          palHome: 5.1,
          palAway: 3.6,
          actualHome: 5,
          actualAway: 4,
          pHomeFinal: 0.58,
          pScore: 0.57,
          pPal: 0.6,
          pMarket: 0.52,
        },
      ],
      { model: "ensemble", perGame: true }
    );
    const pal = pack.models.find((m) => m.key === "pal");
    const ens = pack.models.find((m) => m.key === "ensemble");
    assert.equal(pal.n, 1);
    assert.equal(ens.n, 1);
    assert.ok(pack.table.rows.some((r) => r.key === "total" && r.n === 1));
  });

  it("freezes Pal runs beside Savant", () => {
    const frozen = freezeFromGame("2026-08-26", {
      id: "9",
      sport: "mlb",
      home: { name: "Mets", abbr: "NYM" },
      away: { name: "Braves", abbr: "ATL" },
      venue: "Citi Field",
      homeSp: { name: "Kodai Senga" },
      model: { projHome: 4.1, projAway: 4.8, palHome: 3.9, palAway: 5.2, pHomeFinal: 0.44, layers: { pal: 0.41, score: 0.46 } },
      bpp: { homeRuns: 3.9, awayRuns: 5.2, lineupsOfficial: true, asOf: "now" },
    });
    assert.equal(frozen.palHome, 3.9);
    assert.equal(frozen.projHome, 4.1);
    assert.equal(frozen.park, "Citi Field");
    assert.equal(frozen.checkpoint, "LINEUP_CONFIRMED");
  });
});

describe("Parlay collect budget", () => {
  it("skips the network on cache-only collects", async () => {
    const r = await fetchParlayOdds("mlb", "fake-key", null, { cacheOnly: true });
    assert.equal(r.meta.skipped, true);
    assert.equal(r.events.length, 0);
  });
});

describe("collect and harvest fail honestly", () => {
  function emptySlate(sport, date, extra = {}) {
    return {
      sport,
      date,
      games: extra.games || [],
      parlay: extra.parlay || { enabled: true },
      pal: { meta: { enabled: false } },
    };
  }

  it("does not stamp success when ESPN/scoreboard collection throws", async () => {
    const out = await collectBoards(
      {},
      {
        odds: "cache",
        buildSlateFn: async () => {
          throw new Error("ESPN 502");
        },
      }
    );
    assert.equal(out.status, "failed");
    assert.equal(out.ok, false);
    assert.equal(out.successful_at, null);
    assert.ok(out.errors.some((e) => /ESPN/.test(e)));
  });

  it("fails a full collect when Parlay errors", async () => {
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "full",
        buildSlateFn: async (sport, date) => emptySlate(sport, date, { parlay: { error: "credits" } }),
      }
    );
    assert.notEqual(out.status, "success");
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => /Parlay/.test(e)));
  });

  it("fails when D1 is unbound", async () => {
    const out = await collectBoards(
      {},
      { odds: "cache", buildSlateFn: async (sport, date) => emptySlate(sport, date) }
    );
    assert.equal(out.status, "failed");
    assert.equal(out.d1.bound, false);
    assert.equal(out.successful_at, null);
  });

  it("fails required writes when D1 rejects snapshots", async () => {
    const env = pipelineDb({ rejectWrites: true });
    const out = await collectBoards(env, {
      odds: "cache",
      buildSlateFn: async (sport, date) =>
        emptySlate(sport, date, {
          games: [
            {
              id: "1",
              sport,
              start: new Date(Date.now() + 3600000).toISOString(),
              status: { live: false, completed: false },
              home: { abbr: "HOM", name: "Home" },
              away: { abbr: "AWY", name: "Away" },
              model: { projHome: 4, projAway: 4, pHomeFinal: 0.5, layers: {} },
            },
          ],
        }),
    });
    assert.notEqual(out.status, "success");
    assert.ok(out.snapshots_failed > 0 || out.errors.length);
  });

  it("marks one-sport failure as partial", async () => {
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        buildSlateFn: async (sport, date) => {
          if (sport === "mlb") throw new Error("mlb down");
          return emptySlate(sport, date);
        },
      }
    );
    assert.equal(out.status, "partial");
    assert.equal(out.sports.filter((s) => !s.ok).length, 1);
    assert.equal(out.successful_at, null);
  });

  it("marks all-sport failure as failed", async () => {
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        buildSlateFn: async () => {
          throw new Error("all down");
        },
      }
    );
    assert.equal(out.status, "failed");
  });

  it("can collect and harvest one sport without touching the others", async () => {
    const seen = [];
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        sport: "mlb",
        buildSlateFn: async (sport, date) => {
          seen.push(sport);
          return emptySlate(sport, date);
        },
      }
    );
    assert.deepEqual([...new Set(seen)], ["mlb"]);
    assert.equal(out.status, "success");
    assert.equal(out.sports.length, 1);
    assert.equal(out.sports[0].sport, "mlb");

    const harvested = [];
    const harvest = await harvestAll(1, { DB: pipelineDb().DB }, {
      sport: "mlb",
      fetchResultsFn: async (sport) => {
        harvested.push(sport);
        return [];
      },
    });
    assert.deepEqual([...new Set(harvested)], ["mlb"]);
    assert.equal(harvest.sport, "mlb");
    assert.equal(harvest.status, "success");
  });

  it("can collect one football date without the four-day window", async () => {
    const days = [];
    const out = await collectBoards(
      { DB: pipelineDb().DB },
      {
        odds: "cache",
        sport: "cfb",
        dayOffset: 0,
        buildSlateFn: async (sport, date) => {
          days.push(date);
          return emptySlate(sport, date);
        },
      }
    );
    assert.equal(days.length, 1);
    assert.equal(out.status, "success");
  });

  it("idempotent rerun reports already-present snapshots", async () => {
    const env = pipelineDb();
    const slateFn = async (sport, date) =>
      emptySlate(sport, date, {
        games: [
          {
            id: "9",
            sport,
            start: new Date(Date.now() + 7200000).toISOString(),
            status: { live: false, completed: false },
            home: { abbr: "HOM", name: "Home" },
            away: { abbr: "AWY", name: "Away" },
            model: { projHome: 4.1, projAway: 3.9, pHomeFinal: 0.52, layers: {} },
          },
        ],
      });
    const first = await collectBoards(env, { odds: "cache", buildSlateFn: slateFn });
    const second = await collectBoards(env, { odds: "cache", buildSlateFn: slateFn });
    assert.equal(first.status, "success");
    assert.equal(second.status, "success");
    assert.ok(second.snapshots_already_present >= 1 || second.snapshots_inserted === 0);
  });

  it("harvest scoreboard failure is not success when games still need grading", async () => {
    resetCacheMem();
    const env = pipelineDb();
    const today = todayCT();
    env.caches = {
      async match() {
        return new Response(
          JSON.stringify({
            games: {
              [`${today}:1`]: {
                id: "1",
                sport: "mlb",
                date: today,
                actualHome: null,
                matchup: "AWY @ HOM",
              },
            },
          }),
          { headers: { "content-type": "application/json" } }
        );
      },
      async put() {},
    };
    const out = await harvestAll(1, env, {
      sport: "mlb",
      fetchResultsFn: async () => {
        throw new Error("scoreboard down");
      },
    });
    assert.notEqual(out.status, "success");
    assert.equal(out.ok, false);
    assert.equal(out.successful_at, null);
  });

  it("harvest with no open games succeeds when a scoreboard 403s", async () => {
    resetCacheMem();
    const out = await harvestAll(1, { DB: pipelineDb().DB }, {
      sport: "nba",
      fetchResultsFn: async () => {
        throw new Error("ESPN NBA 403");
      },
    });
    assert.equal(out.status, "success");
    assert.equal(out.ok, true);
  });
});

function pipelineDb({ rejectWrites = false } = {}) {
  const snaps = new Map();
  const meta = new Map();
  const jobs = [];
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (rejectWrites && sql.includes("INSERT")) {
                  throw new Error("D1 write rejected");
                }
                if (sql.includes("INSERT OR IGNORE") && sql.includes("prediction_snapshots")) {
                  const id = args[0];
                  if (!snaps.has(id)) {
                    snaps.set(id, { id });
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                if (sql.includes("store_meta")) {
                  meta.set(args[0], args[1]);
                  return { meta: { changes: 1 } };
                }
                if (sql.includes("job_runs")) {
                  jobs.push({ id: args[0], status: args[5] });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes("SELECT 1")) return { ok: 1 };
                if (sql.includes("job_runs")) return jobs.at(-1) || null;
                if (sql.includes("COUNT")) return { n: snaps.size };
                return null;
              },
              async all() {
                if (sql.includes("store_meta")) {
                  return { results: [...meta.entries()].map(([k, v]) => ({ k, v })) };
                }
                return { results: [] };
              },
            };
          },
        };
      },
    },
  };
}
