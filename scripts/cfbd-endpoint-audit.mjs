#!/usr/bin/env node
/**
 * Offline CFBD endpoint audit (GitHub Actions / local).
 * Uses CFBD_API_KEY from the environment. Never prints the key.
 * Writes artifacts/cfbd-endpoint-audit.json + feature table markdown.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runCfbdEndpointAudit, auditArtifactPayload } from "../functions/lib/cfbdEndpointAudit.js";
import { featureAvailabilityTable, markdownFeatureTable, FEATURE_CATALOG_VERSION } from "../functions/lib/cfbdFeatureCatalog.js";
import { assertNoSecretLeak } from "../functions/lib/collegeSecrets.js";

const seasons = (process.env.CFBD_AUDIT_SEASONS || "2026,2025")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const week = process.env.CFBD_AUDIT_WEEK ? Number(process.env.CFBD_AUDIT_WEEK) : undefined;

const env = { CFBD_API_KEY: process.env.CFBD_API_KEY || process.env.CBBD_API_KEY || "" };
if (!env.CFBD_API_KEY) {
  console.error(JSON.stringify({ ok: false, error: "CFBD_API_KEY missing — cannot run live audit offline" }));
  process.exit(2);
}

const report = await runCfbdEndpointAudit(env, { seasons, week });
const catalogRows = featureAvailabilityTable(report.byEndpoint || {});
const artifact = {
  ...auditArtifactPayload(report),
  featureTable: catalogRows,
  featureTableMarkdown: markdownFeatureTable(catalogRows),
  catalogVersion: FEATURE_CATALOG_VERSION,
  runner: "scripts/cfbd-endpoint-audit.mjs",
};
assertNoSecretLeak(artifact, env);

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/cfbd-endpoint-audit.json", JSON.stringify(artifact, null, 2));
writeFileSync("artifacts/cfbd-feature-table.md", artifact.featureTableMarkdown);
writeFileSync(
  "artifacts/cfbd-audit-summary.json",
  JSON.stringify(
    {
      ok: report.ok,
      configured: report.summary?.configured,
      classifications: report.summary?.classifications,
      available: report.summary?.available,
      availableButEmpty: report.summary?.availableButEmpty,
      notEntitled: report.summary?.notEntitled,
      deprecatedOrMissing: report.summary?.deprecatedOrMissing,
      authFailure: report.summary?.authFailure,
      invalidParameters: report.summary?.invalidParameters,
      transientFailure: report.summary?.transientFailure,
      seasonsTested: report.summary?.seasonsTested,
      auditedAt: report.summary?.auditedAt,
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      configured: report.summary?.configured,
      resultCount: report.summary?.resultCount,
      classifications: report.summary?.classifications,
      availableN: report.summary?.available?.length || 0,
      artifact: "artifacts/cfbd-endpoint-audit.json",
    },
    null,
    2
  )
);
