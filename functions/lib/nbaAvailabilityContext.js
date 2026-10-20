/**
 * Attach official NBA injury + lineup research context onto board games.
 * Uses persisted official PDF observations and ESPN lineup rows — no NBA Stats.
 *
 * Matching integrity:
 * - Injury rows must be applicable at each game's pre-tip checkpoint
 *   (observed_at <= tipoff, and within a freshness window before tip).
 * - Lineup `confirmed` is true only when independently verified confirmed-starter
 *   observations exist for both sides (`confirmedStarter`). A bare STARTER
 *   status without a confirming source does not satisfy the game-level flag.
 */

function clean(v) {
  return String(v || "").trim();
}
function teamKeys(team) {
  return [
    clean(team?.abbr).toLowerCase(),
    clean(team?.abbreviation).toLowerCase(),
    clean(team?.name).toLowerCase(),
    clean(team?.fullName).toLowerCase(),
    clean(team?.school).toLowerCase(),
  ].filter(Boolean);
}

function tipoffMs(game) {
  const raw = game?.start || game?.tipoff || game?.tipoff_timestamp || game?.commence || null;
  const ms = Date.parse(String(raw || ""));
  return Number.isFinite(ms) ? ms : null;
}

function isStarterStatus(status) {
  const s = clean(status).toUpperCase();
  return s === "STARTER" || s === "CONFIRMED_STARTER";
}

/** Injury observation is usable for a game tip when observed at/before tip and recent enough. */
export function injuryAppliesToTipoff(row, tipMs, { maxHoursBeforeTip = 72 } = {}) {
  if (tipMs == null) return false;
  const obsMs = Date.parse(String(row?.observed_at || row?.observedAt || ""));
  if (!Number.isFinite(obsMs)) return false;
  if (obsMs > tipMs) return false;
  const hoursBefore = (tipMs - obsMs) / 3600000;
  if (hoursBefore > maxHoursBeforeTip) return false;
  // If report_date is present, require it on/before tip calendar day (UTC date string compare).
  const reportDate = clean(row?.report_date || row?.reportDate);
  if (reportDate) {
    const tipDate = new Date(tipMs).toISOString().slice(0, 10);
    if (reportDate > tipDate) return false;
  }
  // Prefer game-linked rows when present.
  const rowGame = clean(row?.game_id || row?.gameId);
  if (rowGame && tipMs != null) {
    // Caller may pass expected game id via row._expectedGameId
    if (row._expectedGameId && String(rowGame) !== String(row._expectedGameId)) return false;
  }
  return true;
}

async function querySafe(db, sql, ...binds) {
  if (!db?.prepare) return [];
  try {
    const res = await db.prepare(sql).bind(...binds).all();
    return res?.results || [];
  } catch {
    return [];
  }
}

