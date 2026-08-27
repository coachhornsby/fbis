/**
 * Durable research store. D1 is authoritative when bound.
 * Failures are recorded and returned — never silently ignored for callers.
 */

const health = {
  bound: false,
  lastError: null,
  lastWrite: null,
  lastCollect: null,
  lastHarvest: null,
  writes: 0,
  reads: 0,
  failedWrites: 0,
  failedHarvests: 0,
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

function markErr(err, kind = "write") {
  health.lastError = String(err?.message || err);
  if (kind === "harvest") health.failedHarvests += 1;
  else health.failedWrites += 1;
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

function layersWithSnap(row) {
  let layers = {};
  try {
    layers = row.layersJson ? JSON.parse(row.layersJson) : {};
  } catch {
    layers = {};
  }
  layers._snap = {
    ...(layers._snap || {}),
    season: row.season ?? null,
    start: row.start ?? null,
    pinSpread: row.pinSpread ?? null,
    pinTotal: row.pinTotal ?? null,
    noVigHome: row.noVigHome ?? null,
    noVigAway: row.noVigAway ?? null,
    noVigOver: row.noVigOver ?? null,
    noVigUnder: row.noVigUnder ?? null,
    pOver: row.pOver ?? null,
    pSpreadHome: row.pSpreadHome ?? null,
    uncertainty: row.uncertainty ?? null,
    marketAt: row.marketAt ?? null,
    gameStatus: row.gameStatus ?? null,
    week: row.week ?? null,
    conference: row.conference ?? null,
    pAwayFinal: row.pAwayFinal ?? null,
  };
  return JSON.stringify(layers);
}

export async function persistSnapshot(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: hasDb(env) ? "no-id" : "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO prediction_snapshots (
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
        layersWithSnap(row),
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
    if (row.actualHome != null || row.gameStatus) {
      await gradeSnapshot(env, row);
    }
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

/** Attach finals only. Never rewrite frozen projection fields. */
export async function gradeSnapshot(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "unbound" };
  if (row.actualHome == null && !row.gameStatus) return { ok: false, reason: "no-final" };
  try {
    await env.DB.prepare(
      `UPDATE prediction_snapshots
       SET actual_home = COALESCE(actual_home, ?),
           actual_away = COALESCE(actual_away, ?),
           graded_at = COALESCE(graded_at, ?)
       WHERE id = ? AND actual_home IS NULL`
    )
      .bind(n(row.actualHome), n(row.actualAway), n(row.gradedAt || new Date().toISOString()), row.id)
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
  let layers = {};
  try {
    extra = r.pal_json ? JSON.parse(r.pal_json) : {};
  } catch {
    extra = {};
  }
  try {
    layers = r.layers_json ? JSON.parse(r.layers_json) : {};
  } catch {
    layers = {};
  }
  const snap = layers._snap || {};
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
    palRunLine: extra.runLine || extra.runLines || null,
    palPark: extra.park || extra.parkFactors || null,
    pHomeFinal: r.p_home_final,
    pHome: r.p_home_final,
    pAwayFinal: snap.pAwayFinal ?? (r.p_home_final != null ? 1 - r.p_home_final : null),
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
    pinSpread: snap.pinSpread ?? null,
    pinTotal: snap.pinTotal ?? extra.pinTotal ?? null,
    noVigHome: snap.noVigHome ?? null,
    noVigAway: snap.noVigAway ?? null,
    noVigOver: snap.noVigOver ?? null,
    noVigUnder: snap.noVigUnder ?? null,
    pOver: snap.pOver ?? null,
    pSpreadHome: snap.pSpreadHome ?? null,
    uncertainty: snap.uncertainty ?? null,
    marketAt: snap.marketAt ?? r.frozen_at,
    gameStatus: snap.gameStatus ?? (r.actual_home != null ? "FINAL" : "OPEN"),
    week: snap.week ?? extra.week ?? null,
    conference: snap.conference ?? extra.conference ?? null,
    season: snap.season ?? extra.season ?? null,
    start: snap.start ?? extra.start ?? null,
    engine: r.engine,
    actualHome: r.actual_home,
    actualAway: r.actual_away,
    actualTotal: r.actual_home != null && r.actual_away != null ? r.actual_home + r.actual_away : null,
    gradedAt: r.graded_at,
    lineupsOfficial: r.lineups_official === 1 || extra.lineupsOfficial === true,
    park: extra.park || extra.parkName || "",
    homeSp: extra.homeSp || null,
    awaySp: extra.awaySp || null,
    homeAbbr: extra.homeAbbr || parsed.home,
    awayAbbr: extra.awayAbbr || parsed.away,
    homeName: extra.homeName || null,
    awayName: extra.awayName || null,
    layers,
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
  if (!hasDb(env) || !date) {
    return { predictions: 0, graded: 0, awaiting: 0, failedWrites: health.failedWrites, failedHarvests: health.failedHarvests };
  }
  try {
    const a = await env.DB.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots WHERE date = ?").bind(date).first();
    const b = await env.DB.prepare("SELECT COUNT(*) AS n FROM prediction_snapshots WHERE date = ? AND actual_home IS NOT NULL").bind(date).first();
    const c = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM prediction_snapshots WHERE actual_home IS NULL AND date <= ? AND date >= date(?, '-14 days')"
    )
      .bind(date, date)
      .first();
    markRead();
    const meta = await readMeta(env);
    return {
      predictions: Number(a?.n) || 0,
      graded: Number(b?.n) || 0,
      awaiting: Number(c?.n) || 0,
      failedWrites: health.failedWrites,
      failedHarvests: health.failedHarvests,
      lastCollect: meta.last_collect_at || health.lastCollect,
      lastHarvest: meta.last_harvest_at || health.lastHarvest,
      lastWrite: meta.last_write_at || health.lastWrite,
    };
  } catch (err) {
    markErr(err);
    return {
      predictions: 0,
      graded: 0,
      awaiting: 0,
      failedWrites: health.failedWrites,
      failedHarvests: health.failedHarvests,
    };
  }
}

export async function setMeta(env, k, v) {
  markBound(env);
  if (k === "last_collect_at") health.lastCollect = v;
  if (k === "last_harvest_at") health.lastHarvest = v;
  if (k === "last_write_at") health.lastWrite = v;
  if (!hasDb(env) || !k) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare("INSERT OR REPLACE INTO store_meta (k, v) VALUES (?, ?)").bind(k, String(v)).run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function readMeta(env) {
  markBound(env);
  if (!hasDb(env)) return {};
  try {
    const res = await env.DB.prepare("SELECT k, v FROM store_meta").all();
    markRead();
    const out = {};
    for (const row of res.results || []) out[row.k] = row.v;
    return out;
  } catch (err) {
    markErr(err);
    return {};
  }
}

function formKey(team) {
  if (team?.espnId) return `id:${team.espnId}`;
  if (team?.abbr) return `abbr:${String(team.abbr).toUpperCase()}`;
  return `name:${String(team?.name || "").toLowerCase()}`;
}

export async function loadTeamForm(env, sport, season) {
  const map = new Map();
  markBound(env);
  if (!hasDb(env)) return map;
  try {
    const res = await env.DB.prepare("SELECT * FROM team_form WHERE sport = ? AND season = ?")
      .bind(sport, Number(season))
      .all();
    markRead();
    for (const r of res.results || []) {
      const row = {
        teamKey: r.team_key,
        games: Number(r.games) || 0,
        pointsFor: Number(r.points_for) || 0,
        pointsAgainst: Number(r.points_against) || 0,
      };
      map.set(r.team_key, row);
    }
    return map;
  } catch (err) {
    markErr(err);
    return map;
  }
}

export async function upsertTeamForm(env, { sport, season, team, pointsFor, pointsAgainst }) {
  markBound(env);
  if (!hasDb(env) || !team) return { ok: false, reason: "unbound" };
  const key = formKey(team);
  try {
    await env.DB.prepare(
      `INSERT INTO team_form (sport, season, team_key, games, points_for, points_against, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(sport, season, team_key) DO UPDATE SET
         games = games + 1,
         points_for = points_for + excluded.points_for,
         points_against = points_against + excluded.points_against,
         updated_at = excluded.updated_at`
    )
      .bind(sport, Number(season), key, Number(pointsFor), Number(pointsAgainst), new Date().toISOString())
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function applyFinalToForm(env, { sport, season, gameId, date, home, away, homeScore, awayScore }) {
  markBound(env);
  if (!hasDb(env) || !gameId) return { ok: false, reason: "unbound" };
  if (homeScore == null || awayScore == null) return { ok: false, reason: "no-score" };
  try {
    const ins = await env.DB.prepare(
      "INSERT OR IGNORE INTO team_form_games (sport, game_id, date) VALUES (?, ?, ?)"
    )
      .bind(sport, String(gameId), date || null)
      .run();
    if (!ins?.meta?.changes) return { ok: true, skipped: true };
    await upsertTeamForm(env, { sport, season, team: home, pointsFor: homeScore, pointsAgainst: awayScore });
    await upsertTeamForm(env, { sport, season, team: away, pointsFor: awayScore, pointsAgainst: homeScore });
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function persistDailyReport(env, report) {
  markBound(env);
  if (!hasDb(env) || !report?.sport) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO daily_reports (date, sport, body, metrics_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        report.date || new Date().toISOString().slice(0, 10),
        report.sport,
        report.body || "",
        JSON.stringify({ n: report.n, over: report.over || null }),
        report.generatedAt || new Date().toISOString()
      )
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryDailyReports(env, { sport, since } = {}) {
  markBound(env);
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM daily_reports WHERE date >= ?";
    const binds = [since || "2000-01-01"];
    if (sport && sport !== "all") {
      sql += " AND sport = ?";
      binds.push(sport);
    }
    sql += " ORDER BY date DESC, sport LIMIT 12";
    const res = await env.DB.prepare(sql).bind(...binds).all();
    markRead();
    return res.results || [];
  } catch (err) {
    markErr(err);
    return [];
  }
}

export async function persistStrategy(env, strategy) {
  markBound(env);
  if (!hasDb(env) || !strategy?.id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO strategies (id, name, version, rules_json, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        strategy.id,
        strategy.name,
        strategy.version || 1,
        JSON.stringify(strategy.rules || {}),
        strategy.notes || "",
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

export async function persistStrategyTicket(env, row) {
  markBound(env);
  if (!hasDb(env) || !row?.id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO strategy_tickets (
        id, strategy_id, role, sport, date, game_id, matchup, market, side, pick, line,
        ev, edge, tag, pin_vig, pin_price, model_version, checkpoint, data_quality,
        result, profit, clv, traits_json, created_at, graded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        row.id,
        row.strategyId,
        row.role,
        n(row.sport),
        n(row.date),
        n(row.gameId),
        n(row.matchup),
        n(row.market),
        n(row.side),
        n(row.pick),
        n(row.line),
        n(row.ev),
        n(row.edge),
        n(row.tag),
        n(row.pinVig),
        n(row.pinPrice),
        n(row.modelVersion),
        n(row.checkpoint),
        n(row.dataQuality),
        n(row.result || "OPEN"),
        n(row.profit),
        n(row.clv),
        n(row.traitsJson),
        new Date().toISOString(),
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

export async function gradeStrategyTicket(env, id, { result, profit, clv, gradedAt } = {}) {
  markBound(env);
  if (!hasDb(env) || !id) return { ok: false, reason: "unbound" };
  try {
    await env.DB.prepare(
      `UPDATE strategy_tickets
       SET result = ?, profit = ?, clv = ?, graded_at = ?
       WHERE id = ? AND (result IS NULL OR result = 'OPEN')`
    )
      .bind(n(result), n(profit), n(clv), n(gradedAt || new Date().toISOString()), id)
      .run();
    markWrite();
    return { ok: true };
  } catch (err) {
    markErr(err);
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function queryStrategyTickets(env, { strategyId, role } = {}) {
  markBound(env);
  if (!hasDb(env)) return [];
  try {
    let sql = "SELECT * FROM strategy_tickets WHERE 1=1";
    const binds = [];
    if (strategyId) {
      sql += " AND strategy_id = ?";
      binds.push(strategyId);
    }
    if (role) {
      sql += " AND role = ?";
      binds.push(role);
    }
    sql += " ORDER BY date DESC, created_at DESC";
    const res = binds.length ? await env.DB.prepare(sql).bind(...binds).all() : await env.DB.prepare(sql).all();
    markRead();
    return (res.results || []).map(mapStrategyTicket);
  } catch (err) {
    markErr(err);
    return [];
  }
}

function mapStrategyTicket(r) {
  let traits = {};
  try {
    traits = r.traits_json ? JSON.parse(r.traits_json) : {};
  } catch {
    traits = {};
  }
  return {
    id: r.id,
    strategyId: r.strategy_id,
    role: r.role,
    sport: r.sport,
    date: r.date,
    gameId: r.game_id,
    matchup: r.matchup,
    market: r.market,
    side: r.side,
    pick: r.pick,
    line: r.line,
    ev: r.ev,
    edge: r.edge,
    tag: r.tag,
    pinVig: r.pin_vig,
    pinPrice: r.pin_price,
    modelVersion: r.model_version,
    checkpoint: r.checkpoint,
    dataQuality: r.data_quality,
    result: r.result,
    profit: r.profit,
    clv: r.clv,
    traits,
    createdAt: r.created_at,
    gradedAt: r.graded_at,
  };
}
