import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveNflPublicationCheckpoint,
  expectedPastCheckpoints,
  buildNflResearchPublicationPacket,
  insertNflResearchPublication,
  buildNflPublicationCoverageReport,
  publishNflPregameSlate,
  recordMissingPastCheckpoints,
  NFL_PUBLICATION_STATUS,
} from "../functions/lib/nflPregamePublication.js";

const kickoff = "2026-10-19T17:00:00.000Z";

function gameFixture(overrides = {}) {
  const shadow = {
    ok: true,
    modelId: "NFL-PRO-v1",
    version: "v1.2",
    home: 24.1,
    away: 21.2,
    margin: 2.9,
    total: 45.3,
    pHomeWin: 0.58,
    sigmaMargin: 14.2,
    sigmaTotal: 13.1,
    coverage: { missing: ["pressure", "trenches"], share: 0.42, available: ["teamEpa"], nAvailable: 5, nTotal: 12 },
    decomposition: {
      baseLeaguePpg: 22.5,
      home: {
        teamPower: 1,
        matchup: { pass: 0.5, rush: 0.2, explosive: null, pressure: null, trenches: null, total: 0.7 },
        qb: { value: 0.4, inputs: {} },
        tracking: { value: 0.1, inputs: {} },
        specialTeams: null,
        context: 0,
        hfa: 0.75,
      },
      away: {
        teamPower: -0.5,
        matchup: { pass: -0.2, rush: 0.1, explosive: null, pressure: null, trenches: null, total: -0.1 },
        qb: { value: -0.2, inputs: {} },
        tracking: { value: 0, inputs: {} },
        specialTeams: null,
        context: 0,
        hfa: -0.75,
      },
    },
    provenance: { verifiedAvailabilityConsumed: false, injuryStatusConsumed: false },
  };
  // Align published scores with decomposition replay.
  const homeRaw = 22.5 + 1 + 0.7 + 0.4 * 0.55 + 0.1 + 0 + 0 + 0.75;
  const awayRaw = 22.5 + (-0.5) + (-0.1) + (-0.2) * 0.55 + 0 + 0 + 0 + (-0.75);
  const round1 = (v) => Math.round((v + Number.EPSILON) * 10) / 10;
  shadow.home = round1(homeRaw);
  shadow.away = round1(awayRaw);
  shadow.margin = round1(shadow.home - shadow.away);
  shadow.total = round1(shadow.home + shadow.away);

  return {
    id: "401873099",
    sport: "nfl",
    start: kickoff,
    venue: "Test Stadium",
    neutral: false,
    home: { abbr: "KC", name: "Kansas City Chiefs", fullName: "Kansas City Chiefs" },
    away: { abbr: "BUF", name: "Buffalo Bills", fullName: "Buffalo Bills" },
    nflProShadow: shadow,
    researchProjection: {
      modelId: "NFL-PRO-v1",
      modelVersion: "v1.2",
      home: shadow.home,
      away: shadow.away,
      maturity: "RESEARCH",
    },
    model: { projHome: shadow.home, projAway: shadow.away },
    nflFeatures: {
      home: { offenseEpa: 0.1, defenseEpa: -0.05, qbEpa: 0.12, source: "nflverse-player-v2" },
      away: { offenseEpa: 0.02, defenseEpa: 0.01, qbEpa: 0.04, source: "nflverse-player-v2" },
    },
    nflPersistentProfile: { configured: true, attachedBeforeScoring: true, home: {}, away: {} },
    ...overrides,
  };
}

