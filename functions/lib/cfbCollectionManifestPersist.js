/**
 * Persist CFB collection manifests to D1.
 * Never fabricates historical success — only writes evidence from a real attempt.
 */

import { DATASET_STATUS } from "./cfbSdvSourceRegistry.js";

export const MANIFEST_PERSIST_VERSION = "cfb-collection-manifest-persist-v1";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Build a manifest row from a live collection attempt.
 * @param {{
 *   season:number, week:number, provider:string, datasetId:string,
 *   required?:boolean, httpOk?:boolean, httpStatus?:number,
 *   rowCount?:number|null, teamCoverage?:number|null, throughWeek?:number|null,
 *   schemaOk?:boolean|null, contentHash?:string|null, ingestionBatchId?:string|null,
 *   collectedAt?:string|null, status?:string|null, alerts?:array,
 *   evidence?:object
 * }} input
 */
export function buildManifestRow(input = {}) {
  const collectedAt = input.collectedAt || nowIso();
  const httpOk = input.httpOk === true || Number(input.httpStatus) === 200;
  const rowCount = input.rowCount == null ? null : Number(input.rowCount);
  const teamCoverage = input.teamCoverage == null ? null : Number(input.teamCoverage);
  let status = input.status || null;
  if (!status) {
    // Keys must match DATASET_STATUS exports (COMPLETE_VERIFIED / PARTIAL / BLOCKED_ALLOWANCE).
    // Wrong keys previously yielded status=undefined and silent D1 NOT NULL insert failures.
    if (input.allowanceBlocked) status = DATASET_STATUS.BLOCKED_ALLOWANCE;
    else if (!httpOk) status = DATASET_STATUS.FAILED;
    else if (!(rowCount > 0)) status = DATASET_STATUS.FAILED;
    else if (teamCoverage != null && teamCoverage < 100) status = DATASET_STATUS.PARTIAL;
    else status = DATASET_STATUS.COMPLETE_VERIFIED;
  }
  if (status == null || status === "") {
    status = DATASET_STATUS.FAILED;
  }
  const manifestId = [
    input.season,
    `W${input.week}`,
    input.datasetId,
    (input.ingestionBatchId || collectedAt).slice(0, 24),
  ].join(":");
  return {
    manifest_id: manifestId,
    season: Number(input.season),
    week: Number(input.week),
    provider: String(input.provider || "cfbd"),
    dataset_id: String(input.datasetId),
    status,
    required: input.required ? 1 : 0,
    http_ok: httpOk ? 1 : 0,
    row_count: rowCount,
    team_coverage: teamCoverage,
    through_week: input.throughWeek == null ? null : Number(input.throughWeek),
    schema_ok: input.schemaOk == null ? null : input.schemaOk ? 1 : 0,
    content_hash: input.contentHash || null,
    ingestion_batch_id: input.ingestionBatchId || null,
    collected_at: collectedAt,
    alerts_json: JSON.stringify(input.alerts || []),
    evidence_json: JSON.stringify({
      ...(input.evidence || {}),
      httpStatus: input.httpStatus ?? (httpOk ? 200 : null),
      persistVersion: MANIFEST_PERSIST_VERSION,
    }),
    created_at: collectedAt,
    updated_at: collectedAt,
  };
}

/**
 * Upsert one manifest receipt. Fails soft if table missing.
 */
