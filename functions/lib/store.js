/**
 * Durable research store. D1 is authoritative when bound.
 * Failures are recorded and returned — never silently ignored for callers.
 */

const health = {
  bound: false,
  lastError: null,
  lastWrite: null,
  writes: 0,
  reads: 0,
};

export function hasDb(env) {
  return Boolean(env?.DB?.prepare);
}

export function researchHealth() {
  return { ...health };
}

function markBound(env) {
  health.bound = hasDb(env);
}

function markErr(err) {
  health.lastError = String(err?.message || err);
}

function markWrite() {
  health.lastWrite = new Date().toISOString();
  health.writes += 1;
  health.lastError = null;
}

function markRead() {
  health.reads += 1;
  health.lastError = null;
}

export async function pingDb(env) {
  markBound(env);
  if (!hasDb(env)) {
    health.lastError = "D1 not bound";
    return { ok: false, reason: "unbound", ...researchHealth() };
  }
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    markRead();
    return { ok: true, ...researchHealth() };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), ...researchHealth() };
  }
}

function n(v) {
  return v == null || v === "" ? null : v;
}

export async function persistPrediction(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO predictions (
        id, game_id, sport, date, matchup, checkpoint, model_version, as_of,
        proj_home, proj_away, proj_total, proj_margin, pal_home, pal_away,
        p_home_final, p_away_final, p_market, p_espn, p_score, p_form, p_pal,
        weights_json, layers_json, pal_json, pal_as_of, lineups_official, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine, actual_home, actual_away, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        n(row.matchup),
        n(row.checkpoint),
        n(row.modelVersion),
        row.asOf,
        n(row.projHome),
        n(row.projAway),
        n(row.projTotal),
        n(row.projMargin),
        n(row.palHome),
        n(row.palAway),
        n(row.pHomeFinal),
        n(row.pAwayFinal),
        n(row.pMarket),
        n(row.pEspn),
        n(row.pScore),
        n(row.pForm),
        n(row.pPal),
        n(row.weightsJson),
        n(row.layersJson),
        n(row.palJson),
        n(row.palAsOf),
        row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0,
        n(row.dataQuality),
        n(row.pinHomeMl),
        n(row.pinAwayMl),
        n(row.pinVig),
        n(row.engine),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt)
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistSnapshot(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO prediction_snapshots (
        id, game_id, sport, date, matchup, checkpoint, model_version, frozen_at,
        proj_home, proj_away, proj_total, proj_margin, pal_home, pal_away,
        pal_f5_home, pal_f5_away, pal_p_home, pal_as_of, pal_request_id, pal_json, lineups_official,
        p_home_final, p_market, p_espn, p_score, p_form, p_pal,
        weights_json, layers_json, data_quality,
        pin_home_ml, pin_away_ml, pin_vig, engine, actual_home, actual_away, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.gameId,
        row.sport,
        row.date,
        n(row.matchup),
        row.checkpoint,
        n(row.modelVersion),
        row.frozenAt,
        n(row.projHome),
        n(row.projAway),
        n(row.projTotal),
        n(row.projMargin),
        n(row.palHome),
        n(row.palAway),
        n(row.palF5Home),
        n(row.palF5Away),
        n(row.palPHome),
        n(row.palAsOf),
        n(row.palRequestId),
        n(row.palJson),
        row.lineupsOfficial == null ? null : row.lineupsOfficial ? 1 : 0,
        n(row.pHomeFinal),
        n(row.pMarket),
        n(row.pEspn),
        n(row.pScore),
        n(row.pForm),
        n(row.pPal),
        n(row.weightsJson),
        n(row.layersJson),
        n(row.dataQuality),
        n(row.pinHomeMl),
        n(row.pinAwayMl),
        n(row.pinVig),
        n(row.engine),
        n(row.actualHome),
        n(row.actualAway),
        n(row.gradedAt)
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistOddsSnapshot(env, snap) {
  markBound(env);
  if (!hasDb(env) || !snap?.gameId) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT INTO odds_snapshots (
        game_id, sport, date, book, market, side, line, price, implied, no_vig, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        snap.gameId,
        snap.sport,
        n(snap.date),
        n(snap.book),
        n(snap.market),
        n(snap.side),
        n(snap.line),
        n(snap.price),
        n(snap.implied),
        n(snap.noVig),
        snap.capturedAt
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistGame(env, game, date) {
  markBound(env);
  if (!hasDb(env) || !game?.id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO games (id, sport, date, start, home_name, away_name, home_abbr, away_abbr, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        String(game.id),
        game.sport,
        date,
        n(game.start),
        n(game.home?.name),
        n(game.away?.name),
        n(game.home?.abbr),
        n(game.away?.abbr),
        new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistDailyMetrics(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.date) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO daily_metrics (
        date, sport, model_version, checkpoint, n, brier, log_loss, mae_total, mae_margin, winner_hit
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.date,
        row.sport,
        row.modelVersion || "",
        row.checkpoint || "LATEST",
        n(row.n),
        n(row.brier),
        n(row.logLoss),
        n(row.maeTotal),
        n(row.maeMargin),
        n(row.winnerHit)
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export function mapSnapshotRow(r) {
  if (!r) return null;
  let extra = {};
  try {
    extra = r.pal_json ? JSON.parse(r.pal_json) : {};
  } catch {
    extra = {};
  }
  const parsed = parseMatchup(r.matchup);
  return {
    id: r.game_id,
    sport: r.sport,
    date: r.date,
    matchup: r.matchup,
    checkpoint: r.checkpoint,
    modelVersion: r.model_version,
    frozenAt: r.frozen_at,
    projHome: r.proj_home,
    projAway: r.proj_away,
    projTotal: r.proj_total,
    projMargin: r.proj_margin,
    palHome: r.pal_home ?? extra.home ?? null,
    palAway: r.pal_away ?? extra.away ?? null,
    palF5Home: r.pal_f5_home ?? extra.f5Home ?? null,
    palF5Away: r.pal_f5_away ?? extra.f5Away ?? null,
    f5Home: r.pal_f5_home ?? extra.f5Home ?? null,
    f5Away: r.pal_f5_away ?? extra.f5Away ?? null,
    palPHome: r.pal_p_home ?? extra.pHome ?? null,
    palAsOf: r.pal_as_of ?? extra.asOf ?? null,
    palTotals: extra.totals || null,
    pHomeFinal: r.p_home_final,
    pHome: r.p_home_final,
    impliedHome: r.p_market,
    pMarket: r.p_market,
    pEspn: r.p_espn,
    pScore: r.p_score,
    pForm: r.p_form,
    pPal: r.p_pal ?? extra.pHome ?? null,
    dataQuality: r.data_quality,
    pinHomeMl: r.pin_home_ml,
    pinAwayMl: r.pin_away_ml,
    pinVig: r.pin_vig,
    engine: r.engine,
    actualHome: r.actual_home,
    actualAway: r.actual_away,
    actualTotal: r.actual_home != null && r.actual_away != null ? r.actual_home + r.actual_away : null,
    gradedAt: r.graded_at,
    lineupsOfficial: r.lineups_official === 1 || extra.lineupsOfficial === true,
    park: extra.park || "",
    homeSp: extra.homeSp || null,
    awaySp: extra.awaySp || null,
    homeAbbr: extra.homeAbbr || parsed.home,
    awayAbbr: extra.awayAbbr || parsed.away,
  };
}

function parseMatchup(matchup) {
  const m = String(matchup || "").match(/^([A-Z0-9]+)\s*@\s*([A-Z0-9]+)$/i);
  if (!m) return { away: null, home: null };
  return { away: m[1], home: m[2] };
}

export async function querySnapshots(env, { sport, since, until, version, checkpoint } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM prediction_snapshots WHERE date >= ?";
    const binds = [since || "2000-01-01"];
    if (until) {
      sql += " AND date <= ?";
      binds.push(until);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (version && version !== "all") {
      sql += " AND model_version = ?";
      binds.push(version);
    }
    if (checkpoint && checkpoint !== "LATEST") {
      sql += " AND checkpoint = ?";
      binds.push(checkpoint);
    }
    sql += " ORDER BY date DESC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return { ok: true, rows: (res.results || []).map(mapSnapshotRow) };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function queryPredictions(env, { sport, since, until, version } = {}) {
  markBound(env);
  if (!hasDb(env)) return { ok: false, reason: "unbound", rows: [] };
  try {
    let sql = "SELECT * FROM predictions WHERE date >= ?";
    const binds = [since || "2000-01-01"];
    if (until) {
      sql += " AND date <= ?";
      binds.push(until);
    }
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    if (version && version !== "all") {
      sql += " AND model_version = ?";
      binds.push(version);
    }
    sql += " ORDER BY date DESC";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return {
      ok: true,
      rows: (res.results || []).map((r) =>
        mapSnapshotRow({
          ...r,
          frozen_at: r.as_of,
          pal_f5_home: null,
          pal_f5_away: null,
          pal_p_home: r.p_pal,
          pal_request_id: null,
        })
      ),
    };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err), rows: [] };
  }
}

export async function queryVersions(env) {
  markBound(env);
  if (!hasDb(env)) return [];
  try {
    const a = await env.DB.prepare("SELECT DISTINCT model_version AS v FROM prediction_snapshots WHERE model_version IS NOT NULL").all();
    markRead();
    return (a.results || []).map((r) => r.v).filter(Boolean);
  } catch (err) {
    markErr(err);
    return [];
  }
}

export async function countToday(env, date) {
  markBound(env);
  if (!hasDb(env) || !date) return { predictions: 0, graded: 0 };
  try {
    const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots WHERE date = ?").bind(date).first();
    const b = await env.DB.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots WHERE date = ? AND actual_home IS NOT NULL").bind(date).first();
    markRead();
    return { predictions: Number(a?.n) || 0, graded: Number(b?.n) || 0 };
  } catch (err) {
    markErr(err);
    return { predictions: 0, graded: 0 };
  }
}
