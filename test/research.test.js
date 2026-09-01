import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mae, rmse, bias, median, withinShare, withinBands } from "../functions/lib/metrics.js";
import { projectCfbMatchup, blendSeason, earlySeasonWeight, powerFromRank, cfbSigma } from "../functions/lib/cfbModel.js";
import {
  ticketMatchesStrategy,
  STRATEGY_HC_V1,
  STRATEGY_HC_V1_SEED_SPEC,
  STRATEGY_HC_V1_SEED_TICKETS,
  characterizeTickets,
  strategyStats,
  packTicket,
  inSeedWindow,
  gradeStrategyResult,
  canonicalSeedTickets,
  strategyReconstruction,
  validateImportedTicket,
  assignTicketRole,
  hasJournalGradeFields,
  americanPriceOrNull,
  immutableFieldsConflict,
  ticketId,
  partitionProspectiveTickets,
} from "../functions/lib/strategy.js";
import { DEFAULT_WEIGHTS } from "../functions/lib/weights.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { persistSnapshot, gradeSnapshot, persistStrategyTicket } from "../functions/lib/store.js";
import { onRequestPost, importStrategyTickets } from "../functions/api/strategy.js";
import { projectCfbGame } from "../functions/lib/cfbModel.js";
import { classifyCheckpoint, pickCanonical, rowsForCheckpoint } from "../functions/lib/checkpoints.js";
import { projectMatchup } from "../functions/lib/savant.js";
import { expectedRoi, twoWayMarket, brierScore, logLoss, americanToImplied, probabilityClv } from "../functions/lib/pricing.js";
import { gameOutcome, freezeFromGame, accuracyOf } from "../functions/lib/projLedger.js";
import { seriesStats } from "../functions/lib/accuracyReport.js";
import { overDiagnostics, bucketOf } from "../functions/lib/overDiagnostics.js";
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

  it("does not treat a 7-0 sample as a model update", () => {
    assert.equal(STRATEGY_HC_V1.rules.minEv, 0.08);
    assert.match(STRATEGY_HC_V1.notes, /N=7/);
    assert.doesNotMatch(STRATEGY_HC_V1.notes, /8-0|N=8/);
    assert.equal(STRATEGY_HC_V1.reportedRecord, "7-0");
    assert.equal(STRATEGY_HC_V1.reconstructionConfidence, "operator-declared");
    assert.equal(STRATEGY_HC_V1.id, "FBIS-HC-v1");
    assert.equal(STRATEGY_HC_V1.version, 1);
    assert.deepEqual(DEFAULT_WEIGHTS, { market: 0.22, espn: 0.08, score: 0.32, pal: 0.3, form: 0.08 });
    assert.equal(SPORTS.mlb.k, 2.0);
    assert.equal(SPORTS.mlb.totalK, 3.6);
    assert.equal(SPORTS.mlb.minEv, 0.03);
  });

  it("persists the operator-corrected 7 CONVICTION names", () => {
    const names = [
      "Tampa Bay ML",
      "Col/Wash over 9.5",
      "Hou/NYY over 9",
      "MIL/NYM over 8.5",
      "LAD/ATL over 8.5",
      "BAL/STL over 8.5",
      "OAK +1.5",
    ];
    assert.equal(STRATEGY_HC_V1_SEED_TICKETS.length, 7);
    assert.equal(STRATEGY_HC_V1_SEED_SPEC.length, 7);
    assert.deepEqual(
      STRATEGY_HC_V1_SEED_TICKETS.map((t) => t.pick),
      names
    );
    const traits = characterizeTickets(STRATEGY_HC_V1_SEED_TICKETS);
    assert.equal(traits.n, 7);
    assert.equal(traits.sports.mlb, 7);
    assert.equal(traits.markets.TOTAL, 5);
    assert.equal(traits.markets.ML, 1);
    assert.equal(traits.markets.SPREAD, 1);
    assert.equal(traits.overShare, 5 / 7);
    assert.ok(STRATEGY_HC_V1.seedObservation.includes("observation"));
    assert.ok(!STRATEGY_HC_V1.rules.sport);
    const rec = strategyReconstruction();
    assert.equal(rec.state, "unrecovered");
    assert.equal(rec.identity, "operator-declared");
    assert.equal(rec.confidence, "operator-declared");
    assert.equal(rec.expectedN, 7);
    assert.equal(rec.recoveredN, 0);
    assert.equal(rec.recoveredRecord, null);
    assert.equal(rec.settledTicketCount, 0);
    assert.equal(rec.gradedRecord, "7-0");
    assert.equal(rec.filterClaim, false);
    const presented = canonicalSeedTickets([]);
    assert.equal(presented.length, 7);
    assert.ok(presented.every((t) => t.result === "WON"));
    assert.ok(STRATEGY_HC_V1_SEED_TICKETS.every((t) => t.ev == null && t.pinPrice == null && t.profit == null));
    const root = dirname(fileURLToPath(import.meta.url));
    const json = JSON.parse(readFileSync(join(root, "../data/cohorts/fbis-hc-v1.json"), "utf8"));
    assert.equal(json.positions.length, 7);
    assert.equal(json.reportedRecord, "7-0");
    assert.equal(json.reconstructionConfidence, "operator-declared");
    assert.deepEqual(
      json.positions.map((p) => p.pick),
      names
    );
    assert.equal(json.positions[0].ev, null);
    assert.doesNotMatch(JSON.stringify(json), /8-0/);
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

  it("deduplicates collection-window repeats and separates strategy states", () => {
    const rows = [
      { id: "old", sport: "cfb", gameId: "g1", matchup: "Toledo @ Michigan State", market: "ML", side: "AWAY", date: "2026-08-29", result: "OPEN" },
      { id: "new", sport: "cfb", gameId: "g1", matchup: "Toledo @ Michigan State", market: "ML", side: "AWAY", date: "2026-09-05", result: "OPEN" },
      { id: "real-id", sport: "cfb", gameId: "espn-1", matchup: "Toledo @ Michigan State", market: "ML", side: "AWAY", date: "2026-09-05", result: "OPEN" },
      { id: "done", sport: "mlb", gameId: "g2", market: "TOTAL", side: "OVER", line: 9, date: "2026-08-30", result: "WON" },
      { id: "late", sport: "mlb", gameId: "g3", market: "ML", side: "HOME", date: "2026-08-30", result: "OPEN" },
    ];
    const out = partitionProspectiveTickets(rows, "2026-09-01");
    assert.equal(out.canonical.length, 3);
    assert.equal(out.duplicateRowsExcluded, 2);
    assert.deepEqual(out.upcoming.map((t) => t.id), ["new"]);
    assert.deepEqual(out.completed.map((t) => t.id), ["done"]);
    assert.deepEqual(out.needsAttention.map((t) => t.id), ["late"]);
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

  it("grades a total against a final using Heritage execution price", () => {
    const packed = packTicket({ ...base, line: 8.5, executionPrice: -110, date: "2026-08-26" }, { role: "seed", date: "2026-08-26" });
    const g = gradeStrategyResult(packed, { home: { score: 6 }, away: { score: 5 }, status: { completed: true } });
    assert.equal(g.result, "WON");
    assert.ok(Math.abs(g.profit - 100 / 110) < 1e-9);
  });

  it("does not treat Pinnacle as a Heritage fill for profit", () => {
    const packed = packTicket({ ...base, line: 8.5, pinPrice: -110, date: "2026-08-26" }, { role: "seed", date: "2026-08-26" });
    const g = gradeStrategyResult(packed, { home: { score: 6 }, away: { score: 5 }, status: { completed: true } });
    assert.equal(g.result, "WON");
    assert.equal(g.profit, null);
    assert.equal(g.missingExecutionPrice, true);
  });

  it("never treats a spread/total point as an American price", () => {
    const packed = packTicket({ ...base, line: 8.5, date: "2026-08-26" }, { role: "seed", date: "2026-08-26" });
    assert.equal(packed.pinPrice, null);
    assert.equal(packed.executionPrice, null);
    assert.equal(packed.missingExecutionPrice, true);
    const g = gradeStrategyResult(packed, { home: { score: 6 }, away: { score: 5 }, status: { completed: true } });
    assert.equal(g.result, "WON");
    assert.equal(g.profit, null);
    assert.equal(g.missingExecutionPrice, true);
  });

  it("grades pushes and F5 markets from F5 scores only", () => {
    const totalPush = gradeStrategyResult(
      packTicket({ ...base, line: 9, executionPrice: -105, date: "2026-08-26" }, { role: "prospective", date: "2026-08-26" }),
      { home: { score: 4 }, away: { score: 5 }, status: { completed: true } }
    );
    assert.equal(totalPush.result, "PUSH");
    assert.equal(totalPush.profit, 0);
    const fgWouldWin = { home: { score: 10 }, away: { score: 0 }, status: { completed: true }, f5Score: { complete: true, home: 1, away: 1 } };
    const f5ml = gradeStrategyResult(
      packTicket({ ...base, market: "ML", side: "HOME", line: null, pinPrice: -110, gameId: "f5" }, { role: "prospective", date: "2026-08-26" }),
      fgWouldWin
    );
    assert.equal(f5ml.result, "WON");
    const f5 = gradeStrategyResult(
      {
        ...packTicket(
          { ...base, market: "F5 TOTAL", side: "OVER", line: 3.5, pinPrice: -120, gameId: "f5t" },
          { role: "prospective", date: "2026-08-26" }
        ),
        market: "F5 TOTAL",
        executionLine: 3.5,
        executionPrice: -120,
      },
      fgWouldWin
    );
    assert.equal(f5.result, "LOST");
    const f5mlPush = gradeStrategyResult(
      { market: "F5 ML", side: "HOME", executionPrice: -110, stake: 1 },
      { f5Score: { complete: true, home: 2, away: 2 }, home: { score: 9 }, away: { score: 1 }, status: { completed: true } }
    );
    assert.equal(f5mlPush.result, "PUSH");
    const postponed = gradeStrategyResult(
      packTicket({ ...base, line: 8.5, executionPrice: -110, date: "2026-08-26" }, { role: "prospective", date: "2026-08-26" }),
      { home: { score: 0 }, away: { score: 0 }, status: { completed: false, detail: "Postponed" } }
    );
    assert.equal(postponed, null);
  });
});

describe("snapshot immutability", () => {
  it("INSERT OR IGNORE keeps the first projection and flags a conflicting rewrite", async () => {
    const rows = new Map();
    const env = mockDb(rows);
    const first = snapRow({ projHome: 4.4, frozenAt: "a" });
    const second = snapRow({ projHome: 9.9, frozenAt: "b" });
    const a = await persistSnapshot(env, first);
    const b = await persistSnapshot(env, second);
    assert.equal(rows.get(first.id).proj_home, 4.4);
    assert.equal(a.ok, true);
    assert.equal(b.conflict, true);
    assert.equal(b.ok, false);
    const same = await persistSnapshot(env, first);
    assert.equal(same.already, 1);
    assert.equal(same.conflict, false);
  });

  it("grades harvest actuals even when cache projections drifted", async () => {
    const rows = new Map();
    const env = mockDb(rows);
    await persistSnapshot(env, snapRow({ projHome: 4.4 }));
    const graded = await persistSnapshot(
      env,
      snapRow({ projHome: 9.9, actualHome: 5, actualAway: 3, gradedAt: "now" })
    );
    assert.equal(graded.ok, true);
    assert.equal(graded.conflict, true);
    assert.equal(graded.failed, 0);
    assert.equal(rows.get("2026-08-26:1:CLOSE").proj_home, 4.4);
    assert.equal(rows.get("2026-08-26:1:CLOSE").actual_home, 5);
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

  it("puts exact disagreement boundaries in the labeled buckets", () => {
    assert.equal(bucketOf(-2).key, "n2-n1");
    assert.equal(bucketOf(-1).key, "n1-0");
    assert.equal(bucketOf(0).key, "0-1");
    assert.equal(bucketOf(1).key, "1-2");
    assert.equal(bucketOf(2).key, "1-2");
    assert.equal(bucketOf(2.1).key, "gt2");
    assert.equal(bucketOf(-2.1).key, "lt-2");
  });

  it("joins strategy totals into qualified EV ROI and CLV", () => {
    const rows = [
      { id: "g1", date: "2026-08-26", sport: "mlb", projHome: 5, projAway: 5, actualHome: 6, actualAway: 5, pinTotal: 8.5, pOver: 0.6 },
      { id: "g2", date: "2026-08-26", sport: "mlb", projHome: 4, projAway: 4, actualHome: 3, actualAway: 3, pinTotal: 9.5 },
    ];
    const tickets = [
      { id: "t1", sport: "mlb", date: "2026-08-26", gameId: "g1", market: "TOTAL", side: "OVER", ev: 0.09, profit: 0.91, clv: 1.2 },
    ];
    const d = overDiagnostics(rows, { tickets });
    assert.equal(d.qualified.over, 1);
    assert.equal(d.avgEv.over.n, 1);
    assert.equal(d.avgEv.over.value, 0.09);
    assert.equal(d.roi.over.n, 1);
    assert.equal(d.clv.over.n, 1);
    assert.equal(d.pal.n, 0);
    assert.equal(d.pal.unavailable, true);
    assert.equal(d.bias.pal.unavailable, true);
    assert.equal(d.bias.pal.value, null);
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
    assert.ok(Math.abs(probabilityClv(0.48, 0.52) - 4) < 1e-9);
    assert.equal(probabilityClv(null, 0.5), null);
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
                if (sql.includes("prediction_snapshots") && sql.includes("WHERE id")) {
                  const row = rows.get(args[0]);
                  return row || null;
                }
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

describe("strategy ingest", () => {
  function journalTicket(extra = {}) {
    return {
      strategyId: "FBIS-HC-v1",
      sport: "mlb",
      gameId: extra.gameId || "824234",
      market: extra.market || "ML",
      side: extra.side || "AWAY",
      line: extra.line ?? null,
      qualifiedAt: extra.qualifiedAt || "2026-08-26T18:00:00-05:00",
      modelVersion: "FBIS-v1.3",
      ev: 0.09,
      tag: "CONVICTION",
      role: extra.role || "prospective",
      pinPrice: extra.pinPrice ?? -110,
      qualified: true,
      lean: false,
      marketComplete: true,
      pick: extra.pick || "Tampa Bay ML",
      ...extra,
    };
  }

  it("rejects unauthenticated POST", async () => {
    const res = await onRequestPost({
      request: new Request("https://fbis-myz.pages.dev/api/strategy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bets: [journalTicket()] }),
      }),
      env: { HARVEST_SECRET: "s3cret", DB: ticketDb().DB },
    });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.doesNotMatch(JSON.stringify(body), /s3cret/);
  });

  it("rejects an invalid seed ticket", () => {
    const bad = validateImportedTicket({ strategyId: "FBIS-HC-v1", sport: "mlb" });
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.includes("game_id"));
  });

  it("lets the server determine role", () => {
    const seed = validateImportedTicket(journalTicket({ role: "prospective" }));
    assert.equal(seed.ok, true);
    assert.equal(seed.role, "seed");
    assert.notEqual(seed.role, seed.clientRole);
    const later = validateImportedTicket(
      journalTicket({ qualifiedAt: "2026-08-27T18:00:00-05:00", role: "seed", gameId: "999" })
    );
    assert.equal(later.role, "prospective");
  });

  it("keeps N=1 through 6 partial and N=7 recovered", () => {
    const one = [
      {
        id: "mlb:2026-08-26:824234:ML:AWAY",
        ...journalTicket(),
        qualifiedAt: "2026-08-26T18:00:00-05:00",
        modelVersion: "FBIS-v1.3",
        ev: 0.09,
        role: "seed",
      },
    ];
    const rec1 = strategyReconstruction(one);
    assert.equal(rec1.state, "partial");
    assert.equal(rec1.recoveredN, 1);
    const seven = STRATEGY_HC_V1_SEED_TICKETS.map((t) => ({
      ...t,
      ev: 0.09,
      qualifiedAt: "2026-08-26T18:00:00-05:00",
      modelVersion: "FBIS-v1.3",
      tag: "CONVICTION",
    }));
    assert.ok(seven.every(hasJournalGradeFields));
    const rec7 = strategyReconstruction(seven);
    assert.equal(rec7.state, "recovered");
    assert.equal(rec7.recoveredN, 7);
  });

  it("marks N>7 as conflict", () => {
    const extra = [
      ...STRATEGY_HC_V1_SEED_TICKETS,
      { id: "mlb:2026-08-26:1:ML:HOME", sport: "mlb", gameId: "1", market: "ML", side: "HOME", role: "seed" },
    ];
    assert.equal(strategyReconstruction(extra).state, "conflict");
  });

  it("is idempotent for identical tickets and rejects conflicting duplicates", async () => {
    const env = ticketDb();
    const t = journalTicket({ executionPrice: -110 });
    const a = await importStrategyTickets(env, [t]);
    const b = await importStrategyTickets(env, [t]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const packed = packTicket(validateImportedTicket(t).ticket, { role: "seed" });
    const conflict = immutableFieldsConflict(packed, { ...packed, ev: 0.99 });
    assert.equal(conflict, true);
    const c = await importStrategyTickets(env, [{ ...t, ev: 0.99 }]);
    assert.equal(c.ok, false);
    assert.equal(c.status, 409);
    const first = await persistStrategyTicket(env, packed);
    const rerun = await persistStrategyTicket(env, { ...packed, ev: 0.99, qualifiedAt: "2026-08-27T12:00:00Z" }, {
      strictConflict: false,
    });
    assert.equal(first.ok, true);
    assert.equal(rerun.ok, true);
    assert.equal(rerun.already, true);
  });

  it("does not rewrite a settled result", async () => {
    const env = ticketDb();
    const t = journalTicket({ result: "WON", profit: 0.91, executionPrice: -110 });
    await importStrategyTickets(env, [t]);
    const again = await importStrategyTickets(env, [{ ...t, result: "LOST", profit: -1 }]);
    assert.equal(again.ok, false);
    assert.ok((again.body.conflicts || []).some((x) => x.reason === "settled-immutable"));
  });

  it("does not update champion weights because of 7-0", () => {
    assert.deepEqual(DEFAULT_WEIGHTS, { market: 0.22, espn: 0.08, score: 0.32, pal: 0.3, form: 0.08 });
    assert.equal(americanPriceOrNull(8.5), null);
    assert.equal(americanPriceOrNull(-110), -110);
    const ml = packTicket(
      { ...journalTicket({ market: "ML", side: "AWAY", line: 126, pinPrice: 126, gameId: "mlprice" }), date: "2026-08-27" },
      { role: "prospective", date: "2026-08-27" }
    );
    assert.equal(ml.line, null);
    assert.equal(ml.executionPrice, null);
    assert.equal(ml.benchmarkPrice, 126);
    assert.equal(ml.missingExecutionPrice, true);
  });
});

describe("CFB v1.3 flags", () => {
  it("flags rankings unavailable, both unranked, no team form, league-average-only", () => {
    const proj = projectCfbGame(
      { home: { name: "A", abbr: "AAA" }, away: { name: "B", abbr: "BBB" } },
      { rankings: { byTeam: new Map(), error: "down" }, form: new Map(), rankingsUnavailable: true }
    );
    assert.ok(proj.flags.includes("rankings_unavailable"));
    assert.ok(proj.flags.includes("both_unranked"));
    assert.ok(proj.flags.includes("no_team_form"));
    assert.ok(proj.flags.includes("league_average_only"));
    assert.ok(proj.dataQuality < 50);
  });
});

function ticketDb() {
  const tickets = new Map();
  return {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.includes("INSERT") && sql.includes("strategy_tickets")) {
                  const id = args[0];
                  if (!tickets.has(id)) {
                    tickets.set(id, rowFromBind(args));
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                if (sql.includes("UPDATE strategy_tickets") && sql.includes("SET result")) {
                  const id = args[args.length - 1];
                  const row = tickets.get(id);
                  if (row && (!row.result || row.result === "OPEN")) {
                    row.result = args[0];
                    row.profit = args[1];
                    row.clv = args[2];
                    row.graded_at = args[3];
                    return { meta: { changes: 1 } };
                  }
                  return { meta: { changes: 0 } };
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes("strategy_tickets") && sql.includes("WHERE id")) {
                  return tickets.get(args[0]) || null;
                }
                return { ok: 1 };
              },
              async all() {
                const all = [...tickets.values()];
                if (sql.includes("role = ?")) {
                  const role = args.find((a) => a === "seed" || a === "prospective") || args[1];
                  return { results: all.filter((r) => r.role === role) };
                }
                return { results: all };
              },
            };
          },
        };
      },
    },
  };
}

function rowFromBind(args) {
  return {
    id: args[0],
    strategy_id: args[1],
    role: args[2],
    sport: args[3],
    date: args[4],
    game_id: args[5],
    matchup: args[6],
    market: args[7],
    side: args[8],
    pick: args[9],
    line: args[10],
    ev: args[11],
    edge: args[12],
    tag: args[13],
    pin_vig: args[14],
    pin_price: args[15],
    model_version: args[16],
    checkpoint: args[17],
    data_quality: args[18],
    result: args[19],
    profit: args[20],
    clv: args[21],
    traits_json: args[22],
    created_at: args[23],
    graded_at: args[24],
    qualified_at: args[25],
    execution_line: args[26],
    execution_price: args[27],
    benchmark_line: args[28],
    benchmark_price: args[29],
    entry_no_vig: args[30],
    closing_line: args[31],
    closing_price: args[32],
    closing_no_vig: args[33],
    stake: args[34],
    missing_execution_price: args[35],
  };
}

