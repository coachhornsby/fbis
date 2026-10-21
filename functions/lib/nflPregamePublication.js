/**
 * NFL multi-checkpoint immutable research publications.
 *
 * Compact D1 rows + optional R2 full evidence.
 * Never overwrites an earlier freeze. Never invents past checkpoints.
 * Research-only: canQualify/canAuthorizeWager always false.
 */

import { putArchive, r2Bound } from "./r2Archive.js";
import { productSportDbHandle } from "./databaseTopology.js";
import { buildNflFrozenAuditPacket } from "./nflFrozenPublicationAudit.js";
import {
  NFL_PRODUCTION_CHAMPION,
  NFL_DISPLAYED_RESEARCH,
} from "./nflModelGovernance.js";
import { sha256Hex } from "./publishedProjectionStore.js";

export const NFL_FEATURE_CONTRACT_VERSION = "nfl-features-v4";
export const NFL_PUBLICATION_SCHEMA = "nfl-research-publication-v1";

/** Ordered checkpoints. Only the current eligible checkpoint is written. */
export const NFL_PUBLICATION_CHECKPOINTS = Object.freeze([
  { id: "INITIAL_WEEKLY", minHours: 54, maxHours: Infinity, label: "Initial weekly projection" },
  { id: "T48", minHours: 36, maxHours: 54, label: "~48 hours before kickoff" },
  { id: "T24", minHours: 10, maxHours: 36, label: "~24 hours before kickoff" },
  { id: "T6", minHours: 1.5, maxHours: 10, label: "~6 hours before kickoff / midday" },
  { id: "FINAL_PREGAME", minHours: 0.25, maxHours: 1.5, label: "Final pregame checkpoint" },
]);

export const NFL_PUBLICATION_STATUS = Object.freeze({
  SUCCESS: "SUCCESS",
  BLOCKED: "BLOCKED",
  MISSING: "MISSING",
  ALREADY: "ALREADY",
  CONFLICT: "CONFLICT",
  SKIPPED_FUTURE: "SKIPPED_FUTURE",
  SKIPPED_STARTED: "SKIPPED_STARTED",
});

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function hoursToKickoff(start, nowMs = Date.now()) {
  const t = Date.parse(start || "");
  if (!Number.isFinite(t)) return null;
  return (t - nowMs) / 3600000;
}

export function resolveNflPublicationCheckpoint(start, nowMs = Date.now()) {
  const hours = hoursToKickoff(start, nowMs);
  if (hours == null) return { ok: false, reason: "invalid-start", hours: null, checkpoint: null };
  if (hours < 0.25) return { ok: false, reason: "too-close-or-started", hours, checkpoint: null };
  for (const cp of NFL_PUBLICATION_CHECKPOINTS) {
    if (hours > cp.minHours && hours <= cp.maxHours) {
      return { ok: true, hours, checkpoint: cp.id, label: cp.label };
    }
  }
  // hours > Infinity branch unreachable; hours exactly on boundaries fall into next window via >
  if (hours > 54) return { ok: true, hours, checkpoint: "INITIAL_WEEKLY", label: "Initial weekly projection" };
  return { ok: false, reason: "no-checkpoint-window", hours, checkpoint: null };
}

export function expectedPastCheckpoints(start, nowMs = Date.now()) {
  const hours = hoursToKickoff(start, nowMs);
  if (hours == null) return [];
  return NFL_PUBLICATION_CHECKPOINTS
    .filter((cp) => hours <= cp.minHours)
    .map((cp) => cp.id);
}

function seasonWeekFromStart(start) {
  const d = new Date(Date.parse(start || "") || Date.now());
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  const season = month >= 3 ? year : year - 1;
  return { season, week: null, gameType: "REG" };
}

function slimFeatures(side = {}) {
  const keys = [
    "games", "priorGames", "source", "trackingSource", "trackingGames",
    "offenseEpa", "defenseEpa", "passEpa", "passEpaAllowed", "rushEpa", "rushEpaAllowed",
    "successRate", "successRateAllowed", "earlyDownEpa", "earlyDownEpaAllowed",
    "explosiveRate", "explosiveRateAllowed", "pressureRate", "pressureRateAllowed",
    "lineYards", "lineYardsAllowed", "specialTeamsEpa", "specialTeamsPoints",
    "qbEpa", "qbCpoe", "qbNgsCpoe", "qbSackRate", "qbPrior", "qbTimeToThrow", "qbAggressiveness",
    "rushYoePerAtt", "rushEfficiency", "receivingSeparation", "receivingYacOe",
    "restDays", "travelMiles", "timeZonesCrossed", "altitudeAdjustment", "weatherPoints",
  ];
  const out = {};
  for (const k of keys) {
    if (side[k] !== undefined) out[k] = side[k];
  }
  return out;
}

