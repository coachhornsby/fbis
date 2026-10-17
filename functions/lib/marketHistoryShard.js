/** Immutable, read-only market-history shard parity probe.
 * The canonical odds/market ledger and bet-evidence dependencies remain on DB.
 * This module can never promote market data or perform writes/deletes.
 */
const EXPECTED_SOURCE_DB = "b50c724c-903b-4241-8ce1-48d931e7a44c";
import {coldHistoryEnabled,coldMarketPartitions} from './coldMarketHistory.js';
const ALLOWED_SOURCES = Object.freeze(["Polymarket US", "Polymarket US WebSocket", "PinnOdds"]);
const PILOT_BATCH = "FBIS_SHARD_SHADOW_20261016_V1";
const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(String(value));
  const dig = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(dig, n => n.toString(16).padStart(2, "0")).join("");
};
const fail = (code) => { throw Error("MARKET_SHARD_" + code); };
function dbRequired(db) {
  if (!db?.prepare) fail("DATABASE_BINDING_MISSING");
  return db;
}
async function query(db, sql, ...args) {
  const statement = dbRequired(db).prepare(sql);
  const result = await (args.length ? statement.bind(...args) : statement).all();
  if (!Array.isArray(result?.results)) fail("QUERY_UNAVAILABLE");
  return result.results;
}
export async function verifyMarketHistoryShard(env, {source = null, limit = 20} = {}) {
  if (source !== null && !ALLOWED_SOURCES.includes(source)) fail("SOURCE_OUT_OF_SCOPE");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) fail("INVALID_LIMIT");
  const primary = dbRequired(env?.DB);
  const history = dbRequired(env?.MARKET_HISTORY_DB);
  const [primaryColumns, shardColumns] = await Promise.all([
    query(primary, "PRAGMA table_info(normalized_market_observations)"),
    query(history, "PRAGMA table_info(normalized_market_observations)")
  ]);
  const columns = primaryColumns.map(r => r.name);
  if (columns.length !== 50 || JSON.stringify(columns) !== JSON.stringify(shardColumns.map(r => r.name))) fail("SCHEMA_DRIFT");
  const sql = `SELECT o.*, e.source_db AS __source_db, e.source_rowid AS __source_rowid,
    e.full_row_sha256 AS __full_sha, e.source_payload_sha256 AS __raw_sha
    FROM normalized_market_observations o
    JOIN market_history_transfer_evidence e ON e.id=o.id
    WHERE e.pilot_batch=? AND (? IS NULL OR o.source=?)
    ORDER BY e.source_rowid DESC LIMIT ?`;
  const samples = await query(history, sql, PILOT_BATCH, source, source, limit);
  if (!samples.length) fail("NO_VERIFIED_SHADOW_ROWS");
  const ids = samples.map(r => r.id);
  const placeholders = ids.map(() => "?").join(",");
  const primaryRows = await query(primary,
    "SELECT * FROM normalized_market_observations WHERE id IN (" + placeholders + ")", ...ids);
  const byId = new Map(primaryRows.map(r => [r.id, r]));
  // After RESEARCH retirement, shadow samples may live only on cold. Prefer the
  // dual-read gate when enabled; otherwise still consult a bound cold DB so
  // operator parity probes do not 503 solely because primary deleted frozen rows.
  if(byId.size!==samples.length&&env?.COLD_HISTORY_DB?.prepare){
    if(coldHistoryEnabled(env)) await coldMarketPartitions(env);
    const missing=ids.filter(id=>!byId.has(id));
    const archived=await query(env.COLD_HISTORY_DB,"SELECT * FROM normalized_market_observations WHERE snapshot_type='RESEARCH' AND id IN ("+missing.map(()=>"?").join(',')+")",...missing);
    for(const row of archived)byId.set(row.id,row);
  }
  if (byId.size !== samples.length) fail("MISSING_PRODUCTION_ROWS");
  const sources = new Set();
  for (const row of samples) {
    if (row.__source_db !== EXPECTED_SOURCE_DB || !ALLOWED_SOURCES.includes(row.source)) fail("INVALID_PROVENANCE");
    const master = byId.get(row.id);
    if (!master || master.source !== row.source) fail("SOURCE_IDENTITY_MISMATCH");
    const shardDigest = await sha256(JSON.stringify(columns.map(k => row[k])));
    const mainDigest = await sha256(JSON.stringify(columns.map(k => master[k])));
    const rawDigest = await sha256(row.raw_payload_json || "");
    if (shardDigest !== row.__full_sha || mainDigest !== row.__full_sha ||
      rawDigest !== row.__raw_sha) fail("CONTENT_HASH_PARITY_FAILED");
    if (Number(row.can_authorize_wager) !== 0 || Number(row.can_qualify) !== 0 ||
      Number(master.can_authorize_wager) !== 0 || Number(master.can_qualify) !== 0) fail("AUTHORITY_ESCALATION");
    sources.add(row.source);
  }
  return {
    state: "SHADOW_COPY_VERIFIED",
    verified: samples.length, sources: [...sources].sort(),
    columnsVerified: columns.length, sourceDb: "PRIMARY_D1", shardDb: "MARKET_HISTORY_DB",
    pilotBatch: PILOT_BATCH, readOnly: true, canQualify: false, canAuthorizeWager: false,
    liveReadsRerouted: false, liveWritesRerouted: false, productionRowsDeleted: 0
  };
}
