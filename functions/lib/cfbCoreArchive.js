/**
 * Weekly point-in-time CORE archive for research shadow systems.
 * CORE remains research-only until explicitly promoted.
 * Never convert CORE per-100-play ratings into scoreboard points without validated transforms.
 *
 * Archive rows are keyed by the **actual** CFBD `throughWeek` present on rating
 * rows after week-bounding — never by the budgeted `targetWeek − 1` alone.
 * Budgeted throughWeek may exceed what CFBD has published; claiming that week
 * would fabricate a newer statistical snapshot.
 */

import { coreProvenancePatches, CFB_CORE_ADVANCED_AUTHORITY, coreThroughWeekBound } from "./cfbCoreAdvancedPlumbing.js";

export const CORE_ARCHIVE_VERSION = "cfb-core-weekly-archive-v1";
export const CORE_RESEARCH_ONLY = true;

/**
 * Normalize a weekly CORE release for durable archive.
 * `throughWeek` on the payload = max actual CFBD throughWeek among eligible rows.
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
  const budgetedThroughWeek = coreThroughWeekBound(targetWeek);
  const collected = collectionTime || new Date().toISOString();
  const { bySchoolKey, n, maxWeek } = coreProvenancePatches(coreRows, {
    maxWeek: budgetedThroughWeek,
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
    throughWeek: patch.coreThroughWeek,
    throughSeasonType: patch.coreThroughSeasonType || "regular",
    coreWeekBounded: patch.coreWeekBounded === true,
  }));

  const actualWeeks = teams
    .map((t) => t.throughWeek)
    .filter((w) => Number.isFinite(Number(w)))
    .map(Number);
  const actualThroughWeek = actualWeeks.length ? Math.max(...actualWeeks) : null;
  const labelingLag =
    budgetedThroughWeek != null &&
    actualThroughWeek != null &&
    actualThroughWeek < budgetedThroughWeek;

  return {
    version: CORE_ARCHIVE_VERSION,
    authority: CFB_CORE_ADVANCED_AUTHORITY,
    researchOnly: CORE_RESEARCH_ONLY,
    canInfluenceProjection: false,
    canAuthorizeWager: false,
    season: Number(season),
    targetWeek: Number(targetWeek),
    /** Actual CFBD statistical throughWeek — archive key. */
    throughWeek: actualThroughWeek,
    budgetedThroughWeek,
    labelingLag: Boolean(labelingLag),
    sourceEndpoint,
    publicationTime: publicationTime || null,
    collectionTime: collected,
    ingestionBatchId:
      ingestionBatchId ||
      `core:${season}:w${actualThroughWeek ?? "na"}:${collected}`,
    jobRunId: jobRunId || null,
    teamCount: n,
    maxWeek,
    teams,
    note:
      labelingLag
        ? `CFBD CORE published throughWeek=${actualThroughWeek}; budgeted throughWeek=${budgetedThroughWeek} not yet available — archive keyed to actual`
        : "CORE units are efficiency per ~100 plays — not interchangeable with PPA→points or SP+",
  };
}

/**
 * D1 row shape for cfb_core_weekly_archive (one row per team per actual throughWeek).
 * Skips teams lacking an actual CFBD throughWeek (fail closed).
 */
export function coreArchiveRowsFromPayload(payload) {
  const rows = [];
  const p = payload || {};
  const archiveThroughWeek = p.throughWeek;
  if (archiveThroughWeek == null || !Number.isFinite(Number(archiveThroughWeek))) {
    return rows;
  }
  for (const t of p.teams || []) {
    const teamTw = t.throughWeek;
    if (teamTw == null || !Number.isFinite(Number(teamTw))) continue;
    // Only archive teams whose CFBD throughWeek matches the snapshot week.
    if (Number(teamTw) !== Number(archiveThroughWeek)) continue;
    rows.push({
      archive_id: `${p.season}:${archiveThroughWeek}:${t.schoolKey}`,
      season: p.season,
      through_week: Number(archiveThroughWeek),
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
  if (payload?.throughWeek == null) {
    return {
      ok: false,
      reason: "no_actual_cfbd_through_week",
      written: 0,
      budgetedThroughWeek: payload?.budgetedThroughWeek ?? null,
      labelingLag: payload?.labelingLag ?? null,
      researchOnly: true,
    };
  }
  const rows = coreArchiveRowsFromPayload(payload);
  if (!rows.length) {
    return {
      ok: false,
      reason: "no_archive_rows",
      written: 0,
      throughWeek: payload.throughWeek,
      researchOnly: true,
    };
  }
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
    teamCount: written,
    throughWeek: payload?.throughWeek ?? null,
    budgetedThroughWeek: payload?.budgetedThroughWeek ?? null,
    labelingLag: payload?.labelingLag ?? false,
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
