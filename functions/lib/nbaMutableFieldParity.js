/**
 * NBA-only read-only source-field audit for mutable research owners.
 * Prevents equal-count prefix tables from qualifying while old in-place
 * data is still present on NBA_DB. Does not activate sport authority.
 */
export const NBA_MUTABLE_FIELD_TABLES = Object.freeze([
  ["nba_observation_health", "path_key"],
  ["nba_player_state_profiles", "player_id"],
  ["nba_team_profiles", "team_id"],
  ["nba_team_schedule_items", "id"],
  ["nba_wager_decisions", "id"],
  ["nba_player_prop_projections", "id"],
  ["nba_player_prop_impact_shadow", "id"],
  ["nba_prospective_game_shadow", "id"],
  ["nba_deep_game_shadow", "id"],
]);

function idOf(row, key) { return String(row?.[key] ?? ""); }

function sourceFieldsMatch(source, target) {
  if (!target) return { ok: false, fields: ["MISSING"] };
  const fields = Object.keys(source).filter(k =>
    JSON.stringify(source[k] ?? null) !== JSON.stringify(target[k] ?? null));
  return { ok: fields.length === 0, fields };
}

export async function verifyNbaMutableFieldParity(env, { sampleSize = 10 } = {}) {
  const primary = env?.DB;
  const shard = env?.NBA_DB;
  if (!primary?.prepare || !shard?.prepare) {
    return { ok: false, reason: "NBA_MUTABLE_FIELD_DB_UNBOUND",
      cutoverAuthorized: false, canAuthorizeWager: false };
  }
  const limit = Math.min(20, Math.max(5, Number(sampleSize) || 10));
  const tables = [];
  const mismatches = [];
  try {
    for (const [table, key] of NBA_MUTABLE_FIELD_TABLES) {
      const sourceMap = new Map();
      const targetMap = new Map();
      for (const dir of ["ASC", "DESC"]) {
        const sql = `SELECT * FROM ${table} ORDER BY ${key} ${dir} LIMIT ?`;
        const [source, target] = await Promise.all([
          primary.prepare(sql).bind(limit).all(),
          shard.prepare(sql).bind(limit).all(),
        ]);
        for (const row of source?.results || []) sourceMap.set(idOf(row, key), row);
        for (const row of target?.results || []) targetMap.set(idOf(row, key), row);
      }
      let divergent = 0;
      for (const [id, row] of sourceMap) {
        const diff = sourceFieldsMatch(row, targetMap.get(id));
        if (diff.ok) continue;
        divergent += 1;
        if (mismatches.length < 20) {
          mismatches.push({ table, id, fields: diff.fields.slice(0, 12) });
        }
      }
      tables.push({ table, sampled: sourceMap.size, divergent,
        status: divergent === 0 ? "MATCH" : "DIVERGED" });
    }
    const ok = tables.every(t => t.divergent === 0);
    return {
      ok, sport: "nba",
      contract: "fbis-nba-mutable-prefix-fields-v1",
      status: ok ? "SAMPLED_FIELD_PARITY_OK" : "SAMPLED_FIELD_PARITY_INCOMPLETE",
      sampleLimitPerEnd: limit,
      tables, mismatches,
      cutoverAuthorized: false, canAuthorizeWager: false,
    };
  } catch (error) {
    return {
      ok: false, sport: "nba", status: "SAMPLED_FIELD_PARITY_ERROR",
      reason: String(error?.message || error).slice(0, 200),
      tables, mismatches,
      cutoverAuthorized: false, canAuthorizeWager: false,
    };
  }
}
