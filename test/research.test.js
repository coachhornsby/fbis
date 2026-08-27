import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mae, rmse, bias, median, withinShare, withinBands } from "../functions/lib/metrics.js";
import { projectCfbMatchup, blendSeason, earlySeasonWeight, powerFromRank, cfbSigma } from "../functions/lib/cfbModel.js";
import { ticketMatchesStrategy, STRATEGY_HC_V1, characterizeTickets, strategyStats, packTicket, inSeedWindow, gradeStrategyResult } from "../functions/lib/strategy.js";
import { persistSnapshot, gradeSnapshot } from "../functions/lib/store.js";
import { classifyCheckpoint, pickCanonical, rowsForCheckpoint } from "../functions/lib/checkpoints.js";
import { projectMatchup } from "../functions/lib/savant.js";
import { expectedRoi, twoWayMarket, brierScore, logLoss, americanToImplied } from "../functions/lib/pricing.js";
import { gameOutcome, freezeFromGame, accuracyOf } from "../functions/lib/projLedger.js";
import { seriesStats } from "../functions/lib/accuracyReport.js";
import { overDiagnostics } from "../functions/lib/overDiagnostics.js";
import { SPORTS } from "../functions/lib/slateEngine.js";

describe("research metrics", () => {
  it("computes MAE RMSE bias median and within-X", () => {
    const errs = [1, -1, 2, -2];
    assert.equal(mae(errs), 1.5);
    assert.equal(rmse(errs), Math.sqrt(2.5));
    assert.equal(bias(errs), 0);
    assert.equal(median(errs), 0);
    assert.equal(withinShare(errs, 1), 0.5);
  });

  it("uses football bands not MLB 0.5 globally", () => {
    const cfb = withinBands([4, 8, 11], "cfb", "total");
    assert.ok(cfb.bands.some((b) => b.threshold === 7));
    assert.ok(!cfb.bands.some((b) => b.threshold === 0.5));
    const mlb = withinBands([0.4, 1.2], "mlb", "total");
    assert.ok(mlb.bands.some((b) => b.threshold === 0.5));
  });
});

describe("CFB score identity", () => {
  it("keeps home+away=total and home-away=margin", () => {
    const p = projectCfbMatchup({ homeOff: 30, homeDef: 22, awayOff: 24, awayDef: 28, hfa: 2.5 });
    assert.ok(Math.abs(p.home + p.away - p.total) < 1e-9);
    assert.ok(Math.abs(p.home - p.away - p.margin) < 1e-9);
  });

  it("does not let one game dominate the prior", () => {
    const w0 = earlySeasonWeight(0);
    const w1 = earlySeasonWeight(1);
    const b = blendSeason(26, 50, 1, 6);
    assert.equal(w0, 0);
    assert.ok(w1 < 0.2);
    assert.ok(b.value < 30);
  });

  it("ranks #1 above unranked", () => {
    assert.ok(powerFromRank(1) > powerFromRank(25));
    assert.equal(powerFromRank(null), 0);
  });

  it("widens sigma early", () => {
    const early = cfbSigma({ gamesHome: 0, gamesAway: 0 });
    const late = cfbSigma({ gamesHome: 12, gamesAway: 12 });
    assert.ok(early.margin > late.margin);
  });
});

