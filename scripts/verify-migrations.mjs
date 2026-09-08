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
for (const file of files) {
  const body = await readFile(join(migrationsDir, file), "utf8");
  const tables = [...extractCreateTables(body)];
  for (const t of tables) {
    if (!schemaTables.has(t)) missing.push({ file, table: t });
  }
  const id = file.replace(/\.sql$/, "");
  if (file === files.at(-1) && !new RegExp(`schema_migrations[\\s\\S]*['\"]${id}['\"]`, "i").test(body)) {
    registrationFailures.push({ file, id });
  }
}

if (missing.length) {
  console.error("Canonical schema bundle is missing tables introduced by migrations:");
  for (const m of missing) console.error(`- ${m.file}: ${m.table}`);
  process.exit(1);
}

if (registrationFailures.length) {
  console.error("Latest migration does not register itself in schema_migrations:");
  for (const m of registrationFailures) console.error(`- ${m.file}: expected ${m.id}`);
  process.exit(1);
}

console.log(`Verified ${files.length} migrations against canonical schema bundle (${schemaTables.size} tables).`);
