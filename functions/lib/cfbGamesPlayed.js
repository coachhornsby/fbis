/**
 * Resolve CFB observation counts for prior/current blending.
 *
 * Priority:
 *   1. Explicit completed-game counts (gamesPlayed / games / nGames)
 *   2. Schedule-derived completed games (verified results before cutoff)
 *   3. Week-bounded CORE throughWeek as a LAST-RESORT information-quality
 *      proxy — never treated as a verified game count without a flag
 *
 * coreThroughWeek is NOT games played. Callers must surface the source.
 */

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const GAMES_PLAYED_SOURCES = Object.freeze({
  EXPLICIT: "explicit",
  SCHEDULE: "schedule",
  CORE_THROUGH_WEEK_FALLBACK: "coreThroughWeekFallback",
  MISSING: "missing",
});

/**
 * @param {object} fields team_feature_snapshots fields or deep-feed row
 * @param {{ scheduleGamesPlayed?: number|null }} [opts]
 * @returns {{ gamesPlayed: number|null, source: string, uncertainty: boolean, note: string|null }}
 */
export function resolveGamesPlayedWithSource(fields = {}, opts = {}) {
  const explicit = num(fields.gamesPlayed) ?? num(fields.games) ?? num(fields.nGames);
  if (explicit != null && explicit > 0) {
    return {
      gamesPlayed: explicit,
      source: GAMES_PLAYED_SOURCES.EXPLICIT,
      uncertainty: false,
      note: null,
    };
  }

  const schedule = num(opts.scheduleGamesPlayed) ?? num(fields.scheduleGamesPlayed);
  if (schedule != null && schedule > 0) {
    return {
      gamesPlayed: schedule,
      source: GAMES_PLAYED_SOURCES.SCHEDULE,
      uncertainty: false,
      note: "Derived from verified completed schedule/results before feature cutoff",
    };
  }

  const throughWeek = num(fields.coreThroughWeek);
  if (fields.coreWeekBounded === true && throughWeek != null && throughWeek > 0) {
    return {
      gamesPlayed: throughWeek,
      source: GAMES_PLAYED_SOURCES.CORE_THROUGH_WEEK_FALLBACK,
      uncertainty: true,
      note: "coreThroughWeek is a week-bounded CORE coverage proxy, not a verified games-played count",
    };
  }

  return {
    gamesPlayed: null,
    source: GAMES_PLAYED_SOURCES.MISSING,
    uncertainty: true,
    note: "No verified observation count; prior blend must not claim current-season dominance",
  };
}

/**
 * Count completed games for a school from CFBD/ESPN-style game rows before `now`.
 * Exported for indexing and tests.
 */
export function countCompletedGamesBySchool(rows = [], now = Date.now()) {
  const bySchool = new Map();
  const bump = (name, start) => {
    if (!name) return;
    const ts = Date.parse(String(start || ""));
    if (Number.isFinite(ts) && ts >= now) return;
    const key = String(name).trim().toLowerCase();
    if (!key) return;
    bySchool.set(key, (bySchool.get(key) || 0) + 1);
  };
  for (const g of rows) {
    const hp = g.homePoints ?? g.homeScore ?? g.home_points ?? g.actual_home;
    const ap = g.awayPoints ?? g.awayScore ?? g.away_points ?? g.actual_away;
    const status = String(g.status || g.gameStatus || "").toLowerCase();
    const completed =
      g.completed === true ||
      g.isCompleted === true ||
      ["final", "complete", "completed"].includes(status) ||
      (num(hp) != null && num(ap) != null);
    if (!completed) continue;
    const start = g.startDate || g.start_date || g.startTime || g.kickoff || g.start || null;
    bump(g.homeTeam || g.home || g.home_team || g.home_name, start);
    bump(g.awayTeam || g.away || g.away_team || g.away_name, start);
  }
  return bySchool;
}
