import test from "node:test";
import assert from "node:assert/strict";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";
import {
  ACTION_FIREWALL,
  ACTION_SNAPSHOT_TYPE,
  actionMayAuthorizeWager,
  actionMayDirectlyQualifyWager,
  actionMayEnterPureGameFeatures,
  actionMayEnterPurePlayerFeatures,
  assertActionFirewall,
  buildActionObservationKey,
  deriveActionSnapshotType,
  derivePublicSplitMetrics,
  expandBookObservations,
  expandPlayerPropObservations,
  persistActionObservationSeries,
  selectSeriesSnapshot,
} from "../functions/lib/actionObservationSeries.js";
import { assertNotPureMarketSource } from "../functions/lib/canonical/index.js";

function memorySeriesDb() {
  const observations = new Map();
  const pointers = new Map();
  return {
    observations,
    pointers,
    async queryOne(sql, params = []) {
      if (/FROM action_market_book_observations WHERE observation_key/i.test(sql)) {
        const row = observations.get(params[0]);
        return row ? { id: row.id } : null;
      }
      return null;
    },
    async exec(sql, params = []) {
      if (/INSERT OR IGNORE INTO action_market_book_observations/i.test(sql)) {
        const key = params[1];
        if (observations.has(key)) return { success: true };
        observations.set(key, {
          id: params[0],
          observation_key: key,
          canonical_event_id: params[2],
          canonical_player_id: params[3],
          provider_event_id: params[4],
          provider_player_id: params[5],
          sport: params[6],
          market_type: params[7],
          market_period: params[8],
          selection: params[9],
          line: params[10],
          american_price: params[11],
          sportsbook: params[12],
          provider_timestamp: params[13],
          collected_at: params[14],
          event_start_time: params[15],
          snapshot_type: params[16],
          public_ticket_pct: params[17],
          public_money_pct: params[18],
          money_minus_ticket_pct: params[19],
          tracked_bet_count: params[20],
          tracked_volume: params[21],
          raw_payload_hash: params[22],
          match_confidence: params[23],
          schema_version: params[24],
          run_id: params[25],
          source_observation_id: params[26],
          decision_eligible: 0,
          can_qualify: 0,
          can_authorize_wager: 0,
          created_at: params[27],
        });
        return { success: true };
      }
      if (/INTO action_market_snapshot_pointers/i.test(sql)) {
        pointers.set(params[0], { id: params[0] });
      }
      return { success: true };
    },
  };
}

test("prohibition 1: ACTION cannot enter PURE game features", () => {
  assert.equal(actionMayEnterPureGameFeatures(), false);
  assert.equal(ACTION_FIREWALL.pureGameFeatureAllowed, false);
  assert.equal(assertNotPureMarketSource("action_apify").ok, true);
  const blocked = assertActionFirewall({ pureGameFeature: true });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.violations.includes("pure_game_feature"));
});

test("prohibition 2: ACTION cannot enter PURE player features", () => {
  assert.equal(actionMayEnterPurePlayerFeatures(), false);
  assert.equal(ACTION_FIREWALL.purePlayerFeatureAllowed, false);
  const blocked = assertActionFirewall({ purePlayerFeature: true });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.violations.includes("pure_player_feature"));
});

test("prohibition 3: ACTION cannot directly qualify a wager", () => {
  assert.equal(actionMayDirectlyQualifyWager(), false);
  assert.equal(ACTION_FIREWALL.canQualify, false);
  const blocked = assertActionFirewall({ canQualify: true });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.violations.includes("can_qualify"));
});

test("prohibition 4: ACTION cannot authorize a wager", () => {
  assert.equal(actionMayAuthorizeWager(), false);
  assert.equal(ACTION_FIREWALL.canAuthorizeWager, false);
  const blocked = assertActionFirewall({ canAuthorizeWager: true });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.violations.includes("can_authorize_wager"));
});

test("ACTION stays out of the production odds router", () => {
  assert.equal(ACTION_FIREWALL.inProductionRouter, false);
  assert.equal(ODDS_PROVIDER_ORDER.some((p) => /action/i.test(String(p))), false);
  const blocked = assertActionFirewall({ oddsProviderOrder: [...ODDS_PROVIDER_ORDER, "ACTION_APIFY"] });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.violations.includes("in_production_router"));
});

