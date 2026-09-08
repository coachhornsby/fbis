function asRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function insertPublishedProjection(env, row) {
  if (!env?.DB) throw new Error("d1-unavailable");
  const existing = await env.DB.prepare(
    `SELECT id, payload_hash, payload_json, published_at
       FROM published_projections
      WHERE sport = ?1 AND game_id = ?2 AND model_version IS ?3
      LIMIT 1`
  ).bind(row.sport, row.gameId, row.modelVersion ?? null).first();

  if (existing) {
    if (existing.payload_hash !== row.payloadHash) {
      return { ok: false, conflict: true, reason: "immutable-published-projection-conflict", existing };
    }
    return { ok: true, inserted: false, existing };
  }

  const result = await env.DB.prepare(
    `INSERT INTO published_projections
      (sport, game_id, game_date, start_time, model_version, payload_hash, payload_json, published_at, published_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    row.sport,
    row.gameId,
    row.gameDate,
    row.startTime ?? null,
    row.modelVersion ?? null,
    row.payloadHash,
    row.payloadJson,
    row.publishedAt,
    row.publishedBy || "operator"
  ).run();
  return { ok: true, inserted: true, id: result?.meta?.last_row_id ?? null };
}

export async function listPublishedProjections(env, { sport = null, date = null, limit = 100 } = {}) {
  if (!env?.DB) throw new Error("d1-unavailable");
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const clauses = [];
  const binds = [];
  if (sport) { clauses.push(`sport = ?${binds.length + 1}`); binds.push(String(sport).toLowerCase()); }
  if (date) { clauses.push(`game_date = ?${binds.length + 1}`); binds.push(String(date)); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `SELECT sport, game_id, game_date, start_time, model_version, payload_hash, payload_json, published_at
                 FROM published_projections ${where}
                ORDER BY published_at DESC
                LIMIT ${safeLimit}`;
  const stmt = env.DB.prepare(sql);
  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all();
  return asRows(result).map((row) => ({
    sport: row.sport,
    gameId: row.game_id,
    gameDate: row.game_date,
    startTime: row.start_time,
    modelVersion: row.model_version,
    payloadHash: row.payload_hash,
    publishedAt: row.published_at,
    projection: JSON.parse(row.payload_json),
  }));
}