function memoryDb() {
  const pubs = new Map();
  const events = [];
  return {
    pubs,
    events,
    prepare(sql) {
      const self = {
        binds: [],
        bind(...args) { self.binds = args; return self; },
        async first() {
          if (/SELECT id, payload_hash/.test(sql)) {
            const [eventId, modelId, modelVersion, checkpoint] = self.binds;
            const key = `${eventId}|${modelId}|${modelVersion}|${checkpoint}`;
            return pubs.get(key) || null;
          }
          return null;
        },
        async all() {
          if (/FROM nfl_research_publications/.test(sql)) {
            return { results: [...pubs.values()].map((r) => ({ ...r })) };
          }
          return { results: [] };
        },
        async run() {
          if (/INSERT INTO nfl_research_publications/.test(sql)) {
            const [
              event_id, season, week, game_type, game_date, start_time, home_team, away_team, venue, neutral_site,
              checkpoint, model_id, model_version, feature_contract_version, code_sha, model_artifact_hash,
              status, failure_reason, published_at, information_cutoff, hours_to_start,
              proj_home, proj_away, proj_margin, proj_total, p_home_win, sigma_margin, sigma_total,
              coverage_share, missing_features_json, input_checksum, output_checksum, payload_hash,
              compact_json, r2_key, reconstructability, score_reconciled, can_qualify, can_authorize_wager, published_by,
            ] = self.binds;
            const key = `${event_id}|${model_id}|${model_version}|${checkpoint}`;
            const row = {
              id: pubs.size + 1,
              event_id, season, week, game_type, game_date, start_time, home_team, away_team, venue, neutral_site,
              checkpoint, model_id, model_version, feature_contract_version, code_sha, model_artifact_hash,
              status, failure_reason, published_at, information_cutoff, hours_to_start,
              proj_home, proj_away, proj_margin, proj_total, p_home_win, sigma_margin, sigma_total,
              coverage_share, missing_features_json, input_checksum, output_checksum, payload_hash,
              compact_json, r2_key, reconstructability, score_reconciled, can_qualify, can_authorize_wager, published_by,
            };
            pubs.set(key, row);
            return { meta: { last_row_id: row.id } };
          }
          if (/INSERT INTO nfl_research_publication_events/.test(sql)) {
            events.push(self.binds);
            return { meta: { last_row_id: events.length } };
          }
          return { meta: {} };
        },
      };
      return self;
    },
  };
}

test("checkpoint windows map hours-to-kickoff without inventing past freezes", () => {
  const t0 = Date.parse(kickoff);
  assert.equal(resolveNflPublicationCheckpoint(kickoff, t0 - 72 * 3600000).checkpoint, "INITIAL_WEEKLY");
  assert.equal(resolveNflPublicationCheckpoint(kickoff, t0 - 48 * 3600000).checkpoint, "T48");
  assert.equal(resolveNflPublicationCheckpoint(kickoff, t0 - 24 * 3600000).checkpoint, "T24");
  assert.equal(resolveNflPublicationCheckpoint(kickoff, t0 - 6 * 3600000).checkpoint, "T6");
  assert.equal(resolveNflPublicationCheckpoint(kickoff, t0 - 1 * 3600000).checkpoint, "FINAL_PREGAME");
  assert.equal(resolveNflPublicationCheckpoint(kickoff, t0 + 3600000).ok, false);
  assert.deepEqual(expectedPastCheckpoints(kickoff, t0 - 5 * 3600000), [
    "INITIAL_WEEKLY", "T48", "T24",
  ]);
});

test("publication packet reconciles and never authorizes wagers", async () => {
  const game = gameFixture();
  const nowMs = Date.parse(kickoff) - 6 * 3600000;
  const packet = await buildNflResearchPublicationPacket(game, { date: "2026-10-19", research: { nflVerse: { builtAt: "2026-10-18T08:00:00Z" } } }, {
    nowMs,
    codeSha: "abc",
    gameDate: "2026-10-19",
  });
  assert.equal(packet.ok, true);
  assert.equal(packet.checkpoint, "T6");
  assert.equal(packet.compact.canAuthorizeWager, false);
  assert.equal(packet.compact.canQualify, false);
  assert.equal(packet.compact.scoreReconciled, true);
  assert.equal(packet.fullEvidence.governance.canAuthorizeWager, false);
  assert.ok(packet.payloadHash);
});

