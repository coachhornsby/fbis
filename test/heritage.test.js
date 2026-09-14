import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HERITAGE_FIXTURE_PASTE,
  parseHeritageSlip,
  parseHeritageTicket,
  validateRiskToWin,
  expectedToWin,
  normalizeHeritageMarket,
  americanPrice,
  pointLine,
  stripMarkdownLinks,
  decodeEntities,
  expectedProfit,
} from "../functions/lib/heritageSlip.js";
import { parseNoVigSlip } from "../functions/lib/novigSlip.js";
import { looksLikePrizePicksSlip, parsePrizePicksSlip } from "../functions/lib/prizePicksSlip.js";
import { identityForSport } from "../functions/lib/teams.js";
import {
  matchExecutedBet,
  attributeRecommendation,
  attachPinnacleClv,
  settleExecutedBet,
  settlePlayerProp,
  immutableConflict,
  summarizeExecutedBets,
  decoratePreview,
  OPERATOR_ONLY,
} from "../functions/lib/executedBets.js";
import { selectClose, selectPinAtOrBefore, packPinOddsRows, isPostStart, CLV_UNAVAILABLE, clvTracker } from "../functions/lib/closeCapture.js";
import { parseBetsPreview, handleBetsPost } from "../functions/api/bets.js";
import { authorizeExecutedBetWrite, isSameOriginOperatorRequest } from "../functions/lib/auth.js";
import { querySnapshots } from "../functions/lib/store.js";
import {
  CLOUDFLARE_HTML_503,
  NO_TICKETS_TO_WRITE,
  PASTE_CHANGED,
  buildConfirmRequest,
  confirmStatusLine,
  confirmWriteGuard,
  explainNonJsonHttp,
  importResponseFeedback,
  isTotalMarket,
  previewIsStale,
  readResponseJson,
} from "../src/lib/heritageImport.js";

describe("Heritage five-ticket fixtures", () => {
  const parsed = parseHeritageSlip(HERITAGE_FIXTURE_PASTE, { yearHint: 2026 });

  it("parses five tickets: $10 risk, $9.98 to-win, 4 ML + 1 RL", () => {
    assert.equal(parsed.n, 5);
    assert.equal(parsed.totalRisk, 10);
    assert.equal(parsed.totalToWin, 9.98);
    assert.equal(parsed.ml, 4);
    assert.equal(parsed.spread, 1);
    assert.equal(parsed.total, 0);
    const ids = parsed.tickets.map((t) => t.externalTicketId);
    assert.deepEqual(ids, ["G10904318", "G10904312", "G10904306", "G10904299", "G10902289"]);
  });

  it("keeps ML execution_line null and price American", () => {
    const lad = parsed.tickets.find((t) => t.externalTicketId === "G10904318");
    assert.equal(lad.market, "ML");
    assert.equal(lad.period, "FULL_GAME");
    assert.equal(lad.executionLine, null);
    assert.equal(lad.executionPrice, 107);
    assert.equal(lad.selectedTeam, "Los Angeles Dodgers");
    assert.equal(lad.sourceEventId, "198257191");
    assert.equal(lad.heritageCurrentPrice, 107);
  });

  it("treats Brewers -1.5 as a run line, never American odds", () => {
    const mil = parsed.tickets.find((t) => t.externalTicketId === "G10904306");
    assert.equal(mil.market, "SPREAD");
    assert.equal(mil.executionLine, -1.5);
    assert.equal(mil.executionPrice, -107);
    assert.equal(americanPrice(-1.5), null);
    assert.equal(pointLine(-1.5), -1.5);
  });

  it("stores Rockies Heritage current +126 separately from Pin CLV", () => {
    const col = parsed.tickets.find((t) => t.externalTicketId === "G10902289");
    assert.equal(col.executionPrice, 109);
    assert.equal(col.heritageCurrentPrice, 126);
    const clv = attachPinnacleClv({ ...col, gameId: "x", selectedSide: "AWAY" }, [], "2026-08-27T18:00:00Z");
    assert.equal(clv.heritageCurrent.price, 126);
    assert.equal(clv.clv, null);
    assert.match(clv.heritageCurrent.note, /not Pinnacle CLV/i);
  });

  it("does not classify fixtures as CONVICTION / qualified / FBIS-HC-v1", () => {
    for (const t of parsed.tickets) {
      const attr = attributeRecommendation({ ...t, gameId: "none", executedAt: t.executedAt }, { snapshots: [], strategyTickets: [] });
      assert.equal(attr.conviction, false);
      assert.equal(attr.qualified, false);
      assert.equal(attr.recommended, false);
      assert.equal(attr.label, OPERATOR_ONLY);
    }
  });
});

