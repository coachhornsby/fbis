import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BOARD_STATUSES, classifyBoardStatus } from "../functions/lib/gameStatus.js";
import { resolveTodayDate, utcMidnightVsCt, groupBySport, sortByStart, emptyTodayState, buildTodayBoard } from "../functions/lib/todayBoard.js";
import { rowsForCheckpoint, CHECKPOINT_ALIASES } from "../functions/lib/checkpoints.js";
import { palHealth } from "../functions/lib/sourceCoverage.js";
import { freezeFromGame } from "../functions/lib/projLedger.js";
import { isPostStart, selectClose, packPinOddsRows } from "../functions/lib/closeCapture.js";
import { attachMyBetsToBoard } from "../functions/lib/executedBets.js";
import { summarize } from "../src/lib/learning.js";
import { todayFeedNote } from "../functions/lib/propConviction.js";
import { formatMarketPeriod, formatClv } from "../src/lib/format.js";

describe("TODAY date and grouping", () => {
  it("resolves blank date to CT today and rejects junk", () => {
    const ok = resolveTodayDate("", new Date("2026-08-27T18:00:00Z"));
    assert.equal(ok.ok, true);
    assert.match(ok.date, /^\d{4}-\d{2}-\d{2}$/);
    const bad = resolveTodayDate("08/27/2026");
    assert.equal(bad.ok, false);
  });

  it("detects UTC midnight vs America/Chicago date shift", () => {
    const row = utcMidnightVsCt("2026-08-27T04:30:00Z");
    assert.equal(typeof row.differs, "boolean");
    assert.equal(row.utcDate, "2026-08-27");
  });

  it("groups by sport and sorts by start", () => {
    const games = [
      { id: "2", sport: "mlb", start: "2026-08-27T23:00:00Z", away: { abbr: "B" } },
      { id: "1", sport: "mlb", start: "2026-08-27T18:00:00Z", away: { abbr: "A" } },
      { id: "3", sport: "nfl", start: "2026-08-27T17:00:00Z", away: { abbr: "C" } },
    ];
    const grouped = groupBySport(games);
    assert.ok(grouped.some((g) => g.sport === "mlb" && g.n === 2));
    assert.equal(sortByStart(games.filter((g) => g.sport === "mlb"))[0].id, "1");
  });

  it("uses the board status vocabulary", () => {
    for (const s of ["scheduled", "pregame", "live", "halftime", "final", "postponed", "suspended", "canceled"]) {
      assert.ok(BOARD_STATUSES.includes(s));
    }
    assert.equal(classifyBoardStatus({ status: { completed: true } }), "final");
    assert.equal(classifyBoardStatus({ status: { live: true } }), "live");
    assert.equal(classifyBoardStatus({ status: { postponed: true } }), "postponed");
  });

  it("empty board copy does not hide behind missing Pal/Pin", () => {
    const empty = emptyTodayState({ date: "2026-08-27", feeds: {} });
    assert.match(empty.message, /No games scheduled/);
  });
});

