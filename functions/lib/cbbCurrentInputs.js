/** Bounded current-season reads. No PRIMARY fallback or network acquisition. */
export async function loadCbbCurrentTeamInput(env, { season, teamId } = {}) {
  if (!env?.CBB_DB) return { ok: false, reason: 'CBB_DB_UNBOUND' };
  if (!Number.isInteger(season) || !/^cbb-\d+$/.test(String(teamId))) {
    return { ok: false, reason: 'INVALID_CBB_INPUT_KEY' };
  }
  const row = await env.CBB_DB.prepare(
    'SELECT payload_json, source_sha256 FROM cbb_current_team_inputs WHERE season=? AND team_id=?'
  ).bind(season, teamId).first();
  if (!row) return { ok: false, reason: 'CURRENT_INPUT_MISSING' };
  const data = JSON.parse(row.payload_json);
  if (data.season !== season || data.teamId !== teamId) {
    return { ok: false, reason: 'CURRENT_INPUT_IDENTITY_MISMATCH' };
  }
  return { ok: true, data, sourceSha256: row.source_sha256,
    projectionReady: false, automaticWagerAuthorization: false };
}
