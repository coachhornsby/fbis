#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { SOURCE_REGISTRY } from "../functions/lib/canonical/sourceRegistry.js";
import {
  LINEAGE_FAMILIES,
  SPORTSDATAVERSE_INCREMENTAL_CATALOG,
  resolveLineage,
} from "../functions/lib/canonical/dataLineage.js";

const active = SOURCE_REGISTRY.filter((s) => s.active);
const byFamily = new Map();
for (const source of active) {
  for (const family of source.dataFamilies || []) {
    const key = `${source.sports.join(",")}:${source.domain}:${family}`;
    const list = byFamily.get(key) || [];
    list.push(source.providerId);
    byFamily.set(key, list);
  }
}

const overlaps = [...byFamily.entries()]
  .filter(([, providers]) => providers.length > 1)
  .map(([key, providers]) => ({ key, providers }));

const additions = SPORTSDATAVERSE_INCREMENTAL_CATALOG.filter((r) => ["ADD", "ADD_IF_MISSING"].includes(r.decision));
const skippedDuplicates = SPORTSDATAVERSE_INCREMENTAL_CATALOG.filter((r) => r.decision === "SKIP_DUPLICATE");
const licenseReview = SPORTSDATAVERSE_INCREMENTAL_CATALOG.filter((r) => r.decision === "LICENSE_REVIEW");

const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  policy: "one canonical fact per upstream lineage; retain independent lineages for validation",
  registeredSources: SOURCE_REGISTRY.length,
  activeSources: active.length,
  lineageFamilies: Object.keys(LINEAGE_FAMILIES).length,
  sourceLineage: Object.fromEntries(active.map((s) => [s.providerId, resolveLineage(s.providerId)])),
  overlaps,
  sportsdataverse: {
    candidates: SPORTSDATAVERSE_INCREMENTAL_CATALOG.length,
    additions,
    skippedDuplicates,
    licenseReview,
  },
};

mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/data-stack-audit.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