test("insert is idempotent and conflicts on hash change", async () => {
  const db = memoryDb();
  const env = { DB: db };
  const game = gameFixture();
  const nowMs = Date.parse(kickoff) - 6 * 3600000;
  const packet = await buildNflResearchPublicationPacket(game, {}, { nowMs, gameDate: "2026-10-19", codeSha: "sha1" });
  packet.compact.gameDate = "2026-10-19";
  const first = await insertNflResearchPublication(env, packet);
  assert.equal(first.inserted, true);
  assert.equal(first.status, NFL_PUBLICATION_STATUS.SUCCESS);
  const second = await insertNflResearchPublication(env, packet);
  assert.equal(second.inserted, false);
  assert.equal(second.status, NFL_PUBLICATION_STATUS.ALREADY);
  const changed = { ...packet, payloadHash: "different", compact: { ...packet.compact, payloadHash: "different" } };
  const conflict = await insertNflResearchPublication(env, changed);
  assert.equal(conflict.status, NFL_PUBLICATION_STATUS.CONFLICT);
});

test("slate publisher covers eligible games and reports missing past checkpoints", async () => {
  const db = memoryDb();
  const env = { DB: db };
  const g1 = gameFixture({ id: "g1" });
  const g2 = gameFixture({
    id: "g2",
    nflProShadow: { ok: false, reason: "core-epa-or-qb-features-missing" },
    researchProjection: null,
    model: {},
  });
  const nowMs = Date.parse(kickoff) - 5 * 3600000;
  const report = await publishNflPregameSlate(env, { date: "2026-10-19", games: [g1, g2] }, { nowMs, codeSha: "sha" });
  assert.equal(report.summary.success, 1);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.governance.canAuthorizeWager, false);
  assert.equal(report.coverage.currentFrozen, 1);
  assert.ok(report.coverage.missingCheckpointCount >= 1);
});

test("coverage report distinguishes current freeze from missing historical windows", () => {
  const games = [gameFixture()];
  const nowMs = Date.parse(kickoff) - 5 * 3600000;
  const pubs = [{
    eventId: "401873099",
    checkpoint: "T6",
    status: "SUCCESS",
    publishedAt: new Date(nowMs).toISOString(),
    scoreReconciled: true,
    payloadHash: "x",
  }];
  const coverage = buildNflPublicationCoverageReport(games, pubs, nowMs);
  assert.equal(coverage.currentFrozen, 1);
  assert.ok(coverage.rows[0].missingCheckpoints.includes("T24"));
  assert.equal(coverage.rows[0].hasCurrentFreeze, true);
  assert.equal(coverage.missingPolicy, "NEVER_RETROACTIVELY_INVENT");
  assert.equal(coverage.rows[0].missingCheckpointDetails[0].status, NFL_PUBLICATION_STATUS.MISSING);
});

test("missing past checkpoints are ledgered as MISSING events without inventing freezes", async () => {
  const db = memoryDb();
  const env = { DB: db };
  const game = gameFixture();
  const nowMs = Date.parse(kickoff) - 5 * 3600000;
  const pubs = [{
    eventId: "401873099",
    checkpoint: "T6",
    status: "SUCCESS",
    scoreReconciled: true,
  }];
  const ledger = await recordMissingPastCheckpoints(env, [game], pubs, {
    nowMs,
    gameDate: "2026-10-19",
    codeSha: "sha",
    runId: "test-missing",
  });
  assert.ok(ledger.count >= 1);
  assert.equal(ledger.policy, "NEVER_RETROACTIVELY_INVENT");
  assert.ok(ledger.recorded.every((r) => r.status === NFL_PUBLICATION_STATUS.MISSING));
  assert.ok(db.events.every((binds) => binds[3] === NFL_PUBLICATION_STATUS.MISSING));
  // No fabricated SUCCESS publication rows for past windows
  assert.equal(db.pubs.size, 0);
});

test("slate publisher records MISSING ledger for elapsed windows", async () => {
  const db = memoryDb();
  const env = { DB: db };
  const g1 = gameFixture({ id: "g1" });
  const nowMs = Date.parse(kickoff) - 5 * 3600000;
  const report = await publishNflPregameSlate(env, { date: "2026-10-19", games: [g1] }, { nowMs, codeSha: "sha" });
  assert.equal(report.summary.success, 1);
  assert.ok(report.summary.missingRecorded >= 1);
  assert.ok((report.missingLedger?.recorded || []).some((r) => r.checkpoint === "T24"));
});