describe("Heritage parser robustness", () => {
  it("validates risk vs to-win examples", () => {
    assert.equal(expectedToWin(2, 107), 2.14);
    assert.ok(validateRiskToWin(2, 1.94, -103).ok);
    assert.ok(validateRiskToWin(2, 1.87, -107).ok);
    assert.ok(validateRiskToWin(2, 1.85, -108).ok);
    assert.ok(validateRiskToWin(2, 2.18, 109).ok);
    assert.equal(validateRiskToWin(2, 9, -110).ok, false);
  });

  it("normalizes Game Winner / Run Line / F5", () => {
    assert.equal(normalizeHeritageMarket("Game / Game Winner").market, "ML");
    assert.equal(normalizeHeritageMarket("Game / Run Line").market, "SPREAD");
    assert.equal(normalizeHeritageMarket("Game / Total").market, "TOTAL");
    assert.equal(normalizeHeritageMarket("First 5 / Game Winner").period, "F5");
    assert.equal(normalizeHeritageMarket("prop / player").unsupported, true);
  });

  it("handles blanks, markdown, HTML entities, and extra spacing", () => {
    const text = `
G10904318 | Aug 27 10:06

Los Angeles Dodgers (Y Yamamoto R) vs Atlanta Braves (C Sale L)
Game / Game Winner / Los Angeles Dodgers (Y Yamamoto R)
Risk: $2.00@ +107
To win: $2.14
Current Line: Los Angeles Dodgers +107

[Los Angeles Dodgers](https://example.com/event/198257191)

G10909999 | Aug 27 11:00
St.&nbsp;Louis Cardinals vs Chicago Cubs
Game / Game Winner / St. Louis Cardinals
Risk: $2.00 @ -110
To win: $1.82
`;
    const parsed = parseHeritageSlip(text, { yearHint: 2026 });
    assert.equal(parsed.n, 2);
    assert.ok(parsed.tickets[0].sourceEventId === "198257191" || parsed.tickets[0].rawText.includes("198257191"));
    assert.ok(decodeEntities("St.&nbsp;Louis").includes("St."));
    assert.ok(stripMarkdownLinks("[x](https://a/event/1)").includes("https://a/event/1"));
  });

  it("parses Heritage totals Over/Under, not a blank team box", () => {
    const over = parseHeritageTicket(`G10923027 | Aug 28 8:20
Colorado Rockies vs Atlanta Braves
Game / Total / Over 9
Risk: $2.00 @ +100
To win: $2.01
Current Line: Over 9 +100`, { yearHint: 2026 });
    assert.equal(over.market, "TOTAL");
    assert.equal(over.selectedSide, "OVER");
    assert.equal(over.selectedTeam, null);
    assert.equal(over.executionLine, 9);
    assert.equal(over.executionPrice, 100);
    assert.ok(!(over.warnings || []).includes("missing over/under"));

    const fromCurrent = parseHeritageTicket(`G10923027 | Aug 28 8:20
Colorado Rockies vs Atlanta Braves
Game / Total
Risk: $2.00 @ +100
To win: $2.01
Current Line: Under 9 +100`, { yearHint: 2026 });
    assert.equal(fromCurrent.selectedSide, "UNDER");
    assert.equal(fromCurrent.executionLine, 9);

    const nineOver = parseHeritageTicket(`G10923027 | Aug 28 8:20
Colorado Rockies vs Atlanta Braves
Game / Total / 9
Risk: $2.00 @ +100
To win: $2.01
Current Line: 9 Over +100`, { yearHint: 2026 });
    assert.equal(nineOver.selectedSide, "OVER");
    assert.equal(nineOver.executionLine, 9);
  });

  it("parses a Tigers fragment without a G-id as one ticket", () => {
    const text = `Game / Game Winner / Detroit Tigers (D. Anderson -R)
Risk: $50.00 @ +191
To win: $95.39
Current Line: Detroit Tigers +191`;
    const parsed = parseHeritageSlip(text, { yearHint: 2026 });
    assert.equal(parsed.n, 1);
    assert.equal(parsed.tickets[0].selectedTeam, "Detroit Tigers");
    assert.equal(parsed.tickets[0].executionPrice, 191);
    assert.equal(parsed.tickets[0].riskAmount, 50);
    assert.ok((parsed.tickets[0].warnings || []).includes("missing ticket ID"));
  });

  it("flags duplicate ticket IDs in one paste", () => {
    const dup = `${HERITAGE_FIXTURE_PASTE}\n\n${parseHeritageSlip(HERITAGE_FIXTURE_PASTE).tickets[0].rawText}`;
    const parsed = parseHeritageSlip(dup, { yearHint: 2026 });
    assert.ok(parsed.tickets.some((t) => t.duplicateInPaste));
  });
});

