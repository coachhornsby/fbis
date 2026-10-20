/**
 * Attach official NBA injury + lineup research context onto board games.
 * Uses persisted official PDF observations and ESPN lineup rows — no NBA Stats.
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
    return { byTeam: {}, lineupsByGame: {}, meta: { configured: false, injuryRows: 0, lineupRows: 0, source: null } };
  }

  const injuryRows = await querySafe(
    db,
    `SELECT player_id, player_name, team_key, team_name, status, source, observed_at, report_date, notes
     FROM player_availability_observations
     WHERE sport='nba' AND observed_at >= datetime('now','-5 days')
     ORDER BY observed_at DESC
     LIMIT 4000`
  );

  const lineupRows = await querySafe(
    db,
    `SELECT game_id, team_key, player_id, player_name, lineup_status, observed_at, source
     FROM nba_lineup_observations
     WHERE observed_at >= datetime('now','-3 days')
     ORDER BY observed_at DESC
     LIMIT 4000`
  );

  const byTeam = {};
  for (const row of injuryRows) {
    const key = clean(row.team_key).toLowerCase();
    if (!key) continue;
    if (!byTeam[key]) byTeam[key] = [];
    // Keep latest per player
    if (byTeam[key].some((p) => String(p.player_id || p.player_name) === String(row.player_id || row.player_name))) continue;
    byTeam[key].push({
      playerId: row.player_id || null,
      playerName: row.player_name || null,
      status: row.status || "UNKNOWN",
      source: row.source || null,
      observedAt: row.observed_at || null,
      reportDate: row.report_date || null,
      notes: row.notes || null,
    });
  }

  const lineupsByGame = {};
  for (const row of lineupRows) {
    const gid = String(row.game_id || "");
    if (!gid) continue;
    if (!lineupsByGame[gid]) lineupsByGame[gid] = { home: [], away: [], source: row.source || null };
  }
  // Second pass after we know games — attach by team key match
  for (const row of lineupRows) {
    const gid = String(row.game_id || "");
    const game = (games || []).find((g) => String(g.id) === gid);
    if (!game || !lineupsByGame[gid]) continue;
    const key = clean(row.team_key).toLowerCase();
    const status = clean(row.lineup_status).toUpperCase();
    const entry = {
      playerId: row.player_id || null,
      playerName: row.player_name || null,
      starter: status === "STARTER" || status === "CONFIRMED_STARTER",
      lineupStatus: status || null,
      observedAt: row.observed_at || null,
    };
    if (teamKeys(game.home).includes(key)) lineupsByGame[gid].home.push(entry);
    else if (teamKeys(game.away).includes(key)) lineupsByGame[gid].away.push(entry);
  }

  const officialSources = injuryRows.filter((r) => /official|nba_injury|injury.report/i.test(String(r.source || "")));
  return {
    byTeam,
    lineupsByGame,
    meta: {
      configured: injuryRows.length > 0 || lineupRows.length > 0,
      injuryRows: injuryRows.length,
      lineupRows: lineupRows.length,
      officialInjuryRows: officialSources.length,
      source: injuryRows.length
        ? [...new Set(injuryRows.map((r) => r.source).filter(Boolean))].join("+")
        : lineupRows.length ? "NBA_LINEUP_OBSERVATIONS" : null,
      researchOnly: true,
      canAuthorize: false,
    },
  };
}

export function attachNbaAvailabilityContext(games = [], ctx = {}) {
  const byTeam = ctx.byTeam || {};
  const lineupsByGame = ctx.lineupsByGame || {};
  return (games || []).map((game) => {
    const homeKeys = teamKeys(game.home);
    const awayKeys = teamKeys(game.away);
    const homePlayers = homeKeys.flatMap((k) => byTeam[k] || []);
    const awayPlayers = awayKeys.flatMap((k) => byTeam[k] || []);
    const uniq = (rows) => {
      const seen = new Set();
      return rows.filter((r) => {
        const id = String(r.playerId || r.playerName || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    };
    const home = uniq(homePlayers);
    const away = uniq(awayPlayers);
    const lineup = lineupsByGame[String(game.id)] || null;
    const outCount = [...home, ...away].filter((p) => /OUT|SUSPENDED|INACTIVE/i.test(String(p.status || ""))).length;
    const doubtful = [...home, ...away].filter((p) => /DOUBT|QUESTION/i.test(String(p.status || ""))).length;
    return {
      ...game,
      nbaAvailability: {
        configured: Boolean(ctx.meta?.configured),
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
            source: lineup.source || null,
            confirmed: (lineup.home?.length || 0) + (lineup.away?.length || 0) > 0,
            researchOnly: true,
            canAuthorize: false,
          }
        : { home: [], away: [], confirmed: false, source: null, researchOnly: true, canAuthorize: false },
    };
  });
}
