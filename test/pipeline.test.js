import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unwrapPalResponse } from "../functions/lib/ballparkpal.js";
import { classifyCheckpoint, pickCanonical, materiallyChanged } from "../functions/lib/checkpoints.js";
import { accuracyOf, freezeFromGame } from "../functions/lib/projLedger.js";
import { seriesStats, buildAccuracyPack } from "../functions/lib/accuracyReport.js";
import { fetchParlayOdds } from "../functions/lib/parlay.js";

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
