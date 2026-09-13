/**
 * Functional pipeline tests — production boundary behavior.
 * Imports use exact live export names.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeNflPbpPlays,
  filterPlaysByInformationCutoff,
} from "../functions/lib/nflPbpNormalize.js";
import {
  buildMatchupFeatureSnapshot,
  NFL_COMPUTED_FROM_PBP,
  NFL_DECLARED_NOT_COMPUTED,
} from "../functions/lib/nflPbpFeatures.js";
import {
  NFL_FEATURE_KEYS,
  buildNflResearchFeatureSnapshot,
  fitOlsMargin,
  projectMarginFromFit,
  freezeNflResearchProjection,
  gradeNflResearchProjection,
  runNflWalkForward,
} from "../functions/lib/nflResearchPipeline.js";
import { projectNflPureChallenger } from "../functions/lib/nflPureChallenger.js";
import { projectCbbPureChallenger } from "../functions/lib/cbbPureChallenger.js";
import {
  ACTION_SNAPSHOT_TYPE,
  buildActionObservationKey,
  derivePublicSplitMetrics,
  deriveActionSnapshotType,
  expandBookObservations,
  persistActionObservationSeries,
} from "../functions/lib/actionObservationSeries.js";

function featuresFromSeed(seed) {
  const out = {};
  NFL_FEATURE_KEYS.forEach((k, i) => {
    out[k] = Math.sin(seed * (i + 1) * 1.7) * 0.2 + seed * 0.01 * (i + 1);
  });
  return out;
}

function makePlays() {
  const rows = [];
  const matchups = [
    ["KC", "BUF"],
    ["KC", "CIN"],
    ["BUF", "MIA"],
    ["CIN", "BAL"],
    ["KC", "BAL"],
    ["BUF", "CIN"],
  ];
  let playId = 1;
  for (let g = 0; g < matchups.length; g++) {
    const [off, def] = matchups[g];
    const gameDate = `2023-09-${String(10 + g).padStart(2, "0")}`;
    for (let i = 0; i < 55; i++) {
      const pass = i % 3 !== 0;
      for (const [posteam, defteam, flip] of [
        [off, def, 1],
        [def, off, -1],
      ]) {
        rows.push({
          game_id: `2023_0${g + 1}_${off}_${def}`,
          play_id: String(playId++),
          season: 2023,
          week: g + 1,
          game_date: gameDate,
          play_at: `${gameDate}T18:${String(i % 50).padStart(2, "0")}:00Z`,
          posteam,
          defteam,
          down: (i % 4) + 1,
          play_type: pass ? "pass" : "run",
          pass: pass ? 1 : 0,
          rush: pass ? 0 : 1,
          epa: flip * ((i % 7) * 0.1 - 0.2),
          success: i % 2,
          yards_gained: pass ? 8 + (i % 5) : 3 + (i % 4),
          sack: pass && i % 11 === 0 ? 1 : 0,
          interception: pass && i % 17 === 0 ? 1 : 0,
          fumble_lost: i % 19 === 0 ? 1 : 0,
          yardline_100: 20 + (i % 60),
        });
      }
    }
  }
  rows.push({
    game_id: "2023_99_FUT",
    play_id: "future",
    season: 2023,
    week: 99,
    game_date: "2023-12-01",
    play_at: "2023-12-01T18:00:00Z",
    posteam: "KC",
    defteam: "BUF",
    down: 1,
    play_type: "pass",
    pass: 1,
    rush: 0,
    epa: 9.9,
    success: 1,
    yards_gained: 99,
    sack: 0,
    interception: 0,
    fumble_lost: 0,
    yardline_100: 10,
  });
  return rows;
}

test("NFL: PBP fixture → normalize → PIT excludes future → features", () => {
  const { plays, rejected } = normalizeNflPbpPlays(makePlays());
  assert.ok(plays.length > 100);
  assert.equal(rejected.length, 0);
  const pit = filterPlaysByInformationCutoff(plays, "2023-09-20T00:00:00Z");
  assert.equal(pit.ok, true);
  assert.ok((pit.excludedFutureCount ?? pit.excludedFutureCount) >= 1);
  assert.ok(!pit.plays.some((p) => String(p.playId) === "future"));
  const snap = buildMatchupFeatureSnapshot({
    plays: pit.plays,
    homeTeam: "KC",
    awayTeam: "BUF",
    informationCutoff: "2023-09-20T00:00:00Z",
    minPlays: 40,
  });
  assert.equal(snap.ok, true);
  assert.equal(snap.features.historical_pbp, true);
  assert.ok(NFL_COMPUTED_FROM_PBP.includes("epa"));
  assert.ok(NFL_DECLARED_NOT_COMPUTED.includes("weather"));
});

test("NFL: OLS fit → projection → freeze → grade → pure challenger", () => {
  const rows = [];
  for (let week = 1; week <= 14; week++) {
    rows.push({
      eventId: `g${week}`,
      week,
      homeTeam: "KC",
      awayTeam: "BUF",
      features: featuresFromSeed(week),
      informationCutoff: `2023-09-${String(Math.min(28, 9 + week)).padStart(2, "0")}T00:00:00Z`,
      actualMargin: 1.5 * week - 8,
      actualHome: 20 + week,
      actualAway: 28 - week,
    });
  }
  assert.equal(
    buildNflResearchFeatureSnapshot({
      rawPlays: makePlays(),
      homeTeam: "KC",
      awayTeam: "BUF",
      informationCutoff: "2023-09-20T00:00:00Z",
      minPlays: 40,
    }).ok,
    true
  );

  const fit = fitOlsMargin(rows.slice(0, 12));
  assert.equal(fit.ok, true);
  const proj = projectMarginFromFit(fit, rows[12].features);
  assert.equal(proj.ok, true);
  const frozen = freezeNflResearchProjection({
    eventId: rows[12].eventId,
    homeTeam: "KC",
    awayTeam: "BUF",
    projection: proj,
    featureSnapshot: { features: rows[12].features },
    informationCutoff: rows[12].informationCutoff,
  });
  assert.equal(frozen.ok, true);
  assert.equal(frozen.immutable, true);
  assert.equal(frozen.canQualify, false);
  const grade = gradeNflResearchProjection(frozen, rows[12].actualHome, rows[12].actualAway);
  assert.equal(grade.ok, true);
  assert.ok(Number.isFinite(grade.errMargin));

  const pure = projectNflPureChallenger(
    { id: "gX", home: { abbr: "KC" }, away: { abbr: "BUF" } },
    {
      fit,
      featureSnapshot: { ok: true, features: rows[12].features },
      informationCutoff: rows[12].informationCutoff,
    }
  );
  assert.equal(pure.ok, true);
  assert.equal(pure.canQualify, false);
});

test("NFL: expanding walk-forward runner operational", () => {
  const rows = [];
  for (let week = 1; week <= 16; week++) {
    rows.push({
      eventId: `wf${week}`,
      week,
      homeTeam: "KC",
      awayTeam: "BUF",
      features: featuresFromSeed(week + 3),
      informationCutoff: `2023-10-${String(Math.min(28, week)).padStart(2, "0")}T00:00:00Z`,
      actualMargin: week - 8,
      actualHome: 21 + week,
      actualAway: 29 - week,
    });
  }
  const wf = runNflWalkForward(rows, { burnIn: 11 });
  assert.equal(wf.ok, true);
  assert.equal(wf.foldScheme, "expanding_walk_forward");
  assert.ok(wf.foldCount >= 1);
  assert.ok(wf.frozen.length >= 1);
  assert.ok(wf.graded.length >= 1);
  assert.equal(wf.frozen[0].immutable, true);
  assert.notEqual(wf.status.oosStatus, "OOS_DATA_PENDING");
});

test("CBB: ratings → PIT-safe projection; leaky cutoff fails", () => {
  const ok = projectCbbPureChallenger({
    eventId: "cbb1",
    homeAdjOe: 115,
    homeAdjDe: 95,
    homeTempo: 70,
    awayAdjOe: 105,
    awayAdjDe: 100,
    awayTempo: 68,
    informationCutoff: "2024-01-10T12:00:00Z",
    eventStart: "2024-01-10T19:00:00Z",
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.canQualify, false);
  assert.ok(ok.decomposition.possessions > 0);
  const leak = projectCbbPureChallenger({
    eventId: "cbb2",
    homeAdjOe: 115,
    homeAdjDe: 95,
    homeTempo: 70,
    awayAdjOe: 105,
    awayAdjDe: 100,
    awayTempo: 68,
    informationCutoff: "2024-01-10T20:00:00Z",
    eventStart: "2024-01-10T19:00:00Z",
  });
  assert.equal(leak.ok, false);
});

test("ACTION: identity + splits + snapshot types + append-not-overwrite", async () => {
  const base = {
    providerEventId: "e1",
    providerPlayerId: "p1",
    marketType: "player_points",
    marketPeriod: "game",
    selection: "over",
    sportsbook: "dk",
    collectedAt: "2024-01-01T12:00:00Z",
  };
  const a = buildActionObservationKey(base);
  const b = buildActionObservationKey(base);
  const c = buildActionObservationKey({ ...base, providerPlayerId: "p2" });
  assert.equal(a, b);
  assert.notEqual(a, c);

  const split = derivePublicSplitMetrics({ publicTicketPct: 60, publicMoneyPct: 40 });
  assert.equal(split.publicTicketPct, 60);
  assert.equal(split.publicMoneyPct, 40);
  assert.equal(split.moneyMinusTicketPct, -20);
  assert.equal(split.sharpLabelApplied, false);

  assert.equal(deriveActionSnapshotType({ explicit: "OPEN" }), ACTION_SNAPSHOT_TYPE.OPEN);
  assert.equal(
    deriveActionSnapshotType({ lifecycle: "final_pregame" }),
    ACTION_SNAPSHOT_TYPE.FINAL_PREGAME
  );

  const observations = new Map();
  const db = {
    async queryOne(sql, params = []) {
      if (/observation_key/i.test(sql)) return observations.has(params[0]) ? { id: params[0] } : null;
      return null;
    },
    async exec(sql, params = []) {
      if (/INSERT OR IGNORE INTO action_market_book_observations/i.test(sql)) {
        const key = params[1];
        if (!observations.has(key)) observations.set(key, { key });
      }
      return { success: true };
    },
  };

  const source = {
    actionGameId: "e1",
    sport: "nfl",
    period: "event",
    startTime: "2024-01-01T19:00:00Z",
    observedAt: "2024-01-01T10:00:00Z",
    publicBetting: {
      spreadHome: { ticketsPercent: 55, moneyPercent: 48 },
    },
    books: [
      {
        book: "pinnacle",
        spreadHome: -3,
        spreadHomeOdds: -110,
        spreadAway: 3,
        spreadAwayOdds: -110,
      },
    ],
  };
  const expanded = expandBookObservations(source, {
    canonicalEventId: "e1",
    lifecycle: "open",
    collectedAt: "2024-01-01T10:00:00Z",
    isFirstForMarket: true,
  });
  assert.ok(expanded.length >= 1);
  await persistActionObservationSeries(db, expanded);
  const n1 = observations.size;
  await persistActionObservationSeries(db, expanded);
  assert.equal(observations.size, n1);
});