export async function loadNbaAvailabilityContext(db, games = []) {
  const abbrs = [...new Set((games || []).flatMap((g) => [
    ...teamKeys(g.home),
    ...teamKeys(g.away),
  ]))];
  if (!db?.prepare || !abbrs.length) {
    return {
      byGame: {},
      lineupsByGame: {},
      meta: { configured: false, injuryRows: 0, lineupRows: 0, matchedInjuryRows: 0, source: null },
    };
  }

  const injuryRows = await querySafe(
    db,
    `SELECT player_id, player_name, team_key, team_name, status, source, observed_at, report_date, notes, game_id
     FROM player_availability_observations
     WHERE sport='nba' AND observed_at >= datetime('now','-7 days')
     ORDER BY observed_at DESC
     LIMIT 4000`
  );

  const lineupRows = await querySafe(
    db,
    `SELECT game_id, team_key, player_id, player_name, lineup_status, observed_at, source, tipoff_timestamp
     FROM nba_lineup_observations
     WHERE observed_at >= datetime('now','-3 days')
     ORDER BY observed_at DESC
     LIMIT 4000`
  );

  const byGame = {};
  let matchedInjuryRows = 0;
  for (const game of games || []) {
    const gid = String(game.id || "");
    if (!gid) continue;
    const tip = tipoffMs(game);
    const homeKeys = new Set(teamKeys(game.home));
    const awayKeys = new Set(teamKeys(game.away));
    const home = [];
    const away = [];
    const seen = new Set();
    for (const row of injuryRows) {
      const key = clean(row.team_key).toLowerCase();
      if (!key || (!homeKeys.has(key) && !awayKeys.has(key))) continue;
      // Game-linked rows must match this event when present.
      if (row.game_id && String(row.game_id) !== gid) continue;
      const applicable = tip != null
        ? injuryAppliesToTipoff({ ...row, _expectedGameId: gid }, tip)
        : false;
      if (!applicable) continue;
      const pid = String(row.player_id || row.player_name || "");
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      const entry = {
        playerId: row.player_id || null,
        playerName: row.player_name || null,
        status: row.status || "UNKNOWN",
        source: row.source || null,
        observedAt: row.observed_at || null,
        reportDate: row.report_date || null,
        notes: row.notes || null,
        tipoffMatched: true,
      };
      if (homeKeys.has(key)) home.push(entry);
      else away.push(entry);
      matchedInjuryRows += 1;
    }
    byGame[gid] = { home, away, tipoff: tip != null ? new Date(tip).toISOString() : null, tipoffMatched: tip != null };
  }

  const lineupsByGame = {};
  for (const row of lineupRows) {
    const gid = String(row.game_id || "");
    if (!gid) continue;
    const game = (games || []).find((g) => String(g.id) === gid);
    if (!game) continue;
    const tip = tipoffMs(game);
    const obsMs = Date.parse(String(row.observed_at || ""));
    // Lineup observation must be at/before tip when tip is known.
    if (tip != null && Number.isFinite(obsMs) && obsMs > tip) continue;
    if (!lineupsByGame[gid]) {
      lineupsByGame[gid] = { home: [], away: [], source: row.source || null };
    }
    const key = clean(row.team_key).toLowerCase();
    const starter = isStarterStatus(row.lineup_status);
    const entry = {
      playerId: row.player_id || null,
      playerName: row.player_name || null,
      starter,
      lineupStatus: clean(row.lineup_status).toUpperCase() || null,
      observedAt: row.observed_at || null,
      confirmedStarter: starter && /ESPN_CONFIRMED_STARTER|CONFIRMED/i.test(String(row.source || "")),
    };
    if (teamKeys(game.home).includes(key)) lineupsByGame[gid].home.push(entry);
    else if (teamKeys(game.away).includes(key)) lineupsByGame[gid].away.push(entry);
  }

  const officialSources = injuryRows.filter((r) => /official|nba_injury|injury.report/i.test(String(r.source || "")));
  return {
    byGame,
    lineupsByGame,
    meta: {
      configured: matchedInjuryRows > 0 || Object.keys(lineupsByGame).length > 0,
      injuryRows: injuryRows.length,
      matchedInjuryRows,
      lineupRows: lineupRows.length,
      officialInjuryRows: officialSources.length,
      source: matchedInjuryRows
        ? [...new Set(injuryRows.map((r) => r.source).filter(Boolean))].join("+")
        : Object.keys(lineupsByGame).length ? "NBA_LINEUP_OBSERVATIONS" : null,
      matching: "pre_tip_checkpoint",
      researchOnly: true,
      canAuthorize: false,
    },
  };
}

export function attachNbaAvailabilityContext(games = [], ctx = {}) {
  const byGame = ctx.byGame || {};
  const lineupsByGame = ctx.lineupsByGame || {};
  return (games || []).map((game) => {
    const gid = String(game.id || "");
    const matched = byGame[gid] || { home: [], away: [], tipoffMatched: false };
    const home = matched.home || [];
    const away = matched.away || [];
    const lineup = lineupsByGame[gid] || null;
    const homeStarters = (lineup?.home || []).filter((p) => p.starter === true);
    const awayStarters = (lineup?.away || []).filter((p) => p.starter === true);
    const homeConfirmedStarters = (lineup?.home || []).filter((p) => p.confirmedStarter === true);
    const awayConfirmedStarters = (lineup?.away || []).filter((p) => p.confirmedStarter === true);
    // Game-level confirmed requires independently verified confirmation both sides.
    const confirmed = homeConfirmedStarters.length > 0 && awayConfirmedStarters.length > 0;
    const outCount = [...home, ...away].filter((p) => /OUT|SUSPENDED|INACTIVE/i.test(String(p.status || ""))).length;
    const doubtful = [...home, ...away].filter((p) => /DOUBT|QUESTION/i.test(String(p.status || ""))).length;
    return {
      ...game,
      nbaAvailability: {
        configured: Boolean(matched.tipoffMatched && (home.length || away.length)),
        tipoffMatched: Boolean(matched.tipoffMatched),
        tipoff: matched.tipoff || null,
        source: ctx.meta?.source || null,
        home,
        away,
        outCount,
        doubtfulCount: doubtful,
        officialInjuryRows: ctx.meta?.officialInjuryRows || 0,
        researchOnly: true,
        canAuthorize: false,
      },
      nbaLineups: lineup
        ? {
            home: lineup.home || [],
            away: lineup.away || [],
            homeStarters,
            awayStarters,
            homeConfirmedStarters,
            awayConfirmedStarters,
            source: lineup.source || null,
            confirmed,
            researchOnly: true,
            canAuthorize: false,
          }
        : {
            home: [],
            away: [],
            homeStarters: [],
            awayStarters: [],
            homeConfirmedStarters: [],
            awayConfirmedStarters: [],
            confirmed: false,
            source: null,
            researchOnly: true,
            canAuthorize: false,
          },
    };
  });
}