export async function persistCollectionManifest(env, row) {
  if (!env?.DB || !row?.manifest_id) return { ok: false, reason: "no_db_or_row" };
  try {
    await env.DB.prepare(
      `INSERT INTO cfb_collection_manifests(
         manifest_id, season, week, provider, dataset_id, status, required,
         http_ok, row_count, team_coverage, through_week, schema_ok, content_hash,
         ingestion_batch_id, collected_at, alerts_json, evidence_json, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(manifest_id) DO UPDATE SET
         status=excluded.status,
         http_ok=excluded.http_ok,
         row_count=excluded.row_count,
         team_coverage=excluded.team_coverage,
         through_week=excluded.through_week,
         schema_ok=excluded.schema_ok,
         content_hash=excluded.content_hash,
         alerts_json=excluded.alerts_json,
         evidence_json=excluded.evidence_json,
         updated_at=excluded.updated_at`
    )
      .bind(
        row.manifest_id,
        row.season,
        row.week,
        row.provider,
        row.dataset_id,
        row.status,
        row.required,
        row.http_ok,
        row.row_count,
        row.team_coverage,
        row.through_week,
        row.schema_ok,
        row.content_hash,
        row.ingestion_batch_id,
        row.collected_at,
        row.alerts_json,
        row.evidence_json,
        row.created_at,
        row.updated_at
      )
      .run();
    return { ok: true, manifestId: row.manifest_id };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistCollectionManifests(env, rows = []) {
  const results = [];
  for (const row of rows) {
    results.push(await persistCollectionManifest(env, row));
  }
  return {
    attempted: rows.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** Map CFBD endpoint path → registry dataset id for morning refresh. */
export const CFBD_PATH_TO_DATASET = Object.freeze({
  "/ppa/teams": "cfbd-ppa-teams",
  "/stats/season/advanced": "cfbd-stats-season-advanced",
  "/ratings/sp": "cfbd-ratings-sp",
  "/ratings/fpi": "cfbd-ratings-fpi",
  "/ratings/srs/expanded": "cfbd-ratings-srs",
  "/ratings/elo": "cfbd-ratings-elo",
  "/ratings/core": "cfbd-ratings-core",
  "/talent": "cfbd-talent-returning",
  "/games": "cfbd-games",
  "/games/teams": "cfbd-games-teams-players",
  "/games/players": "cfbd-games-teams-players",
  "/ppa/games": "cfbd-ppa-games",
  "/stats/game/advanced": "cfbd-stats-game-advanced",
  "/lines": "cfbd-lines",
  "/info": "cfbd-info",
});

/**
 * Build an evidence-backed receipt from a real R2 archive object.
 * Never invents row counts — only documents what is present in storage.
 * Prefer explicit `rowCount` from source_observations / payload inspection when known.
 */
export function buildR2ArchiveManifestRow({
  season,
  week,
  datasetId,
  r2Key,
  uploadedAt = null,
  objectBytes = null,
  throughWeek = null,
  status = null,
  rowCount = null,
  teamCoverage = null,
  ingestionBatchId = null,
  evidence = null,
} = {}) {
  if (!datasetId || !r2Key) return null;
  const collectedAt = uploadedAt || new Date().toISOString();
  const resolvedRows =
    rowCount != null && Number.isFinite(Number(rowCount))
      ? Number(rowCount)
      : objectBytes != null && objectBytes > 0
        ? 1
        : null;
  return buildManifestRow({
    season,
    week,
    provider: "cfbd",
    datasetId,
    required: true,
    httpOk: true,
    httpStatus: 200,
    rowCount: resolvedRows,
    teamCoverage,
    throughWeek,
    schemaOk: null,
    contentHash: `r2:${r2Key}`,
    ingestionBatchId: ingestionBatchId || `r2-recon:${String(r2Key).slice(-24)}`,
    collectedAt,
    status: status || (resolvedRows > 0 ? undefined : DATASET_STATUS.FAILED),
    evidence: {
      source: "r2_archive_reconcile",
      r2Key,
      objectBytes,
      uploadedAt: collectedAt,
      note: "Receipt from verified ARCHIVE object — not a fabricated historical claim",
      ...(evidence || {}),
    },
  });
}

/**
 * Distinguish refresh target week from the completed statistical week archived.
 * Weekly reconstruction always queries throughWeek = targetWeek − 1.
 */
export function describeWeeklyReconstructionWindow(targetWeek) {
  const target = Number(targetWeek);
  if (!Number.isInteger(target) || target < 1) {
    return { ok: false, reason: "invalid-target-week" };
  }
  const throughWeek = Math.max(0, target - 1);
  return {
    ok: throughWeek >= 1,
    targetWeek: target,
    throughWeek,
    statisticalWeek: throughWeek,
    note:
      throughWeek >= 1
        ? `targetWeek=${target} archives completed statistical week ${throughWeek} (throughWeek=targetWeek-1)`
        : "No completed statistical week yet for this target",
  };
}
