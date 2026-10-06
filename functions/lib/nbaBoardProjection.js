/**
 * Hydrate the latest frozen NBA-FBIS-v1 research projection from D1 onto
 * today's slate games. Read-only; no market data is introduced into the model.
 */
function parseJson(value) {
  if (!value) return {};
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return {}; }
}

export async function attachNbaBoardProjection(games = [], db = null) {
  if (!db || !Array.isArray(games) || !games.length) {
    return { games, meta: { available: 0, requested: games?.length || 0, source: "nba_game_projections" } };
  }
  const ids = [...new Set(games.map((g) => String(g?.id || "")).filter(Boolean))];
  if (!ids.length) return { games, meta: { available: 0, requested: 0, source: "nba_game_projections" } };

  try {
    const placeholders = ids.map(() => "?").join(",");
    const sql = `SELECT game_id, model_id, model_version, feature_cutoff_timestamp,
      projected_home, projected_away, projected_margin, projected_total,
      expected_possessions, p_home_win, sigma_margin, sigma_total,
      maturity, can_qualify, can_authorize, provenance_json, created_at
      FROM nba_game_projections
      WHERE game_id IN (${placeholders})
      ORDER BY created_at DESC`;
    const res = await db.prepare(sql).bind(...ids).all();
    const latest = new Map();
    for (const row of res?.results || []) {
      const id = String(row?.game_id || "");
      if (!id || latest.has(id)) continue;
      const provenance = parseJson(row.provenance_json);
      latest.set(id, {
        ok: true,
        modelId: row.model_id || "NBA-FBIS-v1",
        modelVersion: row.model_version || null,
        home: row.projected_home == null ? null : Number(row.projected_home),
        away: row.projected_away == null ? null : Number(row.projected_away),
        margin: row.projected_margin == null ? null : Number(row.projected_margin),
        total: row.projected_total == null ? null : Number(row.projected_total),
        expectedPossessions: row.expected_possessions == null ? null : Number(row.expected_possessions),
        pHomeWin: row.p_home_win == null ? null : Number(row.p_home_win),
        sigmaMargin: row.sigma_margin == null ? null : Number(row.sigma_margin),
        sigmaTotal: row.sigma_total == null ? null : Number(row.sigma_total),
        maturity: row.maturity || "VALIDATION",
        canQualify: Number(row.can_qualify) === 1,
        canAuthorize: Number(row.can_authorize) === 1,
        featureCutoff: row.feature_cutoff_timestamp || null,
        createdAt: row.created_at || null,
        decomposition: provenance?.decomposition || null,
        provenance: {
          ...provenance,
          marketUsed: false,
          sourceTable: "nba_game_projections",
        },
      });
    }
    let available = 0;
    const next = games.map((game) => {
      const p = latest.get(String(game?.id || ""));
      if (!p) return game;
      available += 1;
      return { ...game, nbaFbisV1: p };
    });
    return { games: next, meta: { available, requested: ids.length, source: "nba_game_projections", marketInformed: false } };
  } catch (err) {
    return { games, meta: { available: 0, requested: ids.length, source: "nba_game_projections", error: String(err?.message || err) } };
  }
}
