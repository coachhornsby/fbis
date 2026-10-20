#!/usr/bin/env node
/**
 * Reconcile local 2025 Tier3 weekly CSVs against CORE archive rows (JSON or D1 export).
 * Research-only. Does not call CFBD or touch production A/A.
 *
 * Env:
 *   CFB_TIER3_DIR     — directory of week*.csv (default /opt/cursor/artifacts/tier3-csv-2025)
 *   CFB_CORE_ARCHIVES — JSON array of archive rows {season,through_week,school_key,core,...}
 *   CFB_RECONCILE_OUT — output path (default artifacts/cfb-tier3-core-reconcile.json)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  parseTier3TrainingCsv,
  reconcileTier3WithCoreArchives,
} from "../functions/lib/cfbCoreTier3Reconcile.js";

const tier3Dir = resolve(process.env.CFB_TIER3_DIR || "/opt/cursor/artifacts/tier3-csv-2025");
const archivesPath = process.env.CFB_CORE_ARCHIVES
  ? resolve(process.env.CFB_CORE_ARCHIVES)
  : null;
const outPath = resolve(
  process.env.CFB_RECONCILE_OUT || "artifacts/cfb-tier3-core-reconcile.json"
);

function loadArchives() {
  if (!archivesPath || !existsSync(archivesPath)) return [];
  const raw = JSON.parse(readFileSync(archivesPath, "utf8"));
  return Array.isArray(raw) ? raw : raw.rows || raw.archiveRows || [];
}

function loadTier3Games() {
  if (!existsSync(tier3Dir)) return { games: [], files: [] };
  const files = readdirSync(tier3Dir).filter((f) => f.endsWith(".csv"));
  const games = [];
  for (const f of files) {
    const weekMatch = f.match(/week(\d+)/i);
    const defaultWeek = weekMatch ? Number(weekMatch[1]) : null;
    const parsed = parseTier3TrainingCsv(readFileSync(join(tier3Dir, f), "utf8"), {
      defaultSeason: 2025,
      defaultWeek,
    });
    for (const row of parsed.rows) {
      if (row.season == null) row.season = 2025;
      if (row.week == null && defaultWeek != null) row.week = defaultWeek;
      games.push({ ...row, sourceFile: f });
    }
  }
  return { games, files };
}

const { games, files } = loadTier3Games();
const archiveRows = loadArchives();
const report = reconcileTier3WithCoreArchives({
  tier3Games: games,
  archiveRows,
});

const out = {
  generatedAt: new Date().toISOString(),
  researchOnly: true,
  tier3Dir,
  tier3Files: files,
  tier3Games: games.length,
  archiveRows: archiveRows.length,
  archivesPath: archivesPath || null,
  ...report,
  note:
    archiveRows.length === 0
      ? "No CORE archives supplied — reconcile reports missing throughWeek coverage until reconstruction completes."
      : "Tier3 CSVs are EPA feature docs; CORE is /ratings/core. Matched on school coverage only.",
};

mkdirSync(resolve(outPath, ".."), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      out: outPath,
      tier3Games: games.length,
      archiveRows: archiveRows.length,
      matched: report.matched,
      missingCoreWeek: report.missingCoreWeek,
      missingTeam: report.missingTeam,
    },
    null,
    2
  )
);
