#!/usr/bin/env node
/**
 * Sync Wrangler d1_migrations with a production DB that was bootstrapped via
 * schema.sql (and earlier ad-hoc applies) instead of wrangler migrations apply.
 *
 * Non-destructive: only INSERT OR IGNORE into d1_migrations for historical
 * migrations already reflected in the live schema. Never drops or rewrites data.
 *
 * Usage (CI / deploy):
 *   node scripts/sync-d1-migrations.mjs
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(root, "migrations");

function runWrangler(args, { allowFail = false } = {}) {
  const res = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    cwd: root,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = res.stdout || "";
  const stderr = res.stderr || "";
  if (res.status !== 0 && !allowFail) {
    console.error(stdout);
    console.error(stderr);
    throw new Error(`wrangler ${args.join(" ")} failed with status ${res.status}`);
  }
  return { stdout, stderr, status: res.status };
}

function extractJsonBlock(text) {
  const start = text.indexOf("[");
  const alt = text.indexOf("{");
  const i = start >= 0 && (alt < 0 || start < alt) ? start : alt;
  if (i < 0) return null;
  const slice = text.slice(i).trim();
  try {
    return JSON.parse(slice);
  } catch {
    // Try last JSON-looking array/object
    const lastArr = text.lastIndexOf("\n[");
    if (lastArr >= 0) {
      try {
        return JSON.parse(text.slice(lastArr + 1).trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function d1Query(sql) {
  const { stdout, stderr } = runWrangler([
    "d1",
    "execute",
    "fbis",
    "--remote",
    "--json",
    "--command",
    sql,
  ]);
  const parsed = extractJsonBlock(stdout) || extractJsonBlock(stderr);
  if (!parsed) {
    throw new Error(`Could not parse D1 JSON for: ${sql}\n${stdout}\n${stderr}`);
  }
  // wrangler --json shape: [{ results: [...], success, meta }]
  const rows = Array.isArray(parsed)
    ? parsed[0]?.results || parsed
    : parsed.results || [];
  return Array.isArray(rows) ? rows : [];
}

function d1Exec(sql) {
  runWrangler(["d1", "execute", "fbis", "--remote", "--command", sql]);
}

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
if (!files.length) {
  console.log("No migration files found.");
  process.exit(0);
}

// Ensure wrangler bookkeeping table exists (no-op if already present).
d1Exec(`
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const appliedRows = d1Query("SELECT name FROM d1_migrations ORDER BY id;");
const applied = new Set(appliedRows.map((r) => String(r.name || r.NAME || "")));

// Evidence that production already has the pre-0016 schema (schema.sql bootstrap).
const colRows = d1Query("PRAGMA table_info(strategy_tickets);");
const cols = new Set(colRows.map((r) => String(r.name || "")));
const hasQualifiedAt = cols.has("qualified_at");
const hasExecutionPrice = cols.has("execution_price");

const pubRows = d1Query(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='published_projections';"
);
const hasPublishedProjections = pubRows.length > 0;

console.log(
  JSON.stringify(
    {
      appliedCount: applied.size,
      hasQualifiedAt,
      hasExecutionPrice,
      hasPublishedProjections,
      migrationFiles: files.length,
    },
    null,
    2
  )
);

if (!hasQualifiedAt || !hasExecutionPrice) {
  console.log(
    "Production strategy_tickets is missing expected pre-0016 columns; leaving wrangler migrations unsynced so apply can run normally."
  );
  process.exit(0);
}

// Mark every migration before the latest as applied when the live schema already
// contains the pre-0016 contract. Never auto-mark the latest file unless its
// primary table already exists (prevents skipping new additive migrations).
const historical = files.slice(0, -1);
let inserted = 0;
for (const file of historical) {
  if (applied.has(file)) continue;
  const safe = file.replace(/'/g, "''");
  d1Exec(`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${safe}');`);
  inserted += 1;
  console.log(`Marked already-applied: ${file}`);
}

const latest = files.at(-1);
if (latest === "0016_published_projections.sql" && hasPublishedProjections && !applied.has(latest)) {
  const safe = latest.replace(/'/g, "''");
  d1Exec(`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${safe}');`);
  inserted += 1;
  console.log(`Marked already-applied latest (published_projections exists): ${latest}`);
} else if (latest && latest !== "0016_published_projections.sql") {
  console.log(`Leaving latest migration unsynced for wrangler apply: ${latest}`);
}

console.log(`D1 migration sync complete. newly_marked=${inserted}`);
