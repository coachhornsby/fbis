import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const failures = [];
const slate = readFileSync("functions/api/slate.js", "utf8");
if (/freezeSlate|harvestSport|waitUntil/.test(slate)) failures.push("slate GET crossed the read/write boundary");
const migrations = readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort();
for (let i = 0; i < migrations.length; i++) {
  const expected = String(i + 1).padStart(4, "0");
  if (!migrations[i].startsWith(expected)) failures.push(`migration sequence gap at ${migrations[i]}`);
}
const schema = readFileSync("schema.sql", "utf8");
for (const table of ["job_runs", "prediction_snapshots", "executed_bets", "model_predictions", "pipeline_stage_runs", "accuracy_daily_summary"])
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`).test(schema)) failures.push(`schema missing ${table}`);
const sizeBudgets = {
  "functions/lib/projLedger.js": 90000,
  "functions/lib/store.js": 85000,
  "functions/lib/slateEngine.js": 55000,
  "src/App.jsx": 45000,
};
for (const [file, max] of Object.entries(sizeBudgets)) if (statSync(file).size > max) failures.push(`${file} exceeds boundary budget ${max}`);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
for (const file of [...walk("functions"), ...walk("src"), ...walk("scripts")].filter((x) => /\.(js|jsx|mjs)$/.test(x))) {
  if (file.endsWith("verify-repo.mjs")) continue;
  const text = readFileSync(file, "utf8");
  if (/bpp_live_|Bearer\s+[A-Za-z0-9_-]{20,}/.test(text)) failures.push(`credential-shaped literal in ${file}`);
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`repository safeguards passed (${migrations.length} migrations)`);
