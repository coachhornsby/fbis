/**
 * CFB storage architecture and retention policy.
 * Prefer private R2 for immutable source archives; versioned D1 for queryable features.
 * Reuses retentionGate — never delete without verified archive + authorization.
 */

import { evaluateRetentionRelease, retentionGateRecord } from "./retentionGate.js";

export const RETENTION_POLICY_VERSION = "cfb-retention-policy-v1";

/** Permanent retention classes — never expire. */
export const RETAIN_PERMANENTLY = Object.freeze([
  {
    id: "raw_source_versions",
    storage: "R2",
    description: "Raw provider payloads used in research or model decisions",
    examples: ["college_source_archives", "cfb_cfbd_acquisition_receipts pointers"],
  },
  {
    id: "historical_weekly_features",
    storage: "D1 + R2",
    description: "Weekly features required to reproduce predictions",
    examples: ["team_feature_snapshots", "cfb_pregame_feature_vectors"],
  },
  {
    id: "source_lineage_hashes",
    storage: "D1",
    description: "Source lineage and content hashes",
    examples: ["cfb_collection_manifests", "content_hash columns"],
  },
  {
    id: "model_feature_vectors",
    storage: "D1",
    description: "Frozen pregame feature vectors",
    examples: ["cfb_pregame_feature_vectors"],
  },
  {
    id: "frozen_predictions",
    storage: "D1",
    description: "Frozen projection snapshots",
    examples: ["published_projections", "cfb_forward_snapshots"],
  },
  {
    id: "verified_game_results",
    storage: "D1 + R2",
    description: "Settled finals used for evaluation",
    examples: ["observations", "postgame harvest archives"],
  },
  {
    id: "evaluation_and_artifacts",
    storage: "D1 + R2/GH artifacts",
    description: "Evaluation records and model artifacts",
    examples: ["model_validation_runs", "fitted coefficient receipts"],
  },
  {
    id: "identity_schema_history",
    storage: "D1",
    description: "Identity and schema change histories",
    examples: ["cfb_canonical_teams", "cfbd_endpoint_audit"],
  },
  {
    id: "core_weekly_pit",
    storage: "D1 + R2",
    description: "Weekly point-in-time CORE releases for research replay",
    examples: ["cfb_core_weekly_archive"],
  },
]);

/** Controlled expiration — only after retention gate passes. */
export const ALLOW_CONTROLLED_EXPIRATION = Object.freeze([
  {
    id: "http_caches",
    storage: "Workers Cache API",
    description: "Replaceable HTTP caches (e.g. cfb-sdv-intelligence 30m TTL)",
    maxAgeHint: "minutes–hours",
  },
  {
    id: "duplicate_transient_downloads",
    storage: "ephemeral /tmp or staging",
    description: "Duplicate transient downloads superseded by archived hash",
    maxAgeHint: "hours",
  },
  {
    id: "superseded_staging_jobs",
    storage: "staging JSONL",
    description: "Superseded staging job outputs with durable archive present",
    maxAgeHint: "days",
  },
  {
    id: "rebuildable_intermediates",
    storage: "local/run dirs",
    description: "Rebuildable intermediate files not needed for audit/replay",
    maxAgeHint: "days–weeks",
  },
]);

export const STORAGE_ARCHITECTURE = Object.freeze({
  version: RETENTION_POLICY_VERSION,
  flow: [
    "SDV raw archive (R2/cache) → SDV validation → canonical feature store (D1)",
    "CFBD raw archive (R2) → CFBD validation → canonical feature store (D1)",
    "Canonical feature store → frozen pregame inputs → champion + research challengers",
  ],
  rules: [
    "Do not merge raw provider datasets into an undocumented combined table",
    "Do not expand primary D1 with replaceable bulk blobs — use R2 pointers",
    "Shared CFBD/CBBD quota receipts stay durable even when payloads are R2-only",
    "Deletion requires evaluateRetentionRelease authorization",
  ],
  permanent: RETAIN_PERMANENTLY,
  expireable: ALLOW_CONTROLLED_EXPIRATION,
});

/**
 * Propose deletion of an expireable class; fails closed via retentionGate.
 */
export function proposeCfbRetentionRelease(proposal = {}) {
  const classId = proposal.retentionClassId;
  const allowed = ALLOW_CONTROLLED_EXPIRATION.some((c) => c.id === classId);
  if (!allowed) {
    return {
      authorized: false,
      canDeleteSourceRows: false,
      blockedReason: "not_expireable_class",
      detail: "Only controlled-expiration classes may be proposed for deletion",
      retentionClassId: classId || null,
    };
  }
  if (RETAIN_PERMANENTLY.some((c) => c.id === classId)) {
    return {
      authorized: false,
      canDeleteSourceRows: false,
      blockedReason: "permanent_class",
      detail: "Permanent retention class cannot be deleted",
      retentionClassId: classId,
    };
  }
  const evaluation = evaluateRetentionRelease(proposal);
  return {
    ...evaluation,
    retentionClassId: classId,
    policyVersion: RETENTION_POLICY_VERSION,
    record: retentionGateRecord(proposal, evaluation),
  };
}

export function summarizeRetentionPolicy() {
  return {
    version: RETENTION_POLICY_VERSION,
    architecture: STORAGE_ARCHITECTURE,
    permanentCount: RETAIN_PERMANENTLY.length,
    expireableCount: ALLOW_CONTROLLED_EXPIRATION.length,
    gateContract: "fbis-retention-release-gate-v1",
  };
}
