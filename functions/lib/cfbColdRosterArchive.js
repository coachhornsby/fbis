/** Private, read-only CFB roster cold-archive reader.
 * Full-season release evidence was reconciled independently with D1 on 2026-10-15.
 * This module cannot write D1, redirect current cards, or authorize a wager.
 */
const ARCHIVE_ROOT = "research/storage-recovery/cfb-roster-cold-pilot/";
const PROD_DB = "b50c724c-903b-4241-8ce1-48d931e7a44c";
const PROVEN_SEASONS = Object.freeze({
  2004: ARCHIVE_ROOT + "2004/full-season-manifest-675ad4a9f3cb17a87f09acc577bd40f2e2f8e7e4ea59bf501df14b48b063aa8c.json",
});
const HEX = /^[0-9a-f]{64}$/;
const DIGEST_KEY = /-([0-9a-f]{64})\.json$/;
const ENCODER = new TextEncoder();

function required(condition, reason) {
  if (!condition) throw Error("CFB_ARCHIVE_" + reason);
}
function number(value, min, max) {
  const n = Number(value);
  required(Number.isSafeInteger(n) && n >= min && n <= max, "INVALID_NUMBER");
  return n;
}
async function sha256(text) {
  const bytes = ENCODER.encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (n) => n.toString(16).padStart(2, "0")).join("");
}
function digestInKey(key) {
  const match = String(key || "").match(DIGEST_KEY);
  required(!!match && HEX.test(match[1]), "INVALID_KEY_DIGEST");
  return match[1];
}
async function verifiedObject(env, key, maxBytes) {
  required(env?.ARCHIVE?.get, "R2_NOT_BOUND");
  required(typeof key === "string" && key.startsWith(ARCHIVE_ROOT), "KEY_OUT_OF_SCOPE");
  const object = await env.ARCHIVE.get(key);
  required(object && typeof object.text === "function", "OBJECT_NOT_FOUND");
  required(Number(object.size) <= maxBytes, "OBJECT_OVERSIZE");
  const raw = await object.text();
  required(ENCODER.encode(raw).byteLength <= maxBytes, "OBJECT_BYTES_OVERSIZE");
  required((await sha256(raw)) === digestInKey(key), "SHA256_MISMATCH");
  try { return JSON.parse(raw); } catch { throw Error("CFB_ARCHIVE_INVALID_JSON"); }
}
function verifiedManifest(manifest, season) {
  required(manifest?.format === "fbis-cfb-roster-full-season-v1" &&
    manifest.sourceDatabaseId === PROD_DB &&
    manifest.sourceTable === "cfb_roster_observations" &&
    manifest.season === season &&
    manifest.readbackSha256Verified === true &&
    manifest.independentD1RecordParity === true &&
    manifest.stableSourceBounds === true &&
    manifest.modelAuthority === false &&
    manifest.canInfluenceProjection === false &&
    manifest.canQualify === false &&
    manifest.canAuthorizeWager === false &&
    manifest.sourceRowsDeleted === 0 &&
    manifest.retentionReleaseAuthorized === false, "MANIFEST_NOT_QUALIFIED");
  const count = number(manifest.archivedRows, 1, 1000000);
  required(count === number(manifest.sourceSeasonTotal, 1, 1000000), "SEASON_COUNT_MISMATCH");
  const upper = number(manifest.sourceUpperRowid, 1, Number.MAX_SAFE_INTEGER);
  const min = number(manifest.sourceFirstRowid, 1, upper);
  const segments = manifest.segments;
  required(Array.isArray(segments) && segments.length > 0 && segments.length <= 20000, "SEGMENTS_UNAVAILABLE");
  let last = 0, total = 0;
  for (const segment of segments) {
    const a = number(segment.firstRowid, 1, upper);
    const b = number(segment.lastRowid, a, upper);
    required(a > last, "SEGMENT_OVERLAP_OR_REORDER");
    const key = segment.key;
    required(typeof key === "string" && key.startsWith(ARCHIVE_ROOT + season + "/"), "SEGMENT_KEY_OUT_OF_SCOPE");
    required(new RegExp("/part-" + a + "-" + b + "-[a-f0-9]{64}\\.json$").test(key), "SEGMENT_KEY_BOUNDARY_MISMATCH");
    required(segment.sha256 === digestInKey(key), "SEGMENT_SHA_REFERENCE_MISMATCH");
    number(segment.bytes, 1, 2 * 1024 * 1024);
    const n = number(segment.count, 1, 100);
    required(n <= b - a + 1, "SEGMENT_ROW_COUNT_OUT_OF_RANGE");
    last = b; total += n;
  }
  required(total === count && number(segments[0].firstRowid, 1, upper) === min && last === upper, "MANIFEST_INCOMPLETE_COVERAGE");
  return manifest;
}
function validateSegment(doc, segment, season, upper) {
  required(doc?.format === "fbis-cold-roster-pilot-v1" &&
    doc.sourceDb === PROD_DB && doc.table === "cfb_roster_observations" &&
    doc.season === season && String(doc.frozenUpperRowid) === String(upper) &&
    String(doc.firstRowid) === String(segment.firstRowid) &&
    String(doc.lastRowid) === String(segment.lastRowid) &&
    doc.count === segment.count &&
    Array.isArray(doc.rows) && doc.rows.length === segment.count, "SEGMENT_CONTENT_SCOPE");
  let last = Number(segment.firstRowid) - 1;
  for (const row of doc.rows) {
    const id = number(row.__archive_rowid, last + 1, Number(segment.lastRowid));
    required(row.season === season && typeof row.id === "string" && row.id.length > 0 &&
      typeof row.content_hash === "string" && HEX.test(row.content_hash), "ROW_PROVENANCE");
    last = id;
  }
  required(Number(doc.rows[0].__archive_rowid) === Number(segment.firstRowid) &&
    last === Number(segment.lastRowid), "ROW_BOUNDARY_MISMATCH");
  return doc.rows;
}
/** Internal only: manifestKey override is for offline tests; never forward user input to it. */
export async function loadVerifiedCfbColdRosterManifest(env, season = 2004, manifestKey = null) {
  const year = number(season, 2004, 2024);
  const key = manifestKey || PROVEN_SEASONS[year];
  required(!!key, "SEASON_NOT_VERIFIED");
  required(String(key).startsWith(ARCHIVE_ROOT + year + "/full-season-manifest-"), "MANIFEST_KEY_OUT_OF_SCOPE");
  const doc = await verifiedObject(env, key, 1024 * 1024);
  return verifiedManifest(doc, year);
}
/** Bounded, private source-record readback. No public route or model fallback. */
export async function readVerifiedCfbColdRosterPage(env, {season = 2004, afterRowid = 0, limit = 100, manifestKey = null} = {}) {
  const year = number(season, 2004, 2024);
  const cursor = number(afterRowid, 0, Number.MAX_SAFE_INTEGER);
  const cap = number(limit, 1, 100);
  const manifest = await loadVerifiedCfbColdRosterManifest(env, year, manifestKey);
  const rows = [];
  let lastRowid = cursor, objectsRead = 0;
  for (const seg of manifest.segments) {
    if (Number(seg.lastRowid) <= cursor) continue;
    const doc = await verifiedObject(env, seg.key, Number(seg.bytes));
    const source = validateSegment(doc, seg, year, manifest.sourceUpperRowid);
    objectsRead++;
    for (const item of source) {
      if (Number(item.__archive_rowid) <= cursor) continue;
      rows.push(item);
      lastRowid = Number(item.__archive_rowid);
      if (rows.length === cap) break;
    }
    if (rows.length === cap) break;
    required(objectsRead < 3, "PAGE_READ_BOUND_EXCEEDED");
  }
  return {
    state: "VERIFIED_RETROSPECTIVE_R2_ARCHIVE",
    season: year, rows, count: rows.length, afterRowid: String(cursor),
    nextRowid: rows.length ? String(lastRowid) : null,
    hasMore: rows.length > 0 && manifest.segments.some(s => Number(s.lastRowid) > lastRowid),
    sourceRecordCount: manifest.sourceSeasonTotal,
    source: "FBIS_VERIFIED_CFB_ROSTER_ARCHIVE",
    retrospective: true, researchOnly: true,
    canInfluenceProjection: false, canQualify: false, canAuthorizeWager: false,
    productionD1Reads: 0, productionD1Writes: 0,
  };
}
