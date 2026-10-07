import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = join(root, "migrations");
const schemaPaths = [join(root, "schema.sql"), join(root, "schema.extensions.sql")];

function extractCreateTables(sql) {
  const out = new Set();
  const re = /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(sql))) out.add(m[1]);
  return out;
}

const schemaTables = new Set();
for (const path of schemaPaths) {
  try {
    const body = await readFile(path, "utf8");
    for (const table of extractCreateTables(body)) schemaTables.add(table);
  } catch (err) {
    if (String(path).endsWith("schema.sql")) throw err;
  }
}

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
const missing = [];
const registrationFailures = [];
const registrationColumnFailures = [];
const legacyRegistrationExceptions = new Set(["0010_mlb_market_projections.sql"]);
const legacyDuplicatePrefixes = new Map([
  ["0039", ["0039_nba_research_models.sql", "0039_soccer_canonical.sql"]],
  ["0040", ["0040_cbb_player_prop_signals.sql", "0040_nba_prospective_shadow_grading.sql", "0040_wnba_prop_validation.sql"]],
  ["0041", ["0041_nba_market_qualification.sql", "0041_nfl_wager_decisions.sql"]],
  ["0042", ["0042_nba_game_level_decision.sql", "0042_nhl_wager_research.sql"]],
  ["0043", ["0043_nhl_wager_confidence_runs.sql", "0043_wnba_wager_decision_architecture.sql"]],
  ["0052", ["0052_nba_deep_game_model.sql", "0052_soccer_v2_features.sql", "0052_tennis_full_markets.sql"]],
  ["0053", ["0053_nba_official_availability.sql", "0053_tennis_player_bank.sql"]],
  ["0055", ["0055_mlb_persistent_profiles.sql", "0055_nfl_persistent_team_profiles.sql"]],
  ["0067", ["0067_cfb_persistent_directory_phase_a.sql", "0067_soccer_phase3b_validation_provenance.sql"]],
  ["0069", ["0069_nba_prospective_profile_ablation.sql", "0069_nhl_goalie_shadow_integrity_v2.sql"]],
  ["0070", ["0070_fbis_cross_sport_evidence.sql", "0070_nba_prospective_market_linkage.sql"]],
  ["0078", ["0078_asian_baseball_history_foundation.sql", "0078_cfb_subdivision_normalization.sql"]],
  ["0079", ["0079_cbb_persistent_directory_phase_a.sql", "0079_soccer_phase3f_research_routing.sql"]],
  ["0081", ["0081_soccer_phase3g_shadow_grading_fields.sql", "0081_tennis_wta_official_zero_cleanup.sql"]],
]);
const prefixOwners = new Map();
for (const file of files) {
  const prefix = file.match(/^(\d+)_/)?.[1];
  if (!prefix) continue;
  const owners = prefixOwners.get(prefix) || [];
  owners.push(file);
  prefixOwners.set(prefix, owners);
}
const duplicatePrefixes = [...prefixOwners.entries()].filter(([, owners]) => owners.length > 1);
for (const file of files) {
  const body = await readFile(join(migrationsDir, file), "utf8");
  const tables = [...extractCreateTables(body)];
  for (const t of tables) {
    if (!schemaTables.has(t)) missing.push({ file, table: t });
  }
  for (const match of body.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+schema_migrations\s*\(([^)]+)\)/gi)) {
    const columns = match[1].split(",").map((v) => v.trim().toLowerCase());
    if (!columns.includes("id") || columns.some((v) => !["id", "applied_at"].includes(v))) {
      registrationColumnFailures.push({ file, columns });
    }
  }
  const id = file.replace(/\.sql$/, "");
  if (file === files.at(-1) && !new RegExp(`schema_migrations[\\s\\S]*['\"]${id}['\"]`, "i").test(body)) {
    registrationFailures.push({ file, id });
  }
}

if (registrationColumnFailures.length) {
  console.error("Migration ledger columns must match schema_migrations(id, applied_at):");
  for (const m of registrationColumnFailures) console.error(`- ${m.file}: ${m.columns.join(", ")}`);
  process.exit(1);
}

if (missing.length) {
  console.error("Canonical schema bundle is missing tables introduced by migrations:");
  for (const m of missing) console.error(`- ${m.file}: ${m.table}`);
  process.exit(1);
}

if (registrationFailures.length) {
  console.error("Migration does not register itself in schema_migrations:");
  for (const m of registrationFailures) console.error(`- ${m.file}: expected ${m.id}`);
  process.exit(1);
}

const unexpectedDuplicatePrefixes = duplicatePrefixes.filter(([prefix, owners]) => {
  const expected = legacyDuplicatePrefixes.get(prefix);
  return !expected || JSON.stringify([...owners].sort()) !== JSON.stringify([...expected].sort());
});
if (unexpectedDuplicatePrefixes.length) {
  console.error("Unexpected duplicate numeric migration prefixes detected:");
  for (const [prefix, owners] of unexpectedDuplicatePrefixes) console.error(`- ${prefix}: ${owners.join(", ")}`);
  process.exit(1);
}
console.log(`Verified duplicate-prefix lineage: ${duplicatePrefixes.length} grandfathered historical collisions, 0 unexpected.`);

console.log(`Verified ${files.length} migrations against canonical schema bundle (${schemaTables.size} tables).`);
