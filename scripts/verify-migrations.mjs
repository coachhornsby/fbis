import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const migrationsDir = join(root, "migrations");
const schemaPath = join(root, "schema.sql");

function extractCreateTables(sql) {
  const out = new Set();
  const re = /CREATE TABLE IF NOT EXISTS\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let m;
  while ((m = re.exec(sql))) out.add(m[1]);
  return out;
}

const schema = await readFile(schemaPath, "utf8");
const schemaTables = extractCreateTables(schema);
const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
const missing = [];
for (const file of files) {
  const body = await readFile(join(migrationsDir, file), "utf8");
  const tables = [...extractCreateTables(body)];
  for (const t of tables) {
    if (!schemaTables.has(t)) missing.push({ file, table: t });
  }
}

if (missing.length) {
  console.error("Schema is missing tables introduced by migrations:");
  for (const m of missing) console.error(`- ${m.file}: ${m.table}`);
  process.exit(1);
}

console.log(`Verified ${files.length} migrations against schema.sql (${schemaTables.size} tables).`);