test("ticket % and money % stay independent; differential is derived; no sharp label", () => {
  const split = derivePublicSplitMetrics({
    publicTicketPct: 62,
    publicMoneyPct: 48,
    trackedBetCount: 1200,
    providerSharpLabel: "away",
  });
  assert.equal(split.publicTicketPct, 62);
  assert.equal(split.publicMoneyPct, 48);
  assert.equal(split.moneyMinusTicketPct, -14);
  assert.equal(split.trackedBetCount, 1200);
  assert.equal(split.sharpLabelApplied, false);
  assert.equal(split.providerSharpLabelIgnored, "away");
});

test("player-prop keys include event+player+market+period+selection+book+time", () => {
  const base = {
    providerEventId: "g1",
    canonicalPlayerId: "pl1",
    marketType: "passing_yards",
    marketPeriod: "event",
    selection: "over",
    sportsbook: "draftkings",
    collectedAt: "2026-09-13T12:00:00Z",
  };
  const a = buildActionObservationKey(base);
  const b = buildActionObservationKey({ ...base, sportsbook: "fanduel" });
  const c = buildActionObservationKey({ ...base, selection: "under" });
  const d = buildActionObservationKey({ ...base, canonicalPlayerId: "pl2" });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test("observations are append-only; prior rows are never overwritten", async () => {
  const db = memorySeriesDb();
  const openSource = {
    actionGameId: "ag1",
    sport: "cfb",
    period: "event",
    startTime: "2026-09-13T19:00:00Z",
    observedAt: "2026-09-13T10:00:00Z",
    publicBetting: {
      spreadHome: { ticketsPercent: 60, moneyPercent: 45, sharpSide: "away" },
    },
    books: [
      {
        book: "pinnacle",
        spreadHome: -3.5,
        spreadHomeOdds: -110,
        spreadAway: 3.5,
        spreadAwayOdds: -110,
      },
    ],
    playerProps: [
      {
        providerPlayerId: "p1",
        fbisPlayerId: "cp1",
        market: "passing_yards",
        book: "draftkings",
        line: 245.5,
        overOdds: -115,
        underOdds: -105,
        observedAt: "2026-09-13T10:00:00Z",
      },
    ],
  };

  const openRows = [
    ...expandBookObservations(openSource, {
      canonicalEventId: "e1",
      lifecycle: "open",
      collectedAt: "2026-09-13T10:00:00Z",
      isFirstForMarket: true,
    }),
    ...expandPlayerPropObservations(openSource, {
      canonicalEventId: "e1",
      lifecycle: "open",
      collectedAt: "2026-09-13T10:00:00Z",
    }),
  ];
  assert.ok(openRows.some((r) => r.snapshotType === ACTION_SNAPSHOT_TYPE.OPEN));
  assert.ok(openRows.every((r) => r.sharpLabelApplied === false));
  assert.ok(openRows.every((r) => r.canQualify === 0 && r.canAuthorizeWager === 0 && r.decisionEligible === 0));

  const first = await persistActionObservationSeries(db, openRows);
  assert.ok(first.inserted > 0);
  const openCount = db.observations.size;
  const openHome = [...db.observations.values()].find((o) => o.market_type === "spread" && o.selection === "home");
  assert.ok(openHome);
  assert.equal(openHome.line, -3.5);
  assert.equal(openHome.public_ticket_pct, 60);
  assert.equal(openHome.public_money_pct, 45);
  assert.equal(openHome.money_minus_ticket_pct, -15);

  const laterSource = {
    ...openSource,
    observedAt: "2026-09-13T16:00:00Z",
    books: [
      {
        book: "pinnacle",
        spreadHome: -4.5,
        spreadHomeOdds: -108,
        spreadAway: 4.5,
        spreadAwayOdds: -112,
      },
    ],
    playerProps: [
      {
        providerPlayerId: "p1",
        fbisPlayerId: "cp1",
        market: "passing_yards",
        book: "draftkings",
        line: 252.5,
        overOdds: -110,
        underOdds: -110,
        observedAt: "2026-09-13T16:00:00Z",
      },
    ],
  };
  const currentRows = [
    ...expandBookObservations(laterSource, {
      canonicalEventId: "e1",
      lifecycle: "pregame",
      collectedAt: "2026-09-13T16:00:00Z",
    }),
    ...expandPlayerPropObservations(laterSource, {
      canonicalEventId: "e1",
      lifecycle: "pregame",
      collectedAt: "2026-09-13T16:00:00Z",
    }),
  ];
  const second = await persistActionObservationSeries(db, currentRows);
  assert.ok(second.inserted > 0);
  assert.ok(db.observations.size > openCount);

  const again = await persistActionObservationSeries(db, openRows);
  assert.equal(again.inserted, 0);
  assert.ok(again.ignored > 0);
  assert.equal(db.observations.get(openHome.observation_key).line, -3.5);

  const homeSeries = [...db.observations.values()]
    .filter((o) => o.market_type === "spread" && o.selection === "home")
    .map((o) => ({ snapshotType: o.snapshot_type, line: o.line, collectedAt: o.collected_at }));
  const openSnap = selectSeriesSnapshot(homeSeries, ACTION_SNAPSHOT_TYPE.OPEN);
  const currentSnap = selectSeriesSnapshot(homeSeries, ACTION_SNAPSHOT_TYPE.CURRENT);
  assert.equal(openSnap.line, -3.5);
  assert.equal(currentSnap.line, -4.5);

  const propKeys = [...db.observations.values()]
    .filter((o) => o.canonical_player_id === "cp1")
    .map((o) => o.observation_key);
  assert.equal(new Set(propKeys).size, propKeys.length);
  assert.ok(propKeys.length >= 4);
});

test("snapshot types derive OPEN/CURRENT/DECISION/FINAL_PREGAME/CLOSE", () => {
  assert.equal(deriveActionSnapshotType({ lifecycle: "open" }), ACTION_SNAPSHOT_TYPE.OPEN);
  assert.equal(deriveActionSnapshotType({ lifecycle: "decision" }), ACTION_SNAPSHOT_TYPE.DECISION);
  assert.equal(deriveActionSnapshotType({ lifecycle: "final_pregame" }), ACTION_SNAPSHOT_TYPE.FINAL_PREGAME);
  assert.equal(deriveActionSnapshotType({ lifecycle: "close" }), ACTION_SNAPSHOT_TYPE.CLOSE);
  assert.equal(deriveActionSnapshotType({ lifecycle: "pregame" }), ACTION_SNAPSHOT_TYPE.CURRENT);
  assert.equal(
    deriveActionSnapshotType({ eventStartTime: "2026-09-13T19:00:00Z", collectedAt: "2026-09-13T18:50:00Z" }),
    ACTION_SNAPSHOT_TYPE.FINAL_PREGAME
  );
});

test("D1 adapter batches immutable quote inserts and pointer updates", async () => {
  const batchCalls = [];
  const db = {
    async batch(statements) {
      batchCalls.push(statements);
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
  const rows = expandBookObservations(
    {
      actionGameId: "ag-batch",
      sport: "mlb",
      startTime: "2026-09-14T23:00:00Z",
      books: [{
        book: "pinnacle",
        spreadHome: -1.5,
        spreadHomeOdds: -110,
        spreadAway: 1.5,
        spreadAwayOdds: -110,
        moneylineHome: -145,
        moneylineAway: 130,
      }],
    },
    {
      canonicalEventId: "fbis-batch",
      lifecycle: "pregame",
      collectedAt: "2026-09-14T16:00:00Z",
    }
  );
  const result = await persistActionObservationSeries(db, rows);
  assert.equal(batchCalls.length, 2);
  assert.equal(batchCalls[0].length, rows.length);
  assert.equal(batchCalls[1].length, rows.length);
  assert.equal(result.inserted, rows.length);
  assert.equal(result.pointers, rows.length);
});

test("persist rejects rows that attempt to set qualify/authorize flags", async () => {
  const db = memorySeriesDb();
  const [row] = expandBookObservations(
    {
      actionGameId: "ag1",
      sport: "cfb",
      books: [{ book: "pinnacle", spreadHome: -3, spreadHomeOdds: -110 }],
    },
    { collectedAt: "2026-09-13T12:00:00Z", canonicalEventId: "e1" }
  );
  await assert.rejects(
    () => persistActionObservationSeries(db, [{ ...row, canQualify: 1 }]),
    /action_firewall_violation|can_qualify/
  );
});