describe("high-conviction strategy", () => {
  const base = {
    qualified: true,
    lean: false,
    ev: 0.09,
    tag: "CONVICTION",
    marketComplete: true,
    sport: "mlb",
    gameId: "1",
    market: "TOTAL",
    side: "OVER",
  };

  it("matches qualified CONVICTION only", () => {
    assert.equal(ticketMatchesStrategy(base), true);
    assert.equal(ticketMatchesStrategy({ ...base, qualified: false }), false);
    assert.equal(ticketMatchesStrategy({ ...base, lean: true }), false);
    assert.equal(ticketMatchesStrategy({ ...base, ev: 0.04, tag: "STANDARD" }), false);
    assert.equal(ticketMatchesStrategy({ ...base, ev: 0.03, tag: "LEAN" }), false);
  });

  it("does not treat an 8-0 sample as a model update", () => {
    assert.equal(STRATEGY_HC_V1.rules.minEv, 0.08);
    assert.match(STRATEGY_HC_V1.notes, /N=8/);
  });

  it("windows 2026-08-26 CT", () => {
    assert.equal(inSeedWindow("2026-08-26T18:00:00-05:00"), true);
    assert.equal(inSeedWindow("2026-08-25T12:00:00-05:00"), false);
  });

  it("characterizes shared traits and always shows N", () => {
    const traits = characterizeTickets([
      { ...base, sport: "mlb", market: "TOTAL", side: "OVER", ev: 0.09 },
      { ...base, sport: "mlb", market: "TOTAL", side: "OVER", ev: 0.11, gameId: "2" },
    ]);
    assert.equal(traits.n, 2);
    assert.equal(traits.sports.mlb, 2);
    assert.equal(traits.markets.TOTAL, 2);
  });

  it("reports strategy stats without claiming the filter works", () => {
    const st = strategyStats([
      { result: "WON", profit: 0.91, ev: 0.09, clv: 1.2 },
      { result: "WON", profit: 0.91, ev: 0.1, clv: 0.4 },
    ]);
    assert.equal(st.n, 2);
    assert.equal(st.wins, 2);
    assert.equal(st.hitRate, 1);
  });

  it("grades a total against a final", () => {
    const packed = packTicket({ ...base, line: 8.5, pinPrice: -110, date: "2026-08-26" }, { role: "seed", date: "2026-08-26" });
    const g = gradeStrategyResult(packed, { home: { score: 6 }, away: { score: 5 }, status: { completed: true } });
    assert.equal(g.result, "WON");
  });
});

describe("snapshot immutability", () => {
  it("INSERT OR IGNORE keeps the first projection", async () => {
    const rows = new Map();
    const env = mockDb(rows);
    const first = snapRow({ projHome: 4.4, frozenAt: "a" });
    const second = snapRow({ projHome: 9.9, frozenAt: "b" });
    await persistSnapshot(env, first);
    await persistSnapshot(env, second);
    assert.equal(rows.get(first.id).proj_home, 4.4);
  });

  it("grades actuals without rewriting the projection", async () => {
    const rows = new Map();
    const env = mockDb(rows);
    await persistSnapshot(env, snapRow({ projHome: 4.4 }));
    await gradeSnapshot(env, { id: "2026-08-26:1:CLOSE", actualHome: 5, actualAway: 3, gradedAt: "now" });
    const row = rows.get("2026-08-26:1:CLOSE");
    assert.equal(row.proj_home, 4.4);
    assert.equal(row.actual_home, 5);
    await gradeSnapshot(env, { id: "2026-08-26:1:CLOSE", actualHome: 99, actualAway: 99, gradedAt: "later" });
    assert.equal(rows.get("2026-08-26:1:CLOSE").actual_home, 5);
  });
});

describe("FIRST_AVAILABLE alias", () => {
  it("maps missing FIRST_AVAILABLE to the earliest checkpoint", () => {
    const rows = [
      { date: "2026-08-26", id: "1", checkpoint: "EARLY" },
      { date: "2026-08-26", id: "1", checkpoint: "CLOSE" },
    ];
    assert.equal(rowsForCheckpoint(rows, "FIRST_AVAILABLE")[0].checkpoint, "EARLY");
    assert.equal(pickCanonical(rows)[0].checkpoint, "CLOSE");
  });

  it("classifies close inside 45 minutes", () => {
    const start = new Date(Date.now() + 20 * 60000).toISOString();
    assert.equal(classifyCheckpoint({ start }, Date.now()), "CLOSE");
  });
});

