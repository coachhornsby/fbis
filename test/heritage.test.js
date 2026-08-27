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
import {
  matchExecutedBet,
  attributeRecommendation,
  attachPinnacleClv,
  settleExecutedBet,
  immutableConflict,
  summarizeExecutedBets,
  decoratePreview,
  OPERATOR_ONLY,
} from "../functions/lib/executedBets.js";
import { selectClose, selectPinAtOrBefore, packPinOddsRows, isPostStart, CLV_UNAVAILABLE, clvTracker } from "../functions/lib/closeCapture.js";
import { parseBetsPreview, handleBetsPost } from "../functions/api/bets.js";
import {
  HARVEST_SECRET_PLACEHOLDER,
  NO_TICKETS_TO_WRITE,
  OPERATOR_SECRET_HINT,
  OPERATOR_SECRET_REQUIRED,
  PLACEHOLDER_AS_SECRET,
  buildConfirmRequest,
  confirmStatusLine,
  confirmWriteGuard,
  importResponseFeedback,
  isHintSecret,
  normalizePastedSecret,
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
    assert.match(empty.message, /No imported Heritage bets/);
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

  it("shows Operator secret required when confirm is clicked with an empty secret", () => {
    const empty = confirmWriteGuard({ secret: "", ticketCount: 5 });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, OPERATOR_SECRET_REQUIRED);
    const blank = confirmWriteGuard({ secret: "   ", ticketCount: 5 });
    assert.equal(blank.ok, false);
    assert.equal(blank.error, OPERATOR_SECRET_REQUIRED);
    const none = confirmWriteGuard({ secret: "ok", ticketCount: 0 });
    assert.equal(none.ok, false);
    assert.equal(none.error, NO_TICKETS_TO_WRITE);
    assert.equal(confirmWriteGuard({ secret: "ok", ticketCount: 5 }).ok, true);
    assert.equal(confirmWriteGuard({ secret: "ok", ticketCount: 0, hasText: true }).ok, true);
  });

  it("treats the placeholder string as empty and refuses it as the secret", () => {
    assert.equal(HARVEST_SECRET_PLACEHOLDER, "not stored in the app bundle");
    assert.equal(isHintSecret(""), false);
    assert.equal(isHintSecret("s3cret"), false);
    assert.equal(isHintSecret(HARVEST_SECRET_PLACEHOLDER), true);
    assert.equal(isHintSecret(`  ${HARVEST_SECRET_PLACEHOLDER}  `), true);
    assert.equal(isHintSecret("Not stored in the app bundle."), true);
    assert.equal(isHintSecret(OPERATOR_SECRET_HINT), true);
    assert.equal(normalizePastedSecret(HARVEST_SECRET_PLACEHOLDER), "");
    assert.equal(normalizePastedSecret("  s3cret  "), "s3cret");

    const pasted = confirmWriteGuard({ secret: HARVEST_SECRET_PLACEHOLDER, ticketCount: 4 });
    assert.equal(pasted.ok, false);
    assert.equal(pasted.error, PLACEHOLDER_AS_SECRET);
    assert.match(pasted.error, /That text is a hint, not the secret/);
    assert.match(pasted.error, /Paste HARVEST_SECRET from Cloudflare Pages/);

    const req = buildConfirmRequest({
      secret: HARVEST_SECRET_PLACEHOLDER,
      text: HERITAGE_FIXTURE_PASTE,
      tickets: parsed.tickets,
    });
    assert.equal(req.ok, false);
    assert.equal(req.error, PLACEHOLDER_AS_SECRET);
    assert.equal(req.body, undefined);
    assert.equal(req.headers, undefined);

    const line = confirmStatusLine({
      busy: false,
      error: "",
      wroteMessage: "",
      secret: HARVEST_SECRET_PLACEHOLDER,
      ticketCount: 4,
    });
    assert.equal(line.kind, "error");
    assert.equal(line.text, PLACEHOLDER_AS_SECRET);

    const afterClick = confirmStatusLine({
      busy: false,
      error: PLACEHOLDER_AS_SECRET,
      wroteMessage: "",
      secret: HARVEST_SECRET_PLACEHOLDER,
      ticketCount: 4,
    });
    assert.equal(afterClick.kind, "error");
    assert.equal(afterClick.text, PLACEHOLDER_AS_SECRET);
  });

  it("HeritageImport secret field is empty value + placeholder, labeled HARVEST_SECRET", () => {
    const src = readFileSync(new URL("../src/HeritageImport.jsx", import.meta.url), "utf8");
    assert.ok(src.includes('const [secret, setSecret] = useState(""); // never the placeholder string'));
    assert.ok(src.includes("placeholder={HARVEST_SECRET_PLACEHOLDER}"));
    assert.ok(src.includes("HARVEST_SECRET"));
    assert.ok(!src.includes("useState(HARVEST_SECRET_PLACEHOLDER)"));
    assert.ok(!src.includes('useState("not stored in the app bundle")'));
    assert.ok(!src.includes("value={HARVEST_SECRET_PLACEHOLDER}"));
  });

  it("empty secret is a 4xx UI path and never a silent no-op", () => {
    const req = buildConfirmRequest({
      secret: "",
      text: HERITAGE_FIXTURE_PASTE,
      tickets: parsed.tickets,
    });
    assert.equal(req.ok, false);
    assert.equal(req.error, OPERATOR_SECRET_REQUIRED);
    assert.equal(req.body, undefined);
    const line = confirmStatusLine({ busy: false, error: req.error, wroteMessage: "", secret: "", ticketCount: 4 });
    assert.equal(line.kind, "error");
    assert.equal(line.text, OPERATOR_SECRET_REQUIRED);
    const missing = confirmStatusLine({ busy: false, error: "", wroteMessage: "", secret: "", ticketCount: 4 });
    assert.equal(missing.kind, "error");
    assert.equal(missing.text, OPERATOR_SECRET_REQUIRED);
  });

  it("confirm payload includes parsed tickets and the pasted textarea", () => {
    const req = buildConfirmRequest({
      secret: "s3cret",
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
    assert.equal(req.headers["x-strategy-secret"], "s3cret");
    assert.equal(req.headers["x-harvest-secret"], "s3cret");
    assert.doesNotMatch(json, /s3cret/);
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

  it("rejects import with empty secret (401, no write)", async () => {
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

  it("rejects import with the wrong secret as 401", async () => {
    const env = { HARVEST_SECRET: "s3cret", DB: executedBetsDb().DB };
    const result = await handleBetsPost(env, fakeReq({ "x-strategy-secret": "nope" }), { action: "import", tickets: parsed.tickets });
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
    assert.equal(result.body.wrote, false);
    assert.doesNotMatch(JSON.stringify(result.body), /s3cret/);
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