describe("Heritage matching, attribution, CLV, settlement", () => {
  const lad = parseHeritageTicket(HERITAGE_FIXTURE_PASTE.split(/G10904312/)[0], { yearHint: 2026 });

  it("requires both teams; mascot/one-team is unmatched", () => {
    const games = [
      { id: "1", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Atlanta Braves", abbr: "ATL" }, away: { name: "Los Angeles Dodgers", abbr: "LAD" } },
    ];
    const hit = matchExecutedBet(lad, games);
    assert.equal(hit.status, "matched");
    const one = matchExecutedBet(lad, [
      { id: "2", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Atlanta Braves", abbr: "ATL" }, away: { name: "Miami Marlins", abbr: "MIA" } },
    ]);
    assert.equal(one.status, "unmatched");
  });

  it("marks ambiguous when two games both fit", () => {
    const games = [
      { id: "a", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Atlanta Braves", abbr: "ATL" }, away: { name: "Los Angeles Dodgers", abbr: "LAD" } },
      { id: "b", sport: "mlb", date: "2026-08-27", start: lad.executedAt, home: { name: "Los Angeles Dodgers", abbr: "LAD" }, away: { name: "Atlanta Braves", abbr: "ATL" } },
    ];
    assert.equal(matchExecutedBet(lad, games).status, "ambiguous");
  });

  it("attributes only a freeze at or before execution", () => {
    const ticket = { ...lad, gameId: "g1", selectedSide: "AWAY", executedAt: "2026-08-27T15:06:00Z" };
    const late = attributeRecommendation(ticket, {
      snapshots: [{ gameId: "g1", frozenAt: "2026-08-27T16:00:00Z", projHome: 4, checkpoint: "CLOSE" }],
      strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "AWAY", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-08-27T16:01:00Z" }],
    });
    assert.equal(late.recommended, false);
    assert.equal(late.label, OPERATOR_ONLY);
    const early = attributeRecommendation(ticket, {
      snapshots: [{ gameId: "g1", frozenAt: "2026-08-27T14:00:00Z", projHome: 4, checkpoint: "MORNING", modelVersion: "FBIS-v1.3" }],
      strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "AWAY", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-08-27T14:01:00Z" }],
    });
    assert.equal(early.conviction, true);
    assert.equal(early.recommended, true);
    const noSide = attributeRecommendation({ ...ticket, selectedSide: null }, {
      snapshots: [{ gameId: "g1", frozenAt: "2026-08-27T14:00:00Z", projHome: 4, checkpoint: "MORNING" }],
      strategyTickets: [{ id: "s1", gameId: "g1", market: "ML", side: "HOME", tag: "CONVICTION", qualified: true, qualifiedAt: "2026-08-27T14:01:00Z" }],
    });
    assert.equal(noSide.recommended, false);
    assert.equal(noSide.label, OPERATOR_ONLY);
  });

  it("never uses post-kickoff Pin as close or Heritage current as Pin close", () => {
    const start = "2026-08-27T18:00:00Z";
    const snaps = [
      { market: "ml", period: "fg", side: "AWAY", price: 105, noVig: 0.48, capturedAt: "2026-08-27T14:00:00Z", line: null },
      { market: "ml", period: "fg", side: "AWAY", price: 120, noVig: 0.45, capturedAt: "2026-08-27T19:00:00Z", line: null, rejectedPostStart: true },
    ];
    const close = selectClose(snaps, { start, market: "ML", period: "fg", side: "AWAY" });
    assert.equal(close.close.capturedAt, "2026-08-27T14:00:00Z");
    assert.equal(isPostStart("2026-08-27T19:00:00Z", start), true);
    const packed = packPinOddsRows({
      id: "g",
      start,
      odds: { pinHomeMl: -115, pinAwayMl: 105 },
    }, { capturedAt: "2026-08-27T19:00:00Z" });
    assert.equal(packed.rejectedPostStart, true);
    assert.ok(packed.rows.every((r) => r.rejectedPostStart === 1));
  });

  it("uses Heritage risk/to-win for settlement, F5 scores for F5", () => {
    const ml = { market: "ML", selectedSide: "HOME", riskAmount: 2, toWinAmount: 2.14, potentialPayout: 4.14, period: "FULL_GAME" };
    const won = settleExecutedBet(ml, { status: { completed: true }, home: { score: 5 }, away: { score: 3 }, actualHome: 5, actualAway: 3 });
    assert.equal(won.result, "WON");
    assert.equal(won.profit, 2.14);
    const lost = settleExecutedBet(ml, { status: { completed: true }, actualHome: 1, actualAway: 4, home: { score: 1 }, away: { score: 4 } });
    assert.equal(lost.result, "LOST");
    assert.equal(lost.profit, -2);
    const push = settleExecutedBet(ml, { status: { completed: true }, actualHome: 2, actualAway: 2, home: { score: 2 }, away: { score: 2 } });
    assert.equal(push.result, "PUSH");
    assert.equal(push.profit, 0);
    const f5 = settleExecutedBet(
      { market: "F5 ML", period: "F5", selectedSide: "HOME", riskAmount: 2, toWinAmount: 1.8, potentialPayout: 3.8 },
      { f5Score: { home: 3, away: 1, complete: true } }
    );
    assert.equal(f5.result, "WON");
    assert.equal(expectedProfit("VOID", 2, 2), 0);
  });

  it("never grades a scheduled 0-0 placeholder as a push", () => {
    const open = settleExecutedBet(
      { market: "ML", selectedSide: "HOME", riskAmount: 2, toWinAmount: 2, potentialPayout: 4, period: "FULL_GAME" },
      { status: { completed: false, detail: "Scheduled" }, home: { score: 0 }, away: { score: 0 }, actualHome: 0, actualAway: 0 }
    );
    assert.equal(open.result, "OPEN");
    assert.equal(open.gradedAt, null);
  });

  it("counts pushes and voids as settled while keeping the decided record accurate", () => {
    const summary = summarizeExecutedBets([
      { result: "WON", riskAmount: 2, profit: 2.14 },
      { result: "LOST", riskAmount: 2, profit: -2 },
      { result: "PUSH", riskAmount: 2, profit: 0 },
      { result: "VOID", riskAmount: 2, profit: 0 },
      { result: "OPEN", riskAmount: 5, profit: null },
    ]);
    assert.equal(summary.settled, 4);
    assert.equal(summary.record, "1-1");
    assert.equal(summary.wins, 1);
    assert.equal(summary.losses, 1);
    assert.equal(summary.hitRate, 0.5);
    assert.equal(summary.pushes, 1);
    assert.equal(summary.voids, 1);
    assert.equal(summary.risk, 8);
  });

  it("summarizeExecutedBets breaks tallies down by sport", () => {
    const summary = summarizeExecutedBets([
      { sport: "mlb", result: "WON", riskAmount: 2, profit: 1.8 },
      { sport: "mlb", result: "LOST", riskAmount: 2, profit: -2 },
      { sport: "cfb", result: "WON", riskAmount: 3, profit: 2.7 },
      { sport: "cfb", result: "OPEN", riskAmount: 3, profit: null },
    ]);
    assert.equal(summary.record, "2-1");
    assert.equal(summary.bySport.mlb.record, "1-1");
    assert.equal(summary.bySport.mlb.hitRate, 0.5);
    assert.equal(summary.bySport.cfb.record, "1-0");
    assert.equal(summary.bySport.cfb.open, 1);
    assert.equal(summary.bySport.cfb.hitRate, 1);
  });

  it("conflicts when the same ticket ID has different immutable fields", () => {
    assert.equal(
      immutableConflict(
        { selectedSide: "HOME", executionPrice: 107, riskAmount: 2, executedAt: "a" },
        { selectedSide: "AWAY", executionPrice: 107, riskAmount: 2, executedAt: "a" }
      ),
      true
    );
    assert.equal(
      immutableConflict(
        { selectedSide: "HOME", executionPrice: 107, riskAmount: 2, executedAt: "a" },
        { selectedSide: "HOME", executionPrice: 107, riskAmount: 2, executedAt: "a" }
      ),
      false
    );
  });

  it("summaries are null at N=0 rather than zero-filled win rate", () => {
    const empty = summarizeExecutedBets([]);
    assert.equal(empty.bets, 0);
    assert.equal(empty.record, null);
    assert.equal(empty.profit, null);
    assert.equal(empty.roi, null);
    assert.equal(empty.avgClv, null);
    assert.match(empty.message, /No imported bets/);
  });

  it("parse preview does not write", async () => {
    const preview = await parseBetsPreview({}, HERITAGE_FIXTURE_PASTE, 2026);
    assert.equal(preview.wrote, false);
    assert.equal(preview.n, 5);
    assert.equal(preview.totalRisk, 10);
    assert.equal(preview.totalToWin, 9.98);
    assert.equal(preview.ml, 4);
    assert.equal(preview.spread, 1);
    const decorated = await decoratePreview(preview.tickets[0], { games: [], existing: [], snapshots: [] });
    assert.equal(decorated.matchStatus, "unmatched");
    assert.ok(!decorated.attribution?.qualified);
  });

  it("CLV tracker reports unavailable at N=0", () => {
    const t = clvTracker([]);
    assert.equal(t.unavailable, true);
    assert.equal(t.message, CLV_UNAVAILABLE);
    assert.equal(selectPinAtOrBefore([], { at: "2026-08-27T15:00:00Z", start: "2026-08-27T18:00:00Z", market: "ML", side: "HOME" }), null);
  });
});

describe("Heritage confirm write auth and feedback", () => {
  const parsed = parseHeritageSlip(HERITAGE_FIXTURE_PASTE, { yearHint: 2026 });

  it("lets confirm proceed without a pasted HARVEST_SECRET", () => {
    const none = confirmWriteGuard({ ticketCount: 0 });
    assert.equal(none.ok, false);
    assert.equal(none.error, NO_TICKETS_TO_WRITE);
    assert.equal(confirmWriteGuard({ ticketCount: 5 }).ok, true);
    assert.equal(confirmWriteGuard({ ticketCount: 0, hasText: true }).ok, true);
    const req = buildConfirmRequest({ text: HERITAGE_FIXTURE_PASTE, tickets: parsed.tickets });
    assert.equal(req.ok, true);
    assert.equal(req.headers["content-type"], "application/json");
    assert.equal(req.headers["x-harvest-secret"], undefined);
    const ready = confirmStatusLine({ busy: false, error: "", wroteMessage: "", ticketCount: 4 });
    assert.equal(ready.kind, "ready");
    assert.match(ready.text, /Ready to write 4 tickets/);
    const stale = confirmStatusLine({ busy: false, error: "", wroteMessage: "", ticketCount: 4, stale: true });
    assert.equal(stale.kind, "error");
    assert.equal(stale.text, PASTE_CHANGED);
    assert.equal(previewIsStale("old paste", "Game / Game Winner / Detroit Tigers"), true);
    assert.equal(previewIsStale("same", "same"), false);
    assert.equal(isTotalMarket("TOTAL"), true);
    assert.equal(isTotalMarket("F5 TOTAL"), true);
    assert.equal(isTotalMarket("ML"), false);
  });

  it("HeritageImport has no HARVEST_SECRET paste field", () => {
    const src = readFileSync(new URL("../src/HeritageImport.jsx", import.meta.url), "utf8");
    assert.ok(!src.includes("harvest-secret"));
    assert.ok(!src.includes("setSecret"));
    assert.ok(!src.includes("HARVEST_SECRET_PLACEHOLDER"));
    assert.ok(src.includes("isTotalMarket"));
    assert.ok(src.includes('placeholder="OVER or UNDER"'));
    assert.ok(src.includes("preview.sourceText"));
    assert.ok(src.includes("PASTE_CHANGED"));
    assert.ok(src.includes("2 · Confirm D1 write"));
  });

  it("puts manual score entry on BETS only and supports F5 evidence", () => {
    const bets = readFileSync(new URL("../src/MyBetsView.jsx", import.meta.url), "utf8");
    const track = readFileSync(new URL("../src/TrackView.jsx", import.meta.url), "utf8");
    const endpoint = readFileSync(new URL("../functions/api/track.js", import.meta.url), "utf8");
    assert.match(bets, /Enter final score/);
    assert.match(bets, /F5 bets also require both first-five-inning scores/);
    assert.match(bets, /action: "manual-final"/);
    assert.ok(!track.includes("Manual final"));
    assert.ok(!track.includes("manualFinalByRow"));
    assert.match(endpoint, /f5Score: hasF5Home/);
  });

  it("SYS notes board confirm does not paste HARVEST_SECRET", () => {
    const sys = readFileSync(new URL("../src/TrackView.jsx", import.meta.url), "utf8");
    const modal = readFileSync(new URL("../src/HeritageImport.jsx", import.meta.url), "utf8");
    assert.match(sys, /without pasting HARVEST_SECRET/);
    assert.match(modal, /2 · Confirm D1 write/);
    assert.doesNotMatch(modal, /id="harvest-secret"/);
  });

  it("confirm payload includes parsed tickets and the pasted textarea", () => {
    const req = buildConfirmRequest({
      text: HERITAGE_FIXTURE_PASTE,
      tickets: parsed.tickets,
      edits: [{ selectedTeam: "Los Angeles Dodgers" }],
    });
    assert.equal(req.ok, true);
    const json = JSON.stringify(req.body);
    assert.equal(req.body.action, "import");
    assert.match(req.body.text, /G10904318/);
    assert.match(req.body.text, /Los Angeles Dodgers/);
    assert.ok(Array.isArray(req.body.tickets));
    assert.equal(req.body.tickets.length, 5);
    const ids = req.body.tickets.map((t) => t.externalTicketId);
    assert.ok(ids.includes("G10904318"));
    assert.ok(ids.includes("G10904312"));
    assert.ok(ids.includes("G10904306"));
    assert.ok(ids.includes("G10904299"));
    assert.match(json, /G10904318/);
    assert.equal(req.body.tickets[0].selectedTeam, "Los Angeles Dodgers");
    assert.equal(req.body.tickets[0].attribution, undefined);
    assert.doesNotMatch(json, /pal_json/);
    assert.doesNotMatch(json, /palTotals/);
  });

  it("does not dump Cloudflare HTML 503 into the operator banner", async () => {
    const html = `<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->`;
    assert.equal(explainNonJsonHttp(503, html), CLOUDFLARE_HTML_503);
    await assert.rejects(
      () => readResponseJson({ status: 503, text: async () => html }),
      (err) => {
        assert.equal(err.message, CLOUDFLARE_HTML_503);
        assert.doesNotMatch(err.message, /DOCTYPE/);
        return true;
      }
    );
  });

  it("heritage snapshot match query does not select pal_json", async () => {
    let sql = "";
    const env = {
      DB: {
        prepare(s) {
          sql = s;
          return { bind: () => ({ all: async () => ({ results: [] }) }) };
        },
      },
    };
    await querySnapshots(env, { since: "2026-08-28", until: "2026-08-28", lite: true });
    assert.match(sql, /prediction_snapshots/);
    assert.doesNotMatch(sql, /\*/);
    assert.doesNotMatch(sql, /pal_json/);
    assert.doesNotMatch(sql, /layers_json/);
  });

  it("maps 401 and D1 unbound to visible messages", () => {
    const unauth = importResponseFeedback(401, { ok: false, error: "unauthorized", wrote: false });
    assert.equal(unauth.ok, false);
    assert.match(unauth.error, /401 unauthorized/i);
    const unbound = importResponseFeedback(503, { ok: false, error: "D1 unbound" });
    assert.equal(unbound.ok, false);
    assert.match(unbound.error, /D1 unbound/i);
    const wrote = importResponseFeedback(200, {
      accepted: [
        { id: "a", externalTicketId: "G10904318" },
        { id: "b", externalTicketId: "G10904312" },
      ],
      skipped: [],
      conflicts: [],
    });
    assert.equal(wrote.ok, true);
    assert.match(wrote.message, /Wrote 2 tickets/);
    assert.match(wrote.message, /G10904318/);
    assert.match(wrote.message, /G10904312/);
  });

  it("rejects off-site import without the harvest header (401, no write)", async () => {
    const env = { HARVEST_SECRET: "s3cret", DB: executedBetsDb().DB };
    const missing = await handleBetsPost(env, fakeReq({}), { action: "import", tickets: parsed.tickets });
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, "unauthorized");
    assert.equal(missing.body.wrote, false);
    assert.doesNotMatch(JSON.stringify(missing.body), /s3cret/);

    const empty = await handleBetsPost(env, fakeReq({ "x-strategy-secret": "" }), { action: "import", tickets: parsed.tickets });
    assert.equal(empty.status, 401);
    assert.equal(empty.body.wrote, false);
  });

  it("rejects import with the wrong secret as 401 when not same-origin", async () => {
    const env = { HARVEST_SECRET: "s3cret", DB: executedBetsDb().DB };
    const result = await handleBetsPost(env, fakeReq({ "x-strategy-secret": "nope" }), { action: "import", tickets: parsed.tickets });
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
    assert.equal(result.body.wrote, false);
    assert.doesNotMatch(JSON.stringify(result.body), /s3cret/);
  });

  it("allows same-origin board import without a harvest header", async () => {
    assert.equal(isSameOriginOperatorRequest(fakeReq({})), false);
    assert.equal(isSameOriginOperatorRequest(fakeReq({ origin: "https://fbis-myz.pages.dev" })), true);
    assert.equal(isSameOriginOperatorRequest(fakeReq({ origin: "https://evil.example" })), false);
    assert.equal(isSameOriginOperatorRequest(fakeReq({ "sec-fetch-site": "same-origin" })), true);
    const env = { HARVEST_SECRET: "s3cret", DB: executedBetsDb().DB };
    const auth = authorizeExecutedBetWrite(fakeReq({ origin: "https://fbis-myz.pages.dev" }), env);
    assert.equal(auth.ok, true);
    const db = executedBetsDb();
    const result = await handleBetsPost(
      { HARVEST_SECRET: "s3cret", DB: db.DB },
      fakeReq({ origin: "https://fbis-myz.pages.dev" }),
      { action: "import", text: HERITAGE_FIXTURE_PASTE, tickets: parsed.tickets }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.wrote, true);
    assert.equal(result.body.accepted.length, 5);
  });

  it("writes five unique ticket IDs when the operator secret matches", async () => {
    const db = executedBetsDb();
    const env = { HARVEST_SECRET: "s3cret", DB: db.DB };
    const parse = await handleBetsPost(env, fakeReq({}), { action: "parse", text: HERITAGE_FIXTURE_PASTE, yearHint: 2026 });
    assert.equal(parse.status, 200);
    assert.equal(parse.body.wrote, false);
    assert.equal(db.bets.size, 0);

    const result = await handleBetsPost(
      env,
      fakeReq({ "x-strategy-secret": "s3cret" }),
      { action: "import", text: HERITAGE_FIXTURE_PASTE, tickets: parsed.tickets }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.wrote, true);
    assert.equal(result.body.accepted.length, 5);
    const ids = result.body.accepted.map((a) => a.externalTicketId);
    assert.deepEqual(ids.sort(), ["G10902289", "G10904299", "G10904306", "G10904312", "G10904318"]);
    assert.equal(new Set(ids).size, 5);
    assert.equal(db.bets.size, 5);
    for (const row of db.bets.values()) {
      assert.equal(row.recommendation_status, "OPERATOR_ONLY");
      assert.equal(row.attribution_label, OPERATOR_ONLY);
      assert.notEqual(row.recommendation_status, "seed");
    }
  });

  it("re-parses pasted textarea when import tickets are omitted", async () => {
    const db = executedBetsDb();
    const env = { HARVEST_SECRET: "s3cret", DB: db.DB };
    const result = await handleBetsPost(
      env,
      fakeReq({ "x-strategy-secret": "s3cret" }),
      { action: "import", text: HERITAGE_FIXTURE_PASTE, yearHint: 2026 }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.wrote, true);
    const ids = result.body.accepted.map((a) => a.externalTicketId).sort();
    assert.ok(ids.includes("G10904318"));
    assert.equal(db.bets.size, 5);
  });

  it("returns D1 unbound when DB is missing even with a secret", async () => {
    const result = await handleBetsPost(
      { HARVEST_SECRET: "s3cret" },
      fakeReq({ "x-strategy-secret": "s3cret" }),
      { action: "import", tickets: parsed.tickets }
    );
    assert.equal(result.status, 503);
    assert.match(result.body.error, /D1 unbound/i);
  });
});

describe("NoVig screenshot OCR text", () => {
  it("parses a mobile player-prop receipt without storing the image", async () => {
    const parsed = await parseNoVigSlip(
      "NOVIG Blade Tidwell U 4.5 55.0% Strikeouts Thrown Amount $5.00 To Pay $9.09 SF Live 3rd 0 - 2 PIT Placed: 11:31AM",
      { dateHint: "2026-09-03" }
    );
    assert.equal(parsed.tickets.length, 1);
    const ticket = parsed.tickets[0];
    assert.equal(ticket.executionBook, "NoVig");
    assert.equal(ticket.selectedTeam, "Blade Tidwell");
    assert.equal(ticket.selectedSide, "UNDER");
    assert.equal(ticket.executionLine, 4.5);
    assert.equal(ticket.propType, "PITCHER_STRIKEOUTS");
    assert.equal(ticket.riskAmount, 5);
    assert.equal(ticket.toWinAmount, 4.09);
    assert.equal(ticket.potentialPayout, 9.09);
    assert.equal(ticket.executionPrice, -122);
    assert.equal(ticket.awayTeam, "San Francisco Giants");
    assert.equal(ticket.homeTeam, "Pittsburgh Pirates");
    assert.equal(ticket.awayIdentity.sport, "mlb");
    assert.equal(ticket.homeIdentity.sport, "mlb");
    assert.match(ticket.externalTicketId, /^NOVIG-/);
  });

  it("parses the sparse-layout OCR ordering produced by the real receipt", async () => {
    const parsed = await parseNoVigSlip(
      "Blade Tidwell U 4.5 55.0% MATCHED Strikeouts Thrown Amount ToPay $5.00 $9.09 Live a 3rd SF 0-2 PIT",
      { dateHint: "2026-09-03" }
    );
    const ticket = parsed.tickets[0];
    assert.equal(ticket.riskAmount, 5);
    assert.equal(ticket.potentialPayout, 9.09);
    assert.equal(ticket.awayTeam, "San Francisco Giants");
    assert.equal(ticket.homeTeam, "Pittsburgh Pirates");
    assert.ok(ticket.warnings.includes("Confirm placement time"));
  });

  it("keeps shared abbreviations inside MLB and matches the correct game", async () => {
    assert.equal(identityForSport("mlb", "SF").name, "San Francisco Giants");
    assert.equal(identityForSport("mlb", "PIT").name, "Pittsburgh Pirates");
    const parsed = await parseNoVigSlip(
      "Blade Tidwell U 4.5 55.0% MATCHED Strikeouts Thrown Amount ToPay $5.00 $9.09 Live a 3rd SF 0-2 PIT",
      { dateHint: "2026-09-03" }
    );
    const preview = await decoratePreview(parsed.tickets[0], {
      games: [{
        id: "mlb-sf-pit",
        sport: "mlb",
        date: "2026-09-03",
        start: "2026-09-03T16:35:00.000Z",
        away: { name: "San Francisco Giants", abbr: "SF" },
        home: { name: "Pittsburgh Pirates", abbr: "PIT" },
      }],
    });
    assert.equal(preview.matchStatus, "matched");
    assert.equal(preview.gameId, "mlb-sf-pit");
    assert.equal(preview.awayIdentity.name, "San Francisco Giants");
    assert.equal(preview.homeIdentity.name, "Pittsburgh Pirates");
    assert.notEqual(preview.awayIdentity.canonicalId, null);
    assert.notEqual(preview.homeIdentity.canonicalId, null);
  });

  it("grades an operator-entered player statistic against the frozen side and line", () => {
    const ticket = { selectedSide: "UNDER", executionLine: 4.5, riskAmount: 5, toWinAmount: 4.09, potentialPayout: 9.09 };
    const won = settlePlayerProp(ticket, 3);
    assert.equal(won.result, "WON");
    assert.equal(won.profit, 4.09);
    const lost = settlePlayerProp(ticket, 6);
    assert.equal(lost.result, "LOST");
    assert.equal(lost.profit, -5);
    assert.equal(settlePlayerProp({ ...ticket, executionLine: 4 }, 4).result, "PUSH");
  });
});

const PRIZEPICKS_POWER_PLAY_FIXTURE = `PRIZEPICKS
$5 to win $30
3-Pick Power Play
NFL | DEN vs KC
Starts in 41:44
Patrick Mahomes
KC • QB • #15
↑ 0.5 Pass Attempts
Bo Nix
DEN • QB • #10
↓ 17.5 Rush Yards
RJ Harvey
DEN • RB • #12
↑ 17.5 Rush Yards
Slide for Refund : $5
Self refund available. Time remaining: 03:53
PRIZEPICKS
Sep 14, 2026 @ 6:33 PM`;

describe("PrizePicks Power Play slip", () => {
  it("detects PrizePicks from slip text and book hint", () => {
    assert.equal(looksLikePrizePicksSlip(PRIZEPICKS_POWER_PLAY_FIXTURE), true);
    assert.equal(looksLikePrizePicksSlip("", "PrizePicks"), true);
    assert.equal(looksLikePrizePicksSlip("Heritage G10904318"), false);
  });

  it("expands a 3-pick Power Play into three PLAYER_PROP tickets with stake on leg 1", async () => {
    const parsed = await parsePrizePicksSlip(PRIZEPICKS_POWER_PLAY_FIXTURE);
    assert.equal(parsed.tickets.length, 3);
    assert.equal(parsed.totalRisk, 5);
    assert.equal(parsed.totalToWin, 25);
    assert.equal(parsed.entryType, "POWER_PLAY");
    const [a, b, c] = parsed.tickets;
    assert.equal(a.executionBook, "PrizePicks");
    assert.equal(a.market, "PLAYER_PROP");
    assert.equal(a.playerName, "Patrick Mahomes");
    assert.equal(a.selectedSide, "OVER");
    assert.equal(a.executionLine, 0.5);
    assert.equal(a.propType, "PASS_ATTEMPTS");
    assert.equal(a.riskAmount, 5);
    assert.equal(a.toWinAmount, 25);
    assert.equal(a.potentialPayout, 30);
    assert.equal(a.executionPrice, 500);
    assert.equal(a.sport, "nfl");
    assert.equal(a.date, "2026-09-14");
    assert.equal(a.awayTeam, "Denver Broncos");
    assert.equal(a.homeTeam, "Kansas City Chiefs");
    assert.equal(a.awayIdentity.canonicalId, "nfl-7");
    assert.equal(a.homeIdentity.canonicalId, "nfl-12");
    assert.match(a.externalTicketId, /^PP-[A-F0-9]+-L1$/);

    assert.equal(b.playerName, "Bo Nix");
    assert.equal(b.selectedSide, "UNDER");
    assert.equal(b.executionLine, 17.5);
    assert.equal(b.propType, "RUSH_YARDS");
    assert.equal(b.riskAmount, 0);
    assert.equal(b.executionPrice, null);
    assert.match(b.externalTicketId, /-L2$/);

    assert.equal(c.playerName, "RJ Harvey");
    assert.equal(c.selectedSide, "OVER");
    assert.equal(c.executionLine, 17.5);
    assert.equal(c.propType, "RUSH_YARDS");
    assert.equal(c.riskAmount, 0);
    assert.equal(a.entryId, b.entryId);
    assert.equal(b.entryId, c.entryId);
  });

  it("parses More/Less wording and routes through parseBetsPreview", async () => {
    const text = `$5 to win $30
2-Pick Power Play
NFL | DEN vs KC
Patrick Mahomes More 0.5 Pass Attempts
Bo Nix Less 17.5 Rush Yards
Sep 14, 2026`;
    assert.equal(looksLikePrizePicksSlip(text, "PrizePicks"), true);
    const parsed = await parsePrizePicksSlip(text);
    assert.equal(parsed.tickets.length, 2);
    assert.equal(parsed.tickets[0].selectedSide, "OVER");
    assert.equal(parsed.tickets[1].selectedSide, "UNDER");

    const preview = await parseBetsPreview({}, text, { date: "2026-09-14" }, "PrizePicks");
    assert.equal(preview.wrote, false);
    assert.equal(preview.n, 2);
    assert.equal(preview.props, 2);
    assert.equal(preview.tickets[0].executionBook, "PrizePicks");
  });

  it("treats PLAYER_PROP as an over/under market in the importer UX helper", () => {
    assert.equal(isTotalMarket("PLAYER_PROP"), true);
    assert.equal(isTotalMarket("TOTAL"), true);
    assert.equal(isTotalMarket("ML"), false);
  });
});

function fakeReq(headers = {}) {
  return {
    url: "https://fbis-myz.pages.dev/api/bets",
    headers: {
      get(name) {
        const key = Object.keys(headers).find((k) => k.toLowerCase() === String(name).toLowerCase());
        return key ? headers[key] : null;
      },
    },
  };
}

function executedBetsDb() {
  const bets = new Map();
  return {
    bets,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async run() {
                if (sql.includes("INSERT INTO executed_bets")) {
                  const row = executedRowFromInsert(args);
                  bets.set(`${row.execution_book}|${row.external_ticket_id}`, row);
                }
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes("FROM executed_bets WHERE execution_book")) {
                  return bets.get(`${args[0]}|${args[1]}`) || null;
                }
                return null;
              },
              async all() {
                if (sql.includes("FROM executed_bets")) {
                  return { results: [...bets.values()] };
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

function executedRowFromInsert(args) {
  return {
    id: args[0],
    external_ticket_id: args[1],
    execution_book: args[2],
    executed_at: args[3],
    timezone: args[4],
    sport: args[5],
    date: args[6],
    game_id: args[7],
    source_event_id: args[8],
    source_url: args[9],
    matchup_text: args[10],
    away_team: args[11],
    home_team: args[12],
    market: args[13],
    period: args[14],
    selected_side: args[15],
    selected_team: args[16],
    execution_line: args[17],
    execution_price: args[18],
    risk_amount: args[19],
    to_win_amount: args[20],
    potential_payout: args[21],
    currency: args[22],
    imported_at: args[23],
    import_source: args[24],
    raw_text_hash: args[25],
    raw_text: args[26],
    match_status: args[27],
    match_confidence: args[28],
    matched_prediction_id: args[29],
    matched_strategy_ticket_id: args[30],
    recommendation_status: args[31],
    model_version_at_entry: args[32],
    checkpoint_at_entry: args[33],
    result: args[34],
    settled_return: args[35],
    profit: args[36],
    graded_at: args[37],
    void_reason: args[38],
    heritage_current_line: args[39],
    heritage_current_price: args[40],
    heritage_current_at: args[41],
    pin_entry_line: args[42],
    pin_entry_price: args[43],
    pin_entry_no_vig: args[44],
    pin_close_line: args[45],
    pin_close_price: args[46],
    pin_close_no_vig: args[47],
    clv: args[48],
    clv_status: args[49],
    clv_method_version: args[50],
    attribution_label: args[51],
  };
}