export async function buildNflResearchPublicationPacket(game = {}, slate = {}, opts = {}) {
  const publishedAt = opts.publishedAt || new Date().toISOString();
  const codeSha = opts.codeSha || null;
  const cp = resolveNflPublicationCheckpoint(game.start, opts.nowMs);
  const shadow = game.nflProShadow;
  const research = game.researchProjection || {};
  const modelId = research.modelId || shadow?.modelId || NFL_DISPLAYED_RESEARCH.modelId;
  const modelVersion = research.modelVersion || shadow?.version || NFL_DISPLAYED_RESEARCH.version;
  const { season, week, gameType } = seasonWeekFromStart(game.start);

  if (!cp.ok) {
    return {
      ok: false,
      status: cp.reason === "too-close-or-started"
        ? NFL_PUBLICATION_STATUS.SKIPPED_STARTED
        : NFL_PUBLICATION_STATUS.BLOCKED,
      reason: cp.reason,
      eventId: String(game.id || ""),
      checkpoint: cp.checkpoint,
      hoursToStart: cp.hours,
      publishedAt,
    };
  }

  if (!shadow?.ok) {
    return {
      ok: false,
      status: NFL_PUBLICATION_STATUS.BLOCKED,
      reason: shadow?.reason || "independent-projection-unavailable",
      eventId: String(game.id || ""),
      checkpoint: cp.checkpoint,
      hoursToStart: cp.hours,
      modelId,
      modelVersion,
      publishedAt,
    };
  }

  const audit = buildNflFrozenAuditPacket(game, slate, { publishedAt, codeSha });
  const featureHome = slimFeatures(game.nflFeatures?.home || {});
  const featureAway = slimFeatures(game.nflFeatures?.away || {});
  const inputChecksum = await sha256Hex(JSON.stringify({ home: featureHome, away: featureAway }));
  const outputChecksum = await sha256Hex(JSON.stringify({
    home: shadow.home, away: shadow.away, margin: shadow.margin, total: shadow.total, pHomeWin: shadow.pHomeWin,
  }));

  const fullEvidence = {
    schema: NFL_PUBLICATION_SCHEMA,
    publishedAt,
    checkpoint: cp.checkpoint,
    event: {
      id: String(game.id || ""),
      season,
      week,
      gameType,
      start: game.start || null,
      home: game.home?.abbr || null,
      away: game.away?.abbr || null,
      homeName: game.home?.fullName || game.home?.name || null,
      awayName: game.away?.fullName || game.away?.name || null,
      venue: game.venue || null,
      neutralSite: Boolean(game.neutral || game.neutralSite),
      status: game.status || null,
    },
    model: {
      modelId,
      modelVersion,
      productionChampion: NFL_PRODUCTION_CHAMPION.modelId,
      role: "research",
      codeSha,
      featureContractVersion: NFL_FEATURE_CONTRACT_VERSION,
      modelArtifactHash: opts.modelArtifactHash || null,
    },
    projection: {
      home: shadow.home,
      away: shadow.away,
      margin: shadow.margin,
      total: shadow.total,
      pHomeWin: finite(shadow.pHomeWin),
      sigmaMargin: finite(shadow.sigmaMargin),
      sigmaTotal: finite(shadow.sigmaTotal),
    },
    features: {
      home: featureHome,
      away: featureAway,
      coverage: shadow.coverage || null,
      feedMetadata: slate?.research?.nflVerse || null,
    },
    personnel: {
      attachedBeforeScoring: Boolean(game.nflPersistentProfile?.attachedBeforeScoring),
      consumedByDisplayedScore: false,
      qbPersonnelShadow: game.nflQbPersonnelShadow || null,
    },
    audit,
    marketObservation: {
      note: "Market is observation-only; not an NFL-PRO scoring input.",
      spread: game.odds?.pinSpread ?? game.odds?.spread ?? null,
      total: game.odds?.pinTotal ?? game.odds?.total ?? null,
      observedAt: game.odds?.observedAt || game.odds?.asOf || null,
    },
    governance: {
      canQualify: false,
      canAuthorizeWager: false,
      researchNotChampion: true,
    },
  };

  const payloadHash = await sha256Hex(JSON.stringify(fullEvidence));
  const compact = {
    schema: NFL_PUBLICATION_SCHEMA,
    status: NFL_PUBLICATION_STATUS.SUCCESS,
    checkpoint: cp.checkpoint,
    hoursToStart: Math.round(cp.hours * 100) / 100,
    eventId: fullEvidence.event.id,
    season,
    week,
    gameDate: opts.gameDate || null,
    startTime: game.start || null,
    home: fullEvidence.event.home,
    away: fullEvidence.event.away,
    venue: fullEvidence.event.venue,
    neutralSite: fullEvidence.event.neutralSite,
    modelId,
    modelVersion,
    productionChampion: NFL_PRODUCTION_CHAMPION.modelId,
    codeSha,
    featureContractVersion: NFL_FEATURE_CONTRACT_VERSION,
    publishedAt,
    informationCutoff: publishedAt,
    projection: fullEvidence.projection,
    coverageShare: finite(shadow.coverage?.share),
    missingFeatures: shadow.coverage?.missing || [],
    inputChecksum,
    outputChecksum,
    payloadHash,
    reconstructability: audit.reconstructability || null,
    scoreReconciled: Boolean(audit.ok && audit.replay?.reconciled),
    canQualify: false,
    canAuthorizeWager: false,
  };

  return {
    ok: true,
    status: NFL_PUBLICATION_STATUS.SUCCESS,
    checkpoint: cp.checkpoint,
    hoursToStart: cp.hours,
    eventId: compact.eventId,
    modelId,
    modelVersion,
    publishedAt,
    compact,
    fullEvidence,
    payloadHash,
    inputChecksum,
    outputChecksum,
    season,
    week,
    gameType,
  };
}