describe("MLB over investigation regressions", () => {
  it("does not feed Pal park into Savant", () => {
    const a = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.15, awaySpEra: 4.15 });
    const b = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.15, awaySpEra: 4.15, park: 1.08 });
    assert.notEqual(a.home, b.home);
    const defaultPark = projectMatchup({ homeRpg: 4.5, awayRpg: 4.5, homeSpEra: 4.15, awaySpEra: 4.15 });
    assert.equal(defaultPark.home, a.home);
  });

  it("does not invent Pal run-line when the API omitted it", () => {
    const frozen = freezeFromGame("2026-08-26", {
      id: "1",
      sport: "mlb",
      home: { abbr: "NYY" },
      away: { abbr: "BOS" },
      model: { projHome: 4.2, projAway: 4.1, palHome: 4.0, palAway: 4.1, pHomeFinal: 0.5, layers: {} },
      bpp: { homeRuns: 4.0, awayRuns: 4.1, totals: { "8.5": { over: 0.51, under: 0.49 } } },
    });
    assert.equal(frozen.palRunLine, null);
    assert.ok(frozen.palTotals["8.5"]);
  });

  it("keeps MLB candidate threshold at 0.35 runs and does not lower totals", () => {
    assert.equal(SPORTS.mlb.minSpreadEdge, 0.35);
  });

  it("bucket diagnostics always include N", () => {
    const d = overDiagnostics([
      { projHome: 5, projAway: 5, actualHome: 4, actualAway: 4, pinTotal: 8.5 },
      { projHome: 4, projAway: 4, actualHome: 5, actualAway: 5, pinTotal: 9.5 },
    ]);
    assert.ok(d.buckets.every((b) => typeof b.n === "number"));
  });
});

describe("harvest outcomes", () => {
  it("does not grade postponements as 0-0", () => {
    assert.equal(gameOutcome({ status: { detail: "Postponed", completed: false } }), "POSTPONED");
    const row = freezeFromGame("2026-08-26", {
      id: "1",
      sport: "mlb",
      home: { abbr: "NYY" },
      away: { abbr: "BOS" },
      model: { projHome: 4, projAway: 4, pHomeFinal: 0.5, layers: {} },
    });
    assert.equal(row.projHome, 4);
  });
});

describe("pricing still holds", () => {
  it("no-vig EV Brier logloss", () => {
    const m = twoWayMarket(-110, -110);
    assert.equal(m.complete, true);
    assert.ok(expectedRoi(0.55, -110) > 0);
    assert.ok(brierScore(0.7, 1) < 0.1);
    assert.ok(logLoss(0.7, 1) > 0);
    assert.ok(americanToImplied(-110) > 0.5);
  });

  it("seriesStats does not treat zero bias as zero error", () => {
    const st = seriesStats([{ actual: 10, proj: 6 }, { actual: 6, proj: 10 }], true);
    assert.equal(st.bias, 0);
    assert.equal(st.mae, 4);
  });

  it("accuracy includes home p below 50%", () => {
    const acc = accuracyOf([{ projHome: 4, projAway: 5, actualHome: 3, actualAway: 6, actualTotal: 9, pHomeFinal: 0.42 }]);
    assert.ok(acc.calibrationHome.some((b) => b.n === 1));
  });
});

function snapRow(extra) {
  return {
    id: "2026-08-26:1:CLOSE",
    gameId: "1",
    sport: "mlb",
    date: "2026-08-26",
    matchup: "BOS @ NYY",
    checkpoint: "CLOSE",
    modelVersion: "FBIS-v1.3",
    frozenAt: "a",
    projHome: 4.4,
    projAway: 3.9,
    projTotal: 8.3,
    projMargin: 0.5,
    layersJson: "{}",
    ...extra,
  };
}

function mockDb(rows) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.includes("INSERT OR IGNORE") && sql.includes("prediction_snapshots")) {
                  const id = args[0];
                  if (!rows.has(id)) {
                    rows.set(id, { id, proj_home: args[8], actual_home: args[34], actual_away: args[35] });
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                if (sql.includes("UPDATE prediction_snapshots")) {
                  const id = args[3];
                  const row = rows.get(id);
                  if (row && row.actual_home == null) {
                    row.actual_home = args[0];
                    row.actual_away = args[1];
                    row.graded_at = args[2];
                  }
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                return { ok: 1 };
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
}
