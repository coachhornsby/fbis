/**
 * Retention release gate: no primary-source retirement without verified recovery copies.
 * Existing immutable manifests with retentionReleaseAuthorized:false remain binding.
 */

import { createHash } from "node:crypto";
import { DATABASE_OWNERS } from "./databaseOwnership.js";
import { withOperationsWrite } from "./operationsDb.js";

export const RETENTION_GATE_CONTRACT = "fbis-retention-release-gate-v1";

function sha256Hex(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

/**
 * Evaluate whether a proposed retention/deletion may proceed.
 * All recovery evidence flags must be true and authorization must be explicit.
 */
export function evaluateRetentionRelease(proposal = {}) {
  const checks = [
    {
      key: "r2_archive_verified",
      ok: proposal.r2ArchiveVerified === true,
      detail: "R2 archive object readback must match content-addressed SHA-256",
    },
    {
      key: "r2_readback_sha256",
      ok: typeof proposal.r2ReadbackSha256 === "string" && /^[a-f0-9]{64}$/.test(proposal.r2ReadbackSha256),
      detail: "Pinned 64-hex SHA-256 of the verified archive package is required",
    },
    {
      key: "independent_restore_verified",
      ok: proposal.independentRestoreVerified === true,
      detail: "Independent SQLite/D1 restore must prove full-field parity",
    },
    {
      key: "consumer_audit_complete",
      ok: proposal.consumerAuditComplete === true,
      detail: "Runtime consumer/dependency audit must be complete",
    },
    {
      key: "retention_release_authorized",
      ok: proposal.retentionReleaseAuthorized === true,
      detail: "A new explicit release manifest must set retentionReleaseAuthorized:true",
    },
    {
      key: "source_rows_not_already_deleted",
      ok: Number(proposal.sourceRowsDeleted || 0) === 0,
      detail: "Gate evaluation must precede deletion; sourceRowsDeleted must still be 0",
    },
    {
      key: "not_reinterpreting_blocked_manifest",
      ok: proposal.priorManifestAuthorized !== false || proposal.newReleaseManifest === true,
      detail: "Blocked prior manifests cannot be reinterpreted; issue a new release package",
    },
  ];

  const failed = checks.filter((c) => !c.ok);
  const authorized = failed.length === 0;
  return {
    contract: RETENTION_GATE_CONTRACT,
    authorized,
    canDeleteSourceRows: authorized,
    failedChecks: failed.map((c) => c.key),
    checks,
    blockedReason: authorized ? null : failed.map((c) => c.key).join(","),
    sourceDatabase: proposal.sourceDatabase || DATABASE_OWNERS.PRIMARY.databaseName,
    cohortKey: proposal.cohortKey || null,
  };
}

export function retentionGateRecord(proposal = {}, evaluation = null) {
  const result = evaluation || evaluateRetentionRelease(proposal);
  const body = JSON.stringify({
    contract: RETENTION_GATE_CONTRACT,
    cohortKey: proposal.cohortKey || null,
    evaluation: result,
    proposedAt: proposal.proposedAt || new Date().toISOString(),
  });
  return {
    releaseId: proposal.releaseId || `retention:${proposal.cohortKey || "unknown"}:${sha256Hex(body).slice(0, 16)}`,
    cohortKey: proposal.cohortKey || "unknown",
    sourceDatabase: result.sourceDatabase,
    proposedAt: proposal.proposedAt || new Date().toISOString(),
    r2ArchiveVerified: proposal.r2ArchiveVerified === true ? 1 : 0,
    r2ReadbackSha256: proposal.r2ReadbackSha256 || null,
    independentRestoreVerified: proposal.independentRestoreVerified === true ? 1 : 0,
    independentRestoreEvidence: proposal.independentRestoreEvidence || null,
    driveCopyVerified: proposal.driveCopyVerified === true ? 1 : 0,
    consumerAuditComplete: proposal.consumerAuditComplete === true ? 1 : 0,
    retentionReleaseAuthorized: result.authorized ? 1 : 0,
    sourceRowsDeleted: Number(proposal.sourceRowsDeleted || 0),
    blockedReason: result.blockedReason,
    metadataJson: JSON.stringify({
      checks: result.checks,
      evidenceSha256: sha256Hex(body),
      newReleaseManifest: proposal.newReleaseManifest === true,
    }),
  };
}

export async function persistRetentionGate(env, proposal) {
  const evaluation = evaluateRetentionRelease(proposal);
  const record = retentionGateRecord(proposal, evaluation);
  return withOperationsWrite(env, async (db) => {
    await db.prepare(
      `INSERT OR REPLACE INTO fbis_retention_release_gates (
        release_id, cohort_key, source_database, proposed_at,
        r2_archive_verified, r2_readback_sha256, independent_restore_verified,
        independent_restore_evidence, drive_copy_verified, consumer_audit_complete,
        retention_release_authorized, source_rows_deleted, blocked_reason, metadata_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      record.releaseId,
      record.cohortKey,
      record.sourceDatabase,
      record.proposedAt,
      record.r2ArchiveVerified,
      record.r2ReadbackSha256,
      record.independentRestoreVerified,
      record.independentRestoreEvidence,
      record.driveCopyVerified,
      record.consumerAuditComplete,
      record.retentionReleaseAuthorized,
      record.sourceRowsDeleted,
      record.blockedReason,
      record.metadataJson
    ).run();
    return { ok: true, evaluation, record };
  });
}