export async function insertNflResearchPublication(env, packet, { publishedBy = "nfl-pregame-publish" } = {}) {
  if (!productSportDbHandle(env, "nfl").db?.prepare) return { ok: false, reason: "d1-unavailable" };
  if (!packet?.ok) {
    return {
      ok: false,
      status: packet?.status || NFL_PUBLICATION_STATUS.BLOCKED,
      reason: packet?.reason || "packet-not-ok",
      eventId: packet?.eventId || null,
      checkpoint: packet?.checkpoint || null,
    };
  }

  const c = packet.compact;
  const existing = await productSportDbHandle(env, "nfl").db.prepare(
    `SELECT id, payload_hash, published_at, r2_key, status
       FROM nfl_research_publications
      WHERE event_id = ?1 AND model_id = ?2 AND model_version = ?3 AND checkpoint = ?4
      LIMIT 1`
  ).bind(c.eventId, c.modelId, c.modelVersion, c.checkpoint).first();

  if (existing) {
    if (existing.payload_hash !== packet.payloadHash) {
      return {
        ok: false,
        status: NFL_PUBLICATION_STATUS.CONFLICT,
        reason: "immutable-nfl-research-publication-conflict",
        existing,
        eventId: c.eventId,
        checkpoint: c.checkpoint,
      };
    }
    return {
      ok: true,
      inserted: false,
      status: NFL_PUBLICATION_STATUS.ALREADY,
      id: existing.id,
      eventId: c.eventId,
      checkpoint: c.checkpoint,
      payloadHash: existing.payload_hash,
      r2Key: existing.r2_key || null,
    };
  }

  let r2Key = null;
  if (r2Bound(env)) {
    r2Key = [
      "research",
      "nfl",
      "pregame-publications",
      c.gameDate || "na",
      c.eventId,
      c.checkpoint,
      `${packet.payloadHash.slice(0, 16)}.json`,
    ].join("/");
    const archived = await putArchive(env, r2Key, packet.fullEvidence);
    if (!archived.ok) r2Key = null; // D1 compact row still written; R2 failure is degraded not blocking
  }

  const result = await productSportDbHandle(env, "nfl").db.prepare(
    `INSERT INTO nfl_research_publications (
      event_id, season, week, game_type, game_date, start_time, home_team, away_team, venue, neutral_site,
      checkpoint, model_id, model_version, feature_contract_version, code_sha, model_artifact_hash,
      status, failure_reason, published_at, information_cutoff, hours_to_start,
      proj_home, proj_away, proj_margin, proj_total, p_home_win, sigma_margin, sigma_total,
      coverage_share, missing_features_json, input_checksum, output_checksum, payload_hash,
      compact_json, r2_key, reconstructability, score_reconciled, can_qualify, can_authorize_wager, published_by
    ) VALUES (
      ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,
      ?11,?12,?13,?14,?15,?16,
      ?17,?18,?19,?20,?21,
      ?22,?23,?24,?25,?26,?27,?28,
      ?29,?30,?31,?32,?33,
      ?34,?35,?36,?37,?38,?39,?40
    )`
  ).bind(
    c.eventId, c.season, c.week, packet.gameType || "REG", c.gameDate, c.startTime,
    c.home, c.away, c.venue, c.neutralSite ? 1 : 0,
    c.checkpoint, c.modelId, c.modelVersion, c.featureContractVersion, c.codeSha, null,
    NFL_PUBLICATION_STATUS.SUCCESS, null, c.publishedAt, c.informationCutoff, c.hoursToStart,
    c.projection.home, c.projection.away, c.projection.margin, c.projection.total,
    c.projection.pHomeWin, c.projection.sigmaMargin, c.projection.sigmaTotal,
    c.coverageShare, JSON.stringify(c.missingFeatures || []),
    packet.inputChecksum, packet.outputChecksum, packet.payloadHash,
    JSON.stringify(c), r2Key, c.reconstructability, c.scoreReconciled ? 1 : 0, 0, 0, publishedBy
  ).run();

  return {
    ok: true,
    inserted: true,
    status: NFL_PUBLICATION_STATUS.SUCCESS,
    id: result?.meta?.last_row_id ?? null,
    eventId: c.eventId,
    checkpoint: c.checkpoint,
    payloadHash: packet.payloadHash,
    r2Key,
    scoreReconciled: c.scoreReconciled,
  };
}

