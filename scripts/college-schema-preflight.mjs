/** Read-only schema inventory/checker. Never connects or mutates a database. */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const contract = JSON.parse(await readFile(new URL('./college-schema-contract.json', import.meta.url), 'utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
export function preflightSql() {
  return Object.keys(contract).flatMap(name => [
    `SELECT ${quote(name)} AS target, 'objects_probe' AS kind, NULL AS name, NULL AS type, NULL AS sql UNION ALL SELECT ${quote(name)}, 'objects', name, type, sql FROM sqlite_master WHERE name=${quote(name)} OR (type IN ('index','trigger') AND tbl_name=${quote(name)});`,
    `SELECT ${quote(name)} AS target, 'columns_probe' AS kind, NULL AS cid, NULL AS name, NULL AS type, NULL AS "notnull", NULL AS dflt_value, NULL AS pk UNION ALL SELECT ${quote(name)}, 'columns', * FROM pragma_table_info(${quote(name)});`,
    `SELECT ${quote(name)} AS target, 'foreign_keys_probe' AS kind, count(*) AS n FROM pragma_foreign_key_list(${quote(name)});`,
  ]).concat("SELECT 'COLLEGE_SCHEMA_PREFLIGHT_V1' AS target, 'probe' AS kind;").join('\n');
}
export function verifyInventory(rows, { post = false } = {}) {
  const missing = [], conflicts = [];
  if (!rows.some(r => r.target === 'COLLEGE_SCHEMA_PREFLIGHT_V1' && r.kind === 'probe')) {
    return { ok: false, mode: post ? 'post' : 'pre', missing: [], conflicts: ['capture-unverified'] };
  }
  for (const [name, expected] of Object.entries(contract)) {
    const own = rows.filter(r => r.target === name);
    if (!['objects_probe','columns_probe','foreign_keys_probe'].every(kind => own.some(r => r.kind === kind))) {
      conflicts.push(`${name}:capture-incomplete`); continue;
    }
    const object = own.find(r => r.kind === 'objects' && r.name === name);
    if (!object) { missing.push(name); continue; }
    if (object.type !== 'table') { conflicts.push(`${name}:not-table`); continue; }
    const columns = own.filter(r => r.kind === 'columns').map(({name,type,notnull,dflt_value,pk}) => ({name,type,notnull,dflt_value,pk}));
    if (JSON.stringify(columns) !== JSON.stringify(expected.columns)) conflicts.push(`${name}:columns`);
    // SQL definitions preserve primary-key/AUTOINCREMENT constraints not fully exposed by table_info.
    const normalize = s => String(s).replace(/IF NOT EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim().replace(/;$/, '');
    if (normalize(object.sql) !== normalize(expected.sql)) conflicts.push(`${name}:definition`);
    if (own.some(r => r.kind === 'foreign_keys_probe' && r.n !== 0)) conflicts.push(`${name}:foreign-keys`);
    if (own.some(r => r.kind === 'objects' && r.type === 'trigger')) conflicts.push(`${name}:trigger`);
    if (own.some(r => r.kind === 'objects' && r.type === 'index' && r.sql != null && !expected.indexes.some(i => i.name === r.name))) conflicts.push(`${name}:unexpected-index`);
    for (const index of expected.indexes) {
      const actual = own.find(r => r.kind === 'objects' && r.name === index.name);
      if (!actual) { if (post) conflicts.push(`${name}:missing-index:${index.name}`); }
      else if (normalize(actual.sql) !== normalize(index.sql)) conflicts.push(`${name}:index:${index.name}`);
    }
  }
  return { ok: conflicts.length === 0 && (!post || missing.length === 0), mode: post ? 'post' : 'pre', missing, conflicts };
}
function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value?.results) return flatten(value.results);
  if (value?.result) return flatten(value.result);
  return value?.target ? [value] : [];
}
function failedCapture(value) {
  if (Array.isArray(value)) return value.some(failedCapture);
  if (!value || typeof value !== 'object') return false;
  if (value.success === false || (Array.isArray(value.errors) && value.errors.length)) return true;
  return Object.values(value).some(failedCapture);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--sql')) console.log(preflightSql());
  else {
    const at = process.argv.indexOf('--input');
    if (at < 0 || !process.argv[at + 1]) throw new Error('Use --sql or --input CAPTURE.json [--post]');
    const capture = JSON.parse(await readFile(process.argv[at + 1], 'utf8'));
    const result = failedCapture(capture)
      ? { ok: false, conflicts: ['query-failed'] }
      : verifyInventory(flatten(capture), { post: process.argv.includes('--post') });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}