describe("TODAY cache-only and MY BET markers", () => {
  it("passes parlayCacheOnly and palCacheOnly into the slate builder", async () => {
    const seen = [];
    await buildTodayBoard("2026-08-27", {}, {
      buildSlateFn: async (sport, date, env) => {
        seen.push({ sport, cache: env.parlayCacheOnly, pal: env.palCacheOnly });
        return { sport, date, games: [], parlay: { cached: true, skipped: true } };
      },
    });
    assert.ok(seen.length >= 5);
    assert.ok(seen.every((s) => s.cache === true && s.pal === true));
  });

  it("reports skipped MLB prop feed instead of an evaluated zero", async () => {
    const board = await buildTodayBoard("2026-08-28", {}, {
      buildSlateFn: async (sport) => ({
        sport,
        date: "2026-08-28",
        games: sport === "mlb" ? [{
          id: "1",
          sport: "mlb",
          start: "2026-08-28T23:00:00Z",
          home: { name: "Cubs", abbr: "CHC" },
          away: { name: "Pirates", abbr: "PIT" },
          status: { detail: "Scheduled" },
          odds: {},
          model: { projHome: 4.1, projAway: 3.8, layers: { score: 0.55 } },
        }] : [],
        parlay: { cached: false, skipped: true, propFeedStatus: "skipped", propRows: 0 },
      }),
    });
    assert.equal(board.counts.mlbPropWatch.status, "skipped");
    assert.equal(board.counts.mlbPropWatch.convictions, 0);
    assert.equal(board.counts.mlbPropWatch.sportsbookContracts, 0);
  });

  it("omits empty MLB props fragment from TODAY copy", () => {
    const bare = todayFeedNote({}, null);
    assert.match(bare, /Cache-only odds/);
    assert.doesNotMatch(bare, /MLB props/);
    assert.doesNotMatch(bare, /Pal last collect/);
    const palOnly = todayFeedNote({ pal: { matched: 0, unmatched: 0, mlbGames: 15 } }, null);
    assert.match(palOnly, /Pal last collect: 0 matched \/ 0 unmatched of 15 MLB games\./);
    assert.doesNotMatch(palOnly, /MLB props/);
    const skipped = todayFeedNote({ pal: { matched: 2, unmatched: 1 } }, { status: "skipped", skipped: true, convictions: 0, sportsbookContracts: 0 });
    assert.match(skipped, /Sportsbook prop feed is not on this view yet/);
    assert.doesNotMatch(skipped, /MLB props: \./);
    const hot = todayFeedNote({}, { convictions: 2, sportsbookContracts: 40, palProps: 12 });
    assert.match(hot, /MLB props: 2 conviction props/);
    const jsonErr = todayFeedNote({}, {
      status: "error",
      convictions: 0,
      error: 'Parlay 403: {"detail":{"error":"CREDIT_LIMIT_REACHED","upgrade_url":"https://parlay.io"}}',
    });
    assert.match(jsonErr, /Parlay credits exhausted this period/);
    assert.doesNotMatch(jsonErr, /upgrade_url/);
  });

  it("formats Heritage market period and unavailable CLV", () => {
    assert.equal(formatMarketPeriod("ML", "FULL_GAME"), "ML · FG");
    assert.equal(formatMarketPeriod("TOTAL", "F5"), "TOTAL · F5");
    assert.equal(formatClv(null, "unavailable"), "—");
    assert.equal(formatClv(0, "unavailable"), "—");
    assert.equal(formatClv(0.012, "ok"), "+0.012");
  });

  it("attaches MY BET markers without promoting them to recs", () => {
    const board = {
      games: [{ id: "g1", sport: "mlb", rec: null }],
      groups: [{ sport: "mlb", games: [{ id: "g1", sport: "mlb", rec: null }] }],
      counts: {},
    };
    const next = attachMyBetsToBoard(board, [
      { id: "Heritage:G1", gameId: "g1", selectedSide: "HOME", executionPrice: 107, riskAmount: 2, result: "OPEN", attributionLabel: "OPERATOR BET · NOT ATTRIBUTED TO FBIS" },
    ]);
    assert.equal(next.games[0].myBet.executionPrice, 107);
    assert.equal(next.games[0].rec, null);
    assert.equal(next.counts.myBets, 1);
  });
});

describe("accuracy vs tickets split", () => {
  it("INFORMATION_CONFIRMED aliases LINEUP_CONFIRMED", () => {
    assert.equal(CHECKPOINT_ALIASES.INFORMATION_CONFIRMED, "LINEUP_CONFIRMED");
    const rows = rowsForCheckpoint([{ checkpoint: "LINEUP_CONFIRMED", id: "1" }], "INFORMATION_CONFIRMED");
    assert.equal(rows.length, 1);
  });

  it("logged-rec summarize is null at N=0, not 0.0% win rate", () => {
    const s = summarize({ bets: [], weights: {} }, "mlb");
    assert.equal(s.winPct, null);
    assert.equal(s.clv, null);
    assert.equal(s.settled, 0);
  });

  it("Pal health is N=0 — unavailable when unmatched", () => {
    const pal = palHealth([], {});
    assert.equal(pal.unavailable, true);
    assert.equal(pal.message, "N=0 — unavailable");
  });
});

describe("pipeline freeze and close", () => {
  it("freezes a projection even when Pal and Pin total are missing", () => {
    const frozen = freezeFromGame("2026-08-27", {
      id: "x",
      sport: "mlb",
      start: new Date(Date.now() + 3 * 3600000).toISOString(),
      home: { abbr: "ATL", name: "Atlanta Braves" },
      away: { abbr: "LAD", name: "Los Angeles Dodgers" },
      model: { projHome: 4.1, projAway: 3.8, pHomeFinal: 0.55, layers: { score: 0.55 } },
      odds: { pinHomeMl: -120, pinAwayMl: 105 },
      quality: { flags: [] },
    });
    assert.ok(frozen);
    assert.equal(frozen.palHome, null);
    assert.ok(frozen.qualityFlags.includes("missing_pal"));
    assert.ok(frozen.qualityFlags.includes("missing_pin_total"));
  });

  it("rejects post-start snapshots as close", () => {
    const start = "2026-08-27T18:00:00Z";
    assert.equal(isPostStart("2026-08-27T18:00:00Z", start), true);
    const packed = packPinOddsRows({
      id: "g",
      start,
      odds: { pinHomeMl: -110, pinAwayMl: -110, pinSpread: -1.5, pinSpreadHomePrice: -110, pinSpreadAwayPrice: -110, pinTotal: 8.5, pinOverPrice: -110, pinUnderPrice: -110 },
    }, { capturedAt: "2026-08-27T19:00:00Z" });
    assert.equal(packed.rejectedPostStart, true);
    const close = selectClose(packed.rows, { start, market: "ML", period: "fg", side: "HOME" });
    assert.equal(close.close, null);
  });
});
