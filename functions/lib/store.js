/**
 * Durable research store. D1 when bound, otherwise a no-op.
 * Cloudflare Cache is not a research database.
 */

export function hasDb(env) {
  return Boolean(env?.DB?.prepare);
}

export async function persistPrediction(env, row) {
  if (!hasDb(env) || !row?.id) return;
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO predictions (
        id, game_id, sport, date, model_version, as_of,
        proj_home, proj_away, proj_total, proj_margin,
        p_home_final, p_away_final, p_market, p_espn, p_score, p_form,
        weights_json, layers_json, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine,
        actual_home, actual_away, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        row.modelVersion,
        row.asOf,
        row.projHome,
        row.projAway,
        row.projTotal,
        row.projMargin,
        row.pHomeFinal,
        row.pAwayFinal,
        row.pMarket,
        row.pEspn,
        row.pScore,
        row.pForm,
        row.weightsJson,
        row.layersJson,
        row.dataQuality,
        row.pinHomeMl,
        row.pinAwayMl,
        row.pinVig,
        row.engine,
        row.actualHome,
        row.actualAway,
        row.gradedAt
      )
      .run();
  } catch {
    /* D1 optional until the binding exists */
  }
}

export async function persistOddsSnapshot(env, snap) {
  if (!hasDb(env) || !snap?.gameId) return;
  try {
    await env.DB.prepare(
      `INSERT INTO odds_snapshots (
        game_id, sport, date, book, market, side, line, price, implied, no_vig, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        snap.gameId,
        snap.sport,
        snap.date,
        snap.book,
        snap.market,
        snap.side,
        snap.line,
        snap.price,
        snap.implied,
        snap.noVig,
        snap.capturedAt
      )
      .run();
  } catch {
    /* D1 optional until the binding exists */
  }
}

export async function persistGame(env, game, date) {
  if (!hasDb(env) || !game?.id) return;
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO games (id, sport, date, start, home_name, away_name, home_abbr, away_abbr, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(game.id),
        game.sport,
        date,
        game.start || null,
        game.home?.name || null,
        game.away?.name || null,
        game.home?.abbr || null,
        game.away?.abbr || null,
        new Date().toISOString()
      )
      .run();
  } catch {
    /* D1 optional */
  }
}
