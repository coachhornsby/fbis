/**
 * Hydrate the latest frozen NBA-FBIS-v1 research projection from D1 onto
 * today's slate games. Read-only; no market data is introduced into the model.
 */
function parseJson(value) {
  if (!value) return {};
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return {}; }
}

const MISSING_V1 = "NBA_FBIS_V1_PROJECTION_MISSING";

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
    const missing = [];
    const next = games.map((game) => {
      const id = String(game?.id || "");
      const p = latest.get(id);
      if (!p) {
        if (id) missing.push(id);
        return {
          ...game,
          nbaProjectionBlocker: {
            code: MISSING_V1,
            reason: "No NBA-FBIS-v1 row in nba_game_projections for this event",
            canAuthorize: false,
            marketDerived: false,
          },
        };
      }
      available += 1;
      // Prefer calibrated NBA-FBIS-v1 for board scores when a temporally valid row
      // exists. FORM remains under challengers. Wager authority stays false.
      const formChallenger = game.researchProjection?.modelId === "NBA-FBIS-FORM-v1"
        ? game.researchProjection
        : null;
      return {
        ...game,
        nbaFbisV1: p,
        nbaProjectionBlocker: null,
        projHomeScore: p.home,
        projAwayScore: p.away,
        projectionKind: "FBIS",
        projectionEngine: p.modelId,
        projectionMaturity: p.maturity || "VALIDATION",
        projectionDisplayLabel: "NBA FBIS v1 RESEARCH PROJECTION",
        pureProjectionAvailable: true,
        qualificationBlocked: true,
        canQualify: false,
        canAuthorizeWager: false,
        publicationStatus: "RESEARCH_PUBLISHABLE",
        bettingAuthority: "NOT_ELIGIBLE",
        modelVersion: p.modelVersion,
        model: {
          ...(game.model || {}),
          projHome: p.home,
          projAway: p.away,
          projMargin: p.margin,
          projTotal: p.total,
          pHomeFinal: p.pHomeWin,
          pHome: p.pHomeWin,
          projectionKind: "FBIS",
          maturity: p.maturity || "VALIDATION",
          canQualify: false,
          canAuthorize: false,
          canShowCalibratedEv: false,
          recipe: {
            engine: p.modelId,
            version: p.modelVersion,
            family: "research",
            steps: [
              "independent possession/efficiency projection",
              "frozen calibration",
              "D1 nba_game_projections hydrate",
              "Research only — no wager authority",
            ],
          },
        },
        researchProjection: {
          modelId: p.modelId,
          modelVersion: p.modelVersion,
          maturity: p.maturity || "VALIDATION",
          home: p.home,
          away: p.away,
          margin: p.margin,
          total: p.total,
          expectedPossessions: p.expectedPossessions,
          pHomeWin: p.pHomeWin,
          note: "Independent NBA-FBIS-v1 projection from nba_game_projections. Markets are evaluation-only.",
          canQualify: false,
          canAuthorize: false,
          marketUsed: false,
          featureCutoff: p.featureCutoff,
          createdAt: p.createdAt,
        },
        challengers: {
          ...(game.challengers || {}),
          ...(formChallenger ? { "NBA-FBIS-FORM-v1": formChallenger } : {}),
          [p.modelId]: p,
        },
      };
    });
    return {
      games: next,
      meta: {
        available,
        requested: ids.length,
        missing: missing.length,
        missingGameIds: missing.slice(0, 24),
        source: "nba_game_projections",
        marketInformed: false,
        canAuthorizeWager: false,
      },
    };
  } catch (err) {
    return { games, meta: { available: 0, requested: ids.length, source: "nba_game_projections", error: String(err?.message || err) } };
  }
}
