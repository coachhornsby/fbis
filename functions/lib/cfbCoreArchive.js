/**
 * Weekly point-in-time CORE archive for research shadow systems.
 * CORE remains research-only until explicitly promoted.
 * Never convert CORE per-100-play ratings into scoreboard points without validated transforms.
 */

import { coreProvenancePatches, CFB_CORE_ADVANCED_AUTHORITY, coreThroughWeekBound } from "./cfbCoreAdvancedPlumbing.js";

export const CORE_ARCHIVE_VERSION = "cfb-core-weekly-archive-v1";
export const CORE_RESEARCH_ONLY = true;

/**
 * Normalize a weekly CORE release for durable archive.
 */
export function buildCoreWeeklyArchivePayload({
  season,
  targetWeek,
  coreRows = [],
  collectionTime = null,
  publicationTime = null,
  ingestionBatchId = null,
  sourceEndpoint = "/ratings/core",
  jobRunId = null,
} = {}) {
  const throughWeek = coreThroughWeekBound(targetWeek);
  const collected = collectionTime || new Date().toISOString();
  const { bySchoolKey, n, maxWeek } = coreProvenancePatches(coreRows, {
    maxWeek: throughWeek,
    seasonType: "regular",
    season,
  });

  const teams = Object.entries(bySchoolKey).map(([schoolKey, patch]) => ({
    schoolKey,
    core: patch.core,
    coreOffense: patch.coreOffense,
    coreDefense: patch.coreDefense,
    coreSpecialTeams: patch.coreSpecialTeams ?? null,
    year: patch.coreYear ?? Number(season),
    throughWeek: patch.coreThroughWeek ?? throughWeek,
    throughSeasonType: patch.coreThroughSeasonType || "regular",
    coreWeekBounded: patch.coreWeekBounded === true,
  }));

  return {
    version: CORE_ARCHIVE_VERSION,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
    researchOnly: CORE_RESEARCH_ONLY,
    canInfluenceProjection: false,
    canAuthorizeWager: false,
    season: Number(season),
    targetWeek: Number(targetWeek),
    throughWeek,
    sourceEndpoint,
    publicationTime: publicationTime || null,
    collectionTime: collected,
    ingestionBatchId: ingestionBatchId || `core:${season}:w${throughWeek}:${collected}`,
    jobRunId: jobRunId || null,
    teamCount: n,
    maxWeek,
    teams,
    note: "CORE units are efficiency per ~100 plays — not interchangeable with PPA→points or SP+",
  };
}

/**
 * D1 row shape for cfb_core_weekly_archive (one row per team per throughWeek).
 */
export function coreArchiveRowsFromPayload(payload) {
  const rows = [];
  const p = payload || {};
  for (const t of p.teams || []) {
    rows.push({
      archive_id: `${p.season}:${p.throughWeek}:${t.schoolKey}`,
      season: p.season,
      through_week: p.throughWeek,
      target_week: p.targetWeek,
      school_key: t.schoolKey,
      core: t.core,
      core_offense: t.coreOffense,
      core_defense: t.coreDefense,
      core_special_teams: t.coreSpecialTeams,
      year: t.year,
      through_season_type: t.throughSeasonType,
      source_endpoint: p.sourceEndpoint,
      publication_time: p.publicationTime,
      collection_time: p.collectionTime,
      ingestion_batch_id: p.ingestionBatchId,
      job_run_id: p.jobRunId,
      research_only: 1,
      can_influence_projection: 0,
      archive_version: CORE_ARCHIVE_VERSION,
    });
  }
  return rows;
}

/**
 * Persist CORE weekly archive to D1 when DB available. Idempotent on archive_id.
 */
export async function persistCoreWeeklyArchive(env, payload) {
  const db = env?.DB;
  if (!db) {
    return { ok: false, reason: "no_db", written: 0 };
  }
  const rows = coreArchiveRowsFromPayload(payload);
  let written = 0;
  const sql = `INSERT INTO cfb_core_weekly_archive (
    archive_id, season, through_week, target_week, school_key,
    core, core_offense, core_defense, core_special_teams, year,
    through_season_type, source_endpoint, publication_time, collection_time,
    ingestion_batch_id, job_run_id, research_only, can_influence_projection,
    archive_version, created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
  ON CONFLICT(archive_id) DO UPDATE SET
    core=excluded.core,
    core_offense=excluded.core_offense,
    core_defense=excluded.core_defense,
    collection_time=excluded.collection_time,
    ingestion_batch_id=excluded.ingestion_batch_id
  WHERE cfb_core_weekly_archive.research_only = 1`;

  for (const r of rows) {
    try {
      await db
        .prepare(sql)
        .bind(
          r.archive_id,
          r.season,
          r.through_week,
          r.target_week,
          r.school_key,
          r.core,
          r.core_offense,
          r.core_defense,
          r.core_special_teams,
          r.year,
          r.through_season_type,
          r.source_endpoint,
          r.publication_time,
          r.collection_time,
          r.ingestion_batch_id,
          r.job_run_id,
          r.research_only,
          r.can_influence_projection,
          r.archive_version
        )
        .run();
      written += 1;
    } catch (err) {
      return {
        ok: false,
        reason: String(err?.message || err),
        written,
        researchOnly: true,
      };
    }
  }
  return {
    ok: true,
    written,
    teamCount: payload?.teamCount ?? written,
    throughWeek: payload?.throughWeek ?? null,
    researchOnly: true,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
  };
}

/**
 * Research readiness: archived PIT available, not promoted to champion.
 */
export function evaluateCoreResearchReadiness({
  archiveTeamCount = 0,
  expectedFloor = 100,
  championPromotionAuthorized = false,
} = {}) {
  const archiveOk = Number(archiveTeamCount) >= expectedFloor;
  return {
    researchReady: archiveOk,
    championEligible: false,
    championPromotionAuthorized: championPromotionAuthorized === true,
    archiveTeamCount: Number(archiveTeamCount) || 0,
    expectedFloor,
    blockers: [
      ...(archiveOk ? [] : ["insufficient_pit_archive_coverage"]),
      ...(championPromotionAuthorized
        ? ["promotion_requested_but_requires_separate_validation"]
        : ["core_remains_research_only"]),
    ],
    note: "Do not convert CORE per-100-play into scoreboard points without validated model transforms",
  };
}