export async function recordNflPublicationEvent(env, row = {}) {
  if (!productSportDbHandle(env, "nfl").db?.prepare) return { ok: false };
  await productSportDbHandle(env, "nfl").db.prepare(
    `INSERT INTO nfl_research_publication_events
      (event_id, game_date, checkpoint, status, detail, observed_at, code_sha, run_id)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
  ).bind(
    row.eventId || null,
    row.gameDate || null,
    row.checkpoint || null,
    row.status || "UNKNOWN",
    row.detail || null,
    row.observedAt || new Date().toISOString(),
    row.codeSha || null,
    row.runId || null
  ).run();
  return { ok: true };
}

/**
 * Record MISSING for past checkpoint windows that have no SUCCESS freeze.
 * Never invents projection rows — events only. Idempotent per run.
 */
export async function recordMissingPastCheckpoints(env, games = [], publications = [], opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  const gameDate = opts.gameDate || null;
  const codeSha = opts.codeSha || null;
  const runId = opts.runId || `nfl-missing-${nowMs}`;
  const byEvent = new Map();
  for (const p of publications) {
    const id = String(p.eventId || "");
    if (!byEvent.has(id)) byEvent.set(id, new Set());
    if (p.status === NFL_PUBLICATION_STATUS.SUCCESS || p.scoreReconciled != null || p.checkpoint) {
      // Treat any stored publication row as evidence the window was frozen.
      byEvent.get(id).add(p.checkpoint);
    }
  }
  const recorded = [];
  for (const game of games || []) {
    if (game.sport && game.sport !== "nfl") continue;
    const eventId = String(game.id || "");
    const present = byEvent.get(eventId) || new Set();
    const past = expectedPastCheckpoints(game.start, nowMs);
    for (const checkpoint of past) {
      if (present.has(checkpoint)) continue;
      await recordNflPublicationEvent(env, {
        eventId,
        gameDate,
        checkpoint,
        status: NFL_PUBLICATION_STATUS.MISSING,
        detail: JSON.stringify({
          policy: "NEVER_RETROACTIVELY_INVENT",
          reason: "past-window-elapsed-without-authentic-pregame-freeze",
          hoursToStart: hoursToKickoff(game.start, nowMs),
        }),
        codeSha,
        runId,
      }).catch(() => {});
      recorded.push({ eventId, checkpoint, status: NFL_PUBLICATION_STATUS.MISSING });
    }
  }
  return { ok: true, recorded, count: recorded.length, policy: "NEVER_RETROACTIVELY_INVENT" };
}

export async function listNflResearchPublications(env, { date = null, eventId = null, limit = 200 } = {}) {
  if (!productSportDbHandle(env, "nfl").db?.prepare) return [];
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const clauses = [];
  const binds = [];
  if (date) { clauses.push(`game_date = ?${binds.length + 1}`); binds.push(String(date)); }
  if (eventId) { clauses.push(`event_id = ?${binds.length + 1}`); binds.push(String(eventId)); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT event_id, season, week, game_date, start_time, home_team, away_team, checkpoint,
                      model_id, model_version, status, published_at, hours_to_start,
                      proj_home, proj_away, proj_margin, proj_total, p_home_win,
                      coverage_share, payload_hash, r2_key, reconstructability, score_reconciled,
                      compact_json, failure_reason, code_sha
                 FROM nfl_research_publications ${where}
                ORDER BY published_at DESC
                LIMIT ${safeLimit}`;
  const stmt = productSportDbHandle(env, "nfl").db.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return (result?.results || []).map((row) => ({
    eventId: row.event_id,
    season: row.season,
    week: row.week,
    gameDate: row.game_date,
    startTime: row.start_time,
    home: row.home_team,
    away: row.away_team,
    checkpoint: row.checkpoint,
    modelId: row.model_id,
    modelVersion: row.model_version,
    status: row.status,
    publishedAt: row.published_at,
    hoursToStart: row.hours_to_start,
    projection: {
      home: row.proj_home,
      away: row.proj_away,
      margin: row.proj_margin,
      total: row.proj_total,
      pHomeWin: row.p_home_win,
    },
    coverageShare: row.coverage_share,
    payloadHash: row.payload_hash,
    r2Key: row.r2_key,
    reconstructability: row.reconstructability,
    scoreReconciled: Boolean(row.score_reconciled),
    failureReason: row.failure_reason,
    codeSha: row.code_sha,
    compact: row.compact_json ? JSON.parse(row.compact_json) : null,
  }));
}

export function buildNflPublicationCoverageReport(games = [], publications = [], nowMs = Date.now()) {
  const byEvent = new Map();
  for (const p of publications) {
    const key = String(p.eventId);
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(p);
  }

  const rows = (games || []).map((g) => {
    const eventId = String(g.id || "");
    const pubs = byEvent.get(eventId) || [];
    const current = resolveNflPublicationCheckpoint(g.start, nowMs);
    const past = expectedPastCheckpoints(g.start, nowMs);
    const present = new Set(pubs.map((p) => p.checkpoint));
    const missing = past.filter((cp) => !present.has(cp));
    const success = pubs.filter((p) => p.status === NFL_PUBLICATION_STATUS.SUCCESS || p.scoreReconciled != null);
    return {
      eventId,
      matchup: `${g.away?.abbr || "?"}@${g.home?.abbr || "?"}`,
      start: g.start || null,
      hoursToStart: hoursToKickoff(g.start, nowMs),
      currentCheckpoint: current.ok ? current.checkpoint : null,
      currentEligible: Boolean(current.ok && g.nflProShadow?.ok),
      publications: pubs.map((p) => ({
        checkpoint: p.checkpoint,
        status: p.status,
        publishedAt: p.publishedAt,
        scoreReconciled: p.scoreReconciled,
        payloadHash: p.payloadHash,
      })),
      missingCheckpoints: missing,
      missingCheckpointDetails: missing.map((cp) => ({
        checkpoint: cp,
        status: NFL_PUBLICATION_STATUS.MISSING,
        policy: "NEVER_RETROACTIVELY_INVENT",
      })),
      hasCurrentFreeze: current.ok ? present.has(current.checkpoint) : false,
      projectionOk: Boolean(g.nflProShadow?.ok),
    };
  });

  const eligible = rows.filter((r) => r.currentEligible);
  const frozenNow = eligible.filter((r) => r.hasCurrentFreeze);
  return {
    schema: "nfl-publication-coverage-v2",
    generatedAt: new Date(nowMs).toISOString(),
    games: rows.length,
    currentEligible: eligible.length,
    currentFrozen: frozenNow.length,
    currentCoverageShare: eligible.length ? frozenNow.length / eligible.length : null,
    missingCheckpointCount: rows.reduce((n, r) => n + r.missingCheckpoints.length, 0),
    blockedCount: rows.filter((r) => !r.projectionOk && hoursToKickoff(r.start, nowMs) >= 0.25).length,
    missingPolicy: "NEVER_RETROACTIVELY_INVENT",
    note: "missingCheckpoints are past windows without an authentic freeze; the scheduler publishes only the current eligible checkpoint.",
    rows,
  };
}

/**
 * Publish the currently eligible checkpoint for every slate game.
 * Idempotent. Does not invent past checkpoints.
 * When a game already has an earlier checkpoint freeze and the window has
 * rolled forward, inserting the new checkpoint is a CHECKPOINT_ROLL (new row).
 */
export async function publishNflPregameSlate(env, slate = {}, opts = {}) {
  const games = slate.games || [];
  const gameDate = slate.date || opts.gameDate || null;
  const codeSha = opts.codeSha || null;
  const publishedBy = opts.publishedBy || "nfl-pregame-publish";
  const runId = opts.runId || `nfl-pub-${Date.now()}`;
  const results = [];
  const prior = await listNflResearchPublications(env, { date: gameDate, limit: 500 }).catch(() => []);
  const priorByEvent = new Map();
  for (const row of prior) {
    const id = String(row.eventId || "");
    if (!priorByEvent.has(id)) priorByEvent.set(id, []);
    priorByEvent.get(id).push(row.checkpoint);
  }

  for (const game of games) {
    if (game.sport && game.sport !== "nfl") continue;
    const eventId = String(game.id || "");
    const priorCheckpoints = priorByEvent.get(eventId) || [];
    const packet = await buildNflResearchPublicationPacket(game, slate, {
      publishedAt: new Date().toISOString(),
      codeSha,
      gameDate,
      nowMs: opts.nowMs,
    });
    if (!packet.ok) {
      await recordNflPublicationEvent(env, {
        eventId,
        gameDate,
        checkpoint: packet.checkpoint,
        status: packet.status,
        detail: packet.reason,
        codeSha,
        runId,
      }).catch(() => {});
      results.push({
        eventId,
        matchup: `${game.away?.abbr}@${game.home?.abbr}`,
        status: packet.status,
        reason: packet.reason,
        checkpoint: packet.checkpoint,
        hoursToStart: packet.hoursToStart,
        priorCheckpoints,
      });
      continue;
    }
    const isRoll = priorCheckpoints.length > 0 && !priorCheckpoints.includes(packet.checkpoint);
    packet.compact.gameDate = gameDate;
    if (isRoll) {
      packet.compact.checkpointRoll = {
        from: priorCheckpoints,
        to: packet.checkpoint,
      };
    }
    const saved = await insertNflResearchPublication(env, packet, { publishedBy });
    if (saved.inserted && isRoll) {
      await recordNflPublicationEvent(env, {
        eventId,
        gameDate,
        checkpoint: packet.checkpoint,
        status: "CHECKPOINT_ROLL",
        detail: JSON.stringify({ from: priorCheckpoints, to: packet.checkpoint }),
        codeSha,
        runId,
      }).catch(() => {});
    }
    results.push({
      eventId: packet.eventId,
      matchup: `${game.away?.abbr}@${game.home?.abbr}`,
      status: saved.status,
      checkpoint: packet.checkpoint,
      hoursToStart: packet.hoursToStart,
      inserted: saved.inserted || false,
      checkpointRoll: isRoll,
      priorCheckpoints,
      payloadHash: saved.payloadHash || packet.payloadHash,
      r2Key: saved.r2Key || null,
      scoreReconciled: packet.compact.scoreReconciled,
      reason: saved.reason || null,
    });
  }

  const existing = await listNflResearchPublications(env, { date: gameDate, limit: 500 }).catch(() => []);
  const missingLedger = await recordMissingPastCheckpoints(env, games, existing, {
    nowMs: opts.nowMs || Date.now(),
    gameDate,
    codeSha,
    runId,
  }).catch(() => ({ ok: false, recorded: [], count: 0 }));
  const coverage = buildNflPublicationCoverageReport(games, existing, opts.nowMs || Date.now());

  return {
    ok: true,
    runId,
    gameDate,
    codeSha,
    publishedBy,
    results,
    missingLedger,
    summary: {
      attempted: results.length,
      success: results.filter((r) => r.status === NFL_PUBLICATION_STATUS.SUCCESS).length,
      already: results.filter((r) => r.status === NFL_PUBLICATION_STATUS.ALREADY).length,
      missingRecorded: missingLedger?.count || 0,
      blocked: results.filter((r) => r.status === NFL_PUBLICATION_STATUS.BLOCKED).length,
      skippedStarted: results.filter((r) => r.status === NFL_PUBLICATION_STATUS.SKIPPED_STARTED).length,
      conflicts: results.filter((r) => r.status === NFL_PUBLICATION_STATUS.CONFLICT).length,
    },
    coverage,
    governance: {
      canQualify: false,
      canAuthorizeWager: false,
      productionChampionUnchanged: true,
    },
  };
}
