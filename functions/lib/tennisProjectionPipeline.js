/** Fixture-driven PURE inference. No market dependency and no promotion authority. */
import { proveTennisEvent } from './tennisEventIntegrity.js';
import { simulateTennisV2, TENNIS_V2_VERSION } from './tennisFbisV2.js';
import { persistTennisV2Decision } from './tennisV2Ledger.js';
import { tennisKey } from './tennisPlayerBank.js';
const parse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const num = v => v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;
const verifiedFormat = f => /^(ATP ?(250|500|1000)|WTA ?(125|250|500|1000)|250|500|1000)$/.test(String(f.tournament_level || '').toUpperCase());
const age = (v, now) => (+now - Date.parse(v || '')) / 3600000;
export function validateTennisPrematchProfiles(rows, fixture, now = new Date()) {
  if (rows.length !== 2 || rows.some(r => !r)) return 'SURFACE_PROFILE_MISSING';
  for (const row of rows) {
    const p = parse(row.profile_json);
    if (!p || tennisKey(p.name) !== tennisKey(row.player_name)) return 'PROFILE_IDENTITY_MISMATCH';
    if (!Number.isFinite(age(row.source_as_of, now)) || age(row.source_as_of, now) < 0 || !Number.isFinite(age(row.updated_at, now)) || age(row.updated_at, now) < 0) return 'PROFILE_CUTOFF_UNVERIFIED';
    if (Date.parse(row.source_as_of) >= Date.parse(fixture.event_start_time) || !row.last_match_date || Date.parse(row.last_match_date) >= Date.parse(fixture.event_start_time)) return 'PROFILE_NOT_PREMATCH';
    if (!row.source || !row.source_license) return 'PROFILE_PROVENANCE_MISSING';
    if (!(num(p.historyMatches) > 0) || !(num(p.surfaceMatches) > 0)) return 'PROFILE_SAMPLE_MISSING';
    const serve = num(p.servePointWinPct ?? p.servePointWin), ret = num(p.returnPointWinPct ?? p.returnPointWin);
    if (!(serve > 0 && serve < 1 && ret > 0 && ret < 1)) return 'PROFILE_SERVE_RETURN_MISSING';
    const required=['firstServeIn','firstServeWin','secondServeWin','returnFirstWin','returnSecondWin','aceRate','doubleFaultRate','bpSaveRate','bpFacedPerServiceGame','servicePointsPerGame','bpCreatePerReturnGame','bpConvertRate','aceAllowedRate','dfReceivedRate'];
    if(required.some(key=>num(p[key])==null)) return 'DEEP_PROFILE_FEATURES_MISSING';
  }
  return null;
}
export async function inspectTennisProjectionCoverage(db, { now = new Date(), limit = 100 } = {}) {
  const until = new Date(+now + 72 * 3600000).toISOString();
  const q = await db.prepare(`SELECT m.*,m.match_id AS canonical_event_id,m.match_time AS event_start_time,
    p1.canonical_name AS player1,p2.canonical_name AS player2,
    d.pure_p1,d.decision_timestamp,d.context_json,d.pure_model_id
    FROM tennis_official_matches m
    LEFT JOIN tennis_players p1 ON p1.fbis_player_id=m.player1_id
    LEFT JOIN tennis_players p2 ON p2.fbis_player_id=m.player2_id
    LEFT JOIN tennis_v2_research_decisions d ON d.id=(SELECT id FROM tennis_v2_research_decisions
      WHERE canonical_event_id=m.match_id ORDER BY decision_timestamp DESC,created_at DESC LIMIT 1)
    WHERE julianday(m.match_time)>julianday(?) AND julianday(m.match_time)<=julianday(?)
    AND m.source IN ('ATP_OFFICIAL','WTA_OFFICIAL')
    AND m.completion_state IN ('SCHEDULED','NOT_STARTED','UPCOMING')
    ORDER BY m.match_time LIMIT ?`).bind(now.toISOString(), until, Math.min(100, Math.max(1, Number(limit) || 100))).all();
  const fixtures = [];
  for (const f of q.results || []) {
    const proof = await proveTennisEvent(db, f);
    let reason = proof.valid ? null : proof.reason;
    const surface = proof.event?.surface;
    const profiles = [];
    if (!reason) {
      for (const name of [f.player1, f.player2]) {
        const row = await db.prepare(`SELECT * FROM tennis_player_profiles_current WHERE tour=? AND player_key=? AND surface=?`)
          .bind(f.tour, tennisKey(name), String(surface).toLowerCase()).first();
        profiles.push(row);
      }
      reason = validateTennisPrematchProfiles(profiles, f, now);
      if(!reason && !verifiedFormat(f)) reason="MATCH_FORMAT_UNVERIFIED";
    }
    const persisted = f.pure_p1 != null ? await proveTennisEvent(db, f, { projection: true }) : null;
    const available = persisted?.valid === true;
    fixtures.push({ ...f, proof, profiles, available, inferenceReady: !reason,
      blockedReason: available ? null : reason || persisted?.reason || 'PERSISTED_PROJECTION_MISSING',
      freshness: available ? age(f.decision_timestamp, now) > 6 ? 'STALE' : 'CURRENT' : 'BLOCKED' });
  }
  const blockedReasons = {};
  for (const f of fixtures.filter(f => !f.available)) blockedReasons[f.blockedReason] = (blockedReasons[f.blockedReason] || 0) + 1;
  return { asOf: now.toISOString(), windowHours: 72, bounded: true, limit: 100,
    verifiedFixtures: fixtures.filter(f => f.proof.valid).length, scheduledCandidates: fixtures.length,
    successfulProjections: fixtures.filter(f => f.available).length,
    missingOutputs: fixtures.filter(f => !f.available).length,
    missingOutputRate: fixtures.length ? fixtures.filter(f=>!f.available).length/fixtures.length : null,
    staleOutputs: fixtures.filter(f => f.freshness === 'STALE').length, blockedReasons, fixtures,
    researchOnly: true, canQualify: false, canAuthorizeWager: false };
}
export async function runTennisProjectionPipeline(db, opts = {}) {
  const coverage = await inspectTennisProjectionCoverage(db, opts), attempts = [];
  for (const f of coverage.fixtures) {
    if (f.available && f.freshness === 'CURRENT') continue;
    if (!f.inferenceReady) { attempts.push({ eventId: f.match_id, inserted: false, reason: f.blockedReason }); continue; }
    // Match format is not guessed. Current official ATP/WTA 250/500/1000/WTA
    // singles are best-of-three; unknown levels and ATP majors stay blocked.
    if (!verifiedFormat(f)) {
      attempts.push({ eventId: f.match_id, inserted: false, reason: 'MATCH_FORMAT_UNVERIFIED' }); continue;
    }
    const players = f.profiles.map(r => parse(r.profile_json));
    const contexts=f.profiles.map(r=>({surface:f.proof.event.surface,tournament:f.tournament_name,
      indoor:f.indoor_outdoor==='INDOOR'?true:f.indoor_outdoor==='OUTDOOR'?false:null,
      gamesLast3Days:num(r.games_last_3_days),gamesLast7Days:num(r.games_last_7_days),
      setsLast3Days:num(r.sets_last_3_days),setsLast7Days:num(r.sets_last_7_days),
      daysSinceRetirementOrMto:num(r.days_since_retirement_or_mto),sourceAsOf:r.source_as_of}));
    const pure = simulateTennisV2({ id: f.match_id, tour: f.tour, surface: f.proof.event.surface,
      bestOf: 3, player1: players[0], player2: players[1], playerContexts:contexts }, {}, { seed: f.match_id, simulations: 1500 });
    const result = await persistTennisV2Decision(db, { eventId: f.match_id, tour: f.tour,
      player1: f.player1, player2: f.player2, pureModelId: pure.modelId, pureP1: pure.match?.pPlayer1Win,
      eventStartTime: f.match_time, market: null, snapshotType: 'PURE_FIXTURE',
      context: { eventProof: f.proof.proof, modelVersion: TENNIS_V2_VERSION,
        projectedTotalGames: pure.match?.totalGames?.mean ?? null,
        profileCutoffs: f.profiles.map(r => ({ source: r.source, sourceAsOf: r.source_as_of, retrievedAt: r.updated_at })),
        simulations: pure.simulations, diagnostics:pure.contextDiagnostics, marketFree: true } });
    attempts.push({ eventId: f.match_id, ...result });
  }
  return { ...coverage, fixtures: undefined, attempts, inserted: attempts.filter(a => a.inserted).length };
}
export function publicTennisCoverage(coverage) {
  return { ...coverage, fixtures: coverage.fixtures.map(f => ({ eventId: f.match_id, tour: f.tour,
    player1: f.player1, player2: f.player2, start: f.match_time, available: f.available,
    freshness: f.freshness, blockedReason: f.blockedReason, inferenceReady: f.inferenceReady })) };
}
