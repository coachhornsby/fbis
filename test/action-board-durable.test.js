/**
 * ACTION → FBIS Board durable integration regressions (A–K)
 * + PrizePicks open-bet visibility after slip confirm.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_BOARD_SOURCE,
  buildDurableActionEventState,
  buildPublicSplitsFromObservations,
  buildLineHistoryFromObservations,
  loadDurableActionEventStates,
  persistActionEventIdentityLink,
  isPersistableActionMatchConfidence,
} from "../functions/lib/actionEventState.js";
import {
  attachActionIntelToGames,
  rematchBoardActionIntel,
} from "../functions/lib/boardActionIntel.js";
import { resolveCanonicalMarket } from "../functions/lib/canonical/marketRoles.js";
import { toBoardGame } from "../functions/lib/todayBoard.js";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";
import { MATCH_CONFIDENCE } from "../functions/lib/actionApifyCandidate.js";
import { executedAtFromSlipDate, parsePrizePicksSlip } from "../functions/lib/prizePicksSlip.js";
import { attachMyBetsToBoard } from "../functions/lib/executedBets.js";

function firewallAssert(obj, label = "firewall") {
  assert.equal(obj.inProductionRouter, false, `${label}.inProductionRouter`);
  assert.equal(obj.decisionEligible, false, `${label}.decisionEligible`);
  assert.equal(obj.canQualify, false, `${label}.canQualify`);
  assert.equal(obj.canAuthorizeWager, false, `${label}.canAuthorizeWager`);
  assert.equal(obj.pureGameFeatureAllowed, false, `${label}.pureGameFeatureAllowed`);
  assert.equal(obj.purePlayerFeatureAllowed, false, `${label}.purePlayerFeatureAllowed`);
}

function makeObs({
  id,
  eventId,
  providerEventId = "act_game_1",
  sport = "nfl",
  marketType = "spread",
  selection = "home",
  line = -3,
  americanPrice = -110,
  sportsbook = "DraftKings",
  snapshotType = "CURRENT",
  ticketPct = 40,
  moneyPct = 55,
  collectedAt,
  providerTimestamp,
}) {
  return {
    id,
    observation_key: `obs_${id}`,
    canonical_event_id: eventId,
    provider_event_id: providerEventId,
    sport,
    market_type: marketType,
    market_period: "event",
    selection,
    line,
    american_price: americanPrice,
    sportsbook,
    provider_timestamp: providerTimestamp || collectedAt,
    collected_at: collectedAt,
    snapshot_type: snapshotType,
    public_ticket_pct: ticketPct,
    public_money_pct: moneyPct,
    money_minus_ticket_pct:
      ticketPct != null && moneyPct != null ? moneyPct - ticketPct : null,
    decision_eligible: 0,
    can_qualify: 0,
    can_authorize_wager: 0,
    created_at: collectedAt,
  };
}

function makeDb({
  observations = [],
  pointers = [],
  identityLinks = [],
  shadowRows = [],
} = {}) {
  const state = {
    observations: [...observations],
    pointers: [...pointers],
    identityLinks: [...identityLinks],
    shadowRows: [...shadowRows],
  };

  function allFromSql(sql, binds) {
    const s = String(sql);
    if (/FROM action_event_identity_links/i.test(s)) {
      const wanted = new Set(binds.map(String));
      return state.identityLinks.filter((r) => wanted.has(String(r.canonical_event_id)));
    }
    if (/FROM action_market_book_observations/i.test(s)) {
      return state.observations.filter((r) => {
        if (Number(r.decision_eligible) || Number(r.can_qualify) || Number(r.can_authorize_wager)) {
          return false;
        }
        return binds.some(
          (b) =>
            String(r.canonical_event_id) === String(b) ||
            String(r.provider_event_id) === String(b)
        );
      });
    }
    if (/FROM action_market_snapshot_pointers/i.test(s)) {
      return state.pointers.filter((r) =>
        binds.some(
          (b) =>
            String(r.canonical_event_id) === String(b) ||
            String(r.provider_event_id) === String(b)
        )
      );
    }
    if (/FROM shadow_market_observations/i.test(s)) {
      if (/fbis_event_id IN/i.test(s)) {
        const wanted = new Set(binds.map(String));
        return state.shadowRows.filter((r) => wanted.has(String(r.fbis_event_id)));
      }
      return state.shadowRows.filter((r) => !r.fbis_event_id);
    }
    return [];
  }

  return {
    _state: state,
    prepare(sql) {
      const binds = [];
      const self = {
        bind(...args) {
          binds.push(...args);
          return self;
        },
        async all() {
          return { results: allFromSql(sql, binds) };
        },
        async run() {
          if (/INSERT INTO action_event_identity_links/i.test(sql)) {
            const [
              id,
              provider,
              providerEventId,
              sport,
              canonicalEventId,
              matchConfidence,
              matchReason,
              sourceObservationId,
              linkedAt,
            ] = binds;
            const existing = state.identityLinks.findIndex(
              (r) =>
                String(r.provider) === String(provider) &&
                String(r.provider_event_id) === String(providerEventId) &&
                String(r.sport) === String(sport)
            );
            const row = {
              id,
              provider,
              provider_event_id: providerEventId,
              sport,
              canonical_event_id: canonicalEventId,
              match_confidence: matchConfidence,
              match_reason: matchReason,
              source_observation_id: sourceObservationId,
              linked_at: linkedAt,
            };
            if (existing >= 0) state.identityLinks[existing] = row;
            else state.identityLinks.push(row);
            return { success: true };
          }
          return { success: true };
        },
      };
      return self;
    },
  };
}

test("A: ACTION is attached before canonical market resolution", async () => {
  const eventId = "nfl_den_kc_2026-09-14";
  const db = makeDb({
    observations: [
      makeObs({
        id: "o1",
        eventId,
        line: -3.5,
        ticketPct: 38,
        moneyPct: 61,
        collectedAt: "2026-09-13T21:00:00.000Z",
        snapshotType: "CURRENT",
      }),
    ],
  });
  const game = {
    id: eventId,
    sport: "nfl",
    start: "2026-09-14T20:00:00.000Z",
    home: { name: "Kansas City Chiefs", abbr: "KC" },
    away: { name: "Denver Broncos", abbr: "DEN" },
  };
  assert.equal(game.actionIntel, undefined);

  const attached = await attachActionIntelToGames([game], db);
  assert.equal(attached.attached, 1);
  assert.equal(attached.durableMatched, 1);
  assert.ok(attached.games[0].actionIntel);
  assert.equal(attached.games[0].actionIntel.source, ACTION_BOARD_SOURCE.DURABLE_SERIES);
  assert.equal(attached.games[0].publicSplits.ticketPct, 38);
  assert.equal(attached.games[0].publicSplits.moneyPct, 61);

  const market = resolveCanonicalMarket(attached.games[0]);
  assert.equal(market.intelligence?.available, true);
  assert.equal(market.intelligence?.ticketPct, 38);
  assert.equal(market.intelligence?.moneyPct, 61);
  assert.equal(market.intelligence?.firewall?.canQualify, false);
  assert.equal(market.intelligence?.firewall?.canAuthorizeWager, false);

  const boardRow = toBoardGame(attached.games[0], "nfl");
  assert.ok(boardRow.actionIntel);
  assert.equal(boardRow.actionIntel.publicSplits.ticketPct, 38);
  firewallAssert(boardRow.actionIntel, "boardRow.actionIntel");
});

test("B: refresh does not lose durable ACTION", async () => {
  const eventId = "nfl_refresh_1";
  const db = makeDb({
    observations: [
      makeObs({
        id: "r1",
        eventId,
        ticketPct: 44,
        moneyPct: 52,
        collectedAt: "2026-09-13T12:00:00.000Z",
      }),
    ],
  });
  const base = {
    id: eventId,
    sport: "nfl",
    home: { abbr: "KC", name: "Kansas City Chiefs" },
    away: { abbr: "DEN", name: "Denver Broncos" },
  };
  const first = await attachActionIntelToGames([{ ...base }], db);
  const second = await attachActionIntelToGames([{ ...base }], db);
  assert.equal(first.games[0].actionIntel.publicSplits.ticketPct, 44);
  assert.equal(second.games[0].actionIntel.publicSplits.ticketPct, 44);
  assert.equal(second.games[0].actionIntel.publicSplits.moneyPct, 52);
  assert.equal(second.durableMatched, 1);
});

test("C: date switching does not lose future-game ACTION", async () => {
  const tomorrowId = "nfl_future_1";
  const db = makeDb({
    observations: [
      makeObs({
        id: "f1",
        eventId: tomorrowId,
        ticketPct: 33,
        moneyPct: 48,
        collectedAt: "2026-09-13T10:00:00.000Z",
      }),
    ],
  });
  const tomorrowGame = {
    id: tomorrowId,
    sport: "nfl",
    start: "2026-09-15T20:00:00.000Z",
    home: { abbr: "BUF", name: "Buffalo Bills" },
    away: { abbr: "MIA", name: "Miami Dolphins" },
  };
  const todayGame = {
    id: "nfl_today_other",
    sport: "nfl",
    start: "2026-09-14T17:00:00.000Z",
    home: { abbr: "KC", name: "Kansas City Chiefs" },
    away: { abbr: "DEN", name: "Denver Broncos" },
  };

  const t1 = await attachActionIntelToGames([tomorrowGame], db);
  assert.equal(t1.games[0].actionIntel.publicSplits.ticketPct, 33);

  const today = await attachActionIntelToGames([todayGame], db);
  assert.equal(today.games[0].actionIntel, undefined);

  const t2 = await attachActionIntelToGames([{ ...tomorrowGame }], db);
  assert.equal(t2.games[0].actionIntel.publicSplits.ticketPct, 33);
  assert.equal(t2.games[0].actionIntel.publicSplits.moneyPct, 48);
});

test("D: durable reader beats older legacy shadow row", async () => {
  const eventId = "nfl_prefer_durable";
  const db = makeDb({
    observations: [
      makeObs({
        id: "d1",
        eventId,
        ticketPct: 70,
        moneyPct: 30,
        collectedAt: "2026-09-14T18:00:00.000Z",
      }),
    ],
    shadowRows: [
      {
        fbis_event_id: eventId,
        sport: "nfl",
        match_confidence: "HIGH",
        collected_at: "2026-09-10T12:00:00.000Z",
        consensus_json: JSON.stringify({ spreadHome: -1 }),
        public_betting_json: JSON.stringify({
          spreadHome: { ticketsPercent: 10, moneyPercent: 90 },
        }),
        decision_eligible: 0,
        can_qualify: 0,
        can_authorize_wager: 0,
      },
    ],
  });
  const out = await attachActionIntelToGames(
    [{ id: eventId, sport: "nfl", home: { abbr: "KC" }, away: { abbr: "DEN" } }],
    db
  );
  assert.equal(out.durableMatched, 1);
  assert.equal(out.legacyFallbackMatched, 0);
  assert.equal(out.games[0].actionIntel.source, ACTION_BOARD_SOURCE.DURABLE_SERIES);
  assert.equal(out.games[0].actionIntel.publicSplits.ticketPct, 70);
  assert.equal(out.games[0].actionIntel.publicSplits.moneyPct, 30);
});

test("E: missing ACTION remains null — never synthetic 0%", async () => {
  const db = makeDb();
  const out = await attachActionIntelToGames(
    [{ id: "nfl_no_action", sport: "nfl", home: { abbr: "KC" }, away: { abbr: "DEN" } }],
    db
  );
  assert.equal(out.attached, 0);
  assert.equal(out.games[0].actionIntel, undefined);
  assert.equal(out.games[0].publicSplits, undefined);

  const emptySplits = buildPublicSplitsFromObservations([]);
  assert.equal(emptySplits.ticketPct, null);
  assert.equal(emptySplits.moneyPct, null);

  const missingPctRow = buildPublicSplitsFromObservations([
    {
      market_type: "spread",
      selection: "home",
      collected_at: "2026-09-14T12:00:00.000Z",
    },
  ]);
  assert.equal(missingPctRow.ticketPct, null);
  assert.equal(missingPctRow.moneyPct, null);
});

test("F: true zero ticket/money remains zero", () => {
  const splits = buildPublicSplitsFromObservations([
    {
      market_type: "spread",
      selection: "home",
      public_ticket_pct: 0,
      public_money_pct: 0,
      collected_at: "2026-09-14T12:00:00.000Z",
    },
  ]);
  assert.equal(splits.ticketPct, 0);
  assert.equal(splits.moneyPct, 0);
  assert.equal(splits.moneyTicketGap, 0);

  const state = buildDurableActionEventState({
    eventId: "nfl_zero",
    sport: "nfl",
    observations: [
      makeObs({
        id: "z1",
        eventId: "nfl_zero",
        ticketPct: 0,
        moneyPct: 0,
        collectedAt: "2026-09-14T12:00:00.000Z",
      }),
    ],
  });
  assert.equal(state.publicSplits.ticketPct, 0);
  assert.equal(state.publicSplits.moneyPct, 0);
});

test("G: OPEN and CURRENT survive; observations stay immutable", async () => {
  const eventId = "nfl_open_current";
  const open = makeObs({
    id: "open1",
    eventId,
    line: -3,
    snapshotType: "OPEN",
    ticketPct: 50,
    moneyPct: 50,
    collectedAt: "2026-09-13T12:00:00.000Z",
  });
  const current = makeObs({
    id: "cur1",
    eventId,
    line: -2.5,
    snapshotType: "CURRENT",
    ticketPct: 41,
    moneyPct: 58,
    collectedAt: "2026-09-14T16:00:00.000Z",
  });
  const db = makeDb({
    observations: [open, current],
    pointers: [
      {
        snapshot_type: "OPEN",
        observation_id: "open1",
        canonical_event_id: eventId,
        provider_event_id: "act_game_1",
        derived_at: "2026-09-13T12:00:00.000Z",
      },
      {
        snapshot_type: "CURRENT",
        observation_id: "cur1",
        canonical_event_id: eventId,
        provider_event_id: "act_game_1",
        derived_at: "2026-09-14T16:00:00.000Z",
      },
    ],
  });
  const map = await loadDurableActionEventStates(db, [eventId]);
  const state = map.get(eventId);
  assert.ok(state);
  assert.equal(state.snapshots.open.line, -3);
  assert.equal(state.snapshots.current.line, -2.5);
  assert.equal(state.snapshots.open.observationId, "open1");
  assert.equal(state.snapshots.current.observationId, "cur1");
  assert.equal(open.line, -3);
  assert.equal(current.line, -2.5);
  assert.equal(state.snapshots.close, null);
  assert.equal(state.snapshots.finalPregame, null);
});

test("H: line history is time-ordered from durable observations", () => {
  const rows = [
    makeObs({
      id: "h1",
      eventId: "e",
      line: -3,
      collectedAt: "2026-09-13T12:00:00.000Z",
      providerTimestamp: "2026-09-13T12:00:00.000Z",
    }),
    makeObs({
      id: "h2",
      eventId: "e",
      line: -2.5,
      collectedAt: "2026-09-14T10:00:00.000Z",
      providerTimestamp: "2026-09-14T10:00:00.000Z",
    }),
    makeObs({
      id: "h3",
      eventId: "e",
      line: -2,
      collectedAt: "2026-09-14T18:00:00.000Z",
      providerTimestamp: "2026-09-14T18:00:00.000Z",
    }),
  ];
  const hist = buildLineHistoryFromObservations(rows);
  assert.equal(hist.length, 3);
  assert.deepEqual(
    hist.map((h) => h.line),
    [-3, -2.5, -2]
  );
  assert.ok(hist.every((h) => h.providerTimestamp || h.collectedAt));
  assert.ok(hist.every((h) => h.sportsbook));

  const state = buildDurableActionEventState({
    eventId: "e",
    sport: "nfl",
    observations: rows,
  });
  assert.equal(state.historyAvailable, true);
  assert.equal(state.lineHistory.length, 3);
});

test("I: EXACT rematch persists identity; second load uses canonical link", async () => {
  const eventId = "nfl_den_kc_2026-09-14";
  const kickoff = "2026-09-14T20:00:00.000Z";
  const providerEventId = "act_kc_den_1";
  const db = makeDb({
    observations: [
      makeObs({
        id: "du1",
        eventId: null,
        providerEventId,
        line: -3.5,
        ticketPct: 39,
        moneyPct: 57,
        collectedAt: "2026-09-14T12:00:00.000Z",
      }),
    ],
    shadowRows: [
      {
        id: "sh1",
        action_game_id: providerEventId,
        fbis_event_id: null,
        sport: "nfl",
        league: "nfl",
        home_team: "Kansas City Chiefs",
        away_team: "Denver Broncos",
        home_abbr: "KC",
        away_abbr: "DEN",
        start_time: kickoff,
        match_confidence: "UNMATCHED",
        collected_at: "2026-09-14T12:00:00.000Z",
        consensus_json: JSON.stringify({ spreadHome: -3.5 }),
        public_betting_json: JSON.stringify({
          spreadHome: { ticketsPercent: 39, moneyPercent: 57 },
        }),
        decision_eligible: 0,
        can_qualify: 0,
        can_authorize_wager: 0,
      },
    ],
  });
  const game = {
    id: eventId,
    sport: "nfl",
    start: kickoff,
    home: { name: "Kansas City Chiefs", abbr: "KC" },
    away: { name: "Denver Broncos", abbr: "DEN" },
  };

  const first = await attachActionIntelToGames([game], db);
  assert.equal(first.attached, 1);
  assert.ok(first.rematched >= 1);
  assert.equal(first.games[0].actionIntel.identityPersisted, true);
  assert.ok(db._state.identityLinks.length >= 1);
  assert.equal(db._state.identityLinks[0].canonical_event_id, eventId);
  assert.equal(db._state.identityLinks[0].provider_event_id, providerEventId);
  assert.ok(
    isPersistableActionMatchConfidence(db._state.identityLinks[0].match_confidence)
  );

  db._state.shadowRows = [];
  const second = await attachActionIntelToGames([{ ...game }], db);
  assert.equal(second.attached, 1);
  assert.equal(second.rematched, 0);
  assert.equal(second.durableMatched, 1);
  assert.equal(second.games[0].actionIntel.publicSplits.ticketPct, 39);
  assert.ok(
    second.games[0].actionIntel.source === ACTION_BOARD_SOURCE.DURABLE_SERIES ||
      second.games[0].actionIntel.source === ACTION_BOARD_SOURCE.IDENTITY_LINK
  );
  assert.notEqual(second.games[0].actionIntel.rematchedForDisplay, true);
});

test("J: ambiguous matches stay unlinked", async () => {
  const kickoff = "2026-09-14T20:00:00.000Z";
  const db = makeDb({
    shadowRows: [
      {
        id: "amb1",
        action_game_id: "act_amb",
        fbis_event_id: null,
        sport: "nfl",
        league: "nfl",
        home_team: "Team A",
        away_team: "Team B",
        home_abbr: "AAA",
        away_abbr: "BBB",
        start_time: kickoff,
        collected_at: "2026-09-14T12:00:00.000Z",
        consensus_json: JSON.stringify({ spreadHome: -1 }),
        public_betting_json: JSON.stringify({
          spreadHome: { ticketsPercent: 50, moneyPercent: 50 },
        }),
        decision_eligible: 0,
        can_qualify: 0,
        can_authorize_wager: 0,
      },
    ],
  });
  const games = [
    {
      id: "nfl_a",
      sport: "nfl",
      start: kickoff,
      home: { name: "Alpha", abbr: "ALP" },
      away: { name: "Beta", abbr: "BET" },
    },
    {
      id: "nfl_b",
      sport: "nfl",
      start: kickoff,
      home: { name: "Gamma", abbr: "GAM" },
      away: { name: "Delta", abbr: "DEL" },
    },
  ];
  const rematch = await rematchBoardActionIntel(games, db);
  assert.equal(rematch.size, 0);
  assert.equal(db._state.identityLinks.length, 0);

  const attached = await attachActionIntelToGames(games, db);
  assert.equal(attached.attached, 0);
  for (const g of attached.games) {
    assert.equal(g.actionIntel, undefined);
  }
});

test("K: firewalls remain intact on durable + board attach paths", async () => {
  const eventId = "nfl_firewall";
  const state = buildDurableActionEventState({
    eventId,
    sport: "nfl",
    observations: [
      makeObs({
        id: "fw1",
        eventId,
        collectedAt: "2026-09-14T12:00:00.000Z",
      }),
    ],
  });
  firewallAssert(state, "durableState");
  assert.equal(state.role, "market_intelligence");
  assert.equal(state.displayOnly, true);

  const db = makeDb({
    observations: [
      makeObs({
        id: "fw1",
        eventId,
        collectedAt: "2026-09-14T12:00:00.000Z",
      }),
    ],
  });
  const out = await attachActionIntelToGames(
    [{ id: eventId, sport: "nfl", home: { abbr: "KC" }, away: { abbr: "DEN" } }],
    db
  );
  firewallAssert(out.games[0].actionIntel, "attached");
  assert.ok(!ODDS_PROVIDER_ORDER.map((x) => String(x).toLowerCase()).includes("action"));
  assert.ok(!ODDS_PROVIDER_ORDER.map((x) => String(x).toLowerCase()).includes("apify"));

  assert.equal(isPersistableActionMatchConfidence(MATCH_CONFIDENCE.EXACT), true);
  assert.equal(isPersistableActionMatchConfidence(MATCH_CONFIDENCE.HIGH), true);
  assert.equal(isPersistableActionMatchConfidence(MATCH_CONFIDENCE.AMBIGUOUS), false);
  assert.equal(isPersistableActionMatchConfidence(MATCH_CONFIDENCE.UNMATCHED), false);
});

test("PrizePicks: executedAt from slip date + unmatched open bets surface on board", async () => {
  assert.equal(executedAtFromSlipDate("2026-09-14"), "2026-09-14T23:00:00.000Z");
  assert.equal(executedAtFromSlipDate(null), null);

  const text = `$5 to win $30
2-Pick Power Play
NFL | DEN vs KC
Patrick Mahomes More 0.5 Pass Attempts
Bo Nix Less 17.5 Rush Yards
Sep 14, 2026`;
  const parsed = await parsePrizePicksSlip(text);
  assert.ok(parsed.tickets?.length >= 1);
  for (const t of parsed.tickets) {
    assert.ok(t.executedAt, "executedAt must be set so open bets are listable");
    assert.match(t.executedAt, /^2026-09-14T/);
  }

  const unmatchedBet = {
    id: "pp_1",
    gameId: null,
    result: "OPEN",
    executionBook: "PrizePicks",
    playerName: "Patrick Mahomes",
    market: "PLAYER_PROP",
    riskAmount: 5,
    matchupText: "DEN vs KC",
    executedAt: parsed.tickets[0].executedAt,
  };
  const board = attachMyBetsToBoard(
    { games: [{ id: "nfl_other", myBets: [] }], groups: [] },
    [unmatchedBet]
  );
  assert.equal(board.unmatchedOpenBets.length, 1);
  assert.equal(board.unmatchedOpenBets[0].playerName, "Patrick Mahomes");
  assert.equal(board.counts.unmatchedOpenBets, 1);
});

test("persistActionEventIdentityLink rejects weak confidence", async () => {
  const db = makeDb();
  const weak = await persistActionEventIdentityLink(db, {
    providerEventId: "act_x",
    sport: "nfl",
    canonicalEventId: "nfl_x",
    matchConfidence: MATCH_CONFIDENCE.AMBIGUOUS,
  });
  assert.equal(weak.ok, false);
  assert.equal(db._state.identityLinks.length, 0);

  const ok = await persistActionEventIdentityLink(db, {
    providerEventId: "act_x",
    sport: "nfl",
    canonicalEventId: "nfl_x",
    matchConfidence: MATCH_CONFIDENCE.HIGH,
  });
  assert.equal(ok.ok, true);
  assert.equal(db._state.identityLinks.length, 1);
});
