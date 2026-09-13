/**
 * NFL PBP normalization — nflfastR / nflverse-shaped play rows → canonical plays.
 *
 * Does not invent EPA. Requires epa (or equivalent) on the source row when used
 * for EPA features. PIT rule: play_at / game_date must be <= informationCutoff.
 */

export const NFL_PBP_SCHEMA_VERSION = "nfl-pbp-canonical-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function bool01(v) {
  if (v == null || v === "") return null;
  if (v === true || v === 1 || v === "1" || v === "true") return 1;
  if (v === false || v === 0 || v === "0" || v === "false") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? (n ? 1 : 0) : null;
}

/**
 * Normalize one nflfastR-like play into a canonical FBIS play record.
 */
export function normalizeNflPbpPlay(raw = {}, { collectedAt = null } = {}) {
  const gameId = str(raw.game_id ?? raw.gameId);
  const playId = str(raw.play_id ?? raw.playId ?? raw.id);
  const season = num(raw.season);
  const week = num(raw.week);
  const gameDate = str(raw.game_date ?? raw.gameDate ?? raw.gameday);
  const posteam = str(raw.posteam ?? raw.offense_team ?? raw.offenseTeam)?.toUpperCase();
  const defteam = str(raw.defteam ?? raw.defense_team ?? raw.defenseTeam)?.toUpperCase();
  const down = num(raw.down);
  const playType = str(raw.play_type ?? raw.playType)?.toLowerCase();
  const epa = num(raw.epa);
  const success = bool01(raw.success);
  const yardsGained = num(raw.yards_gained ?? raw.yardsGained);
  const pass = bool01(raw.pass);
  const rush = bool01(raw.rush);
  const sack = bool01(raw.sack);
  const qbHit = bool01(raw.qb_hit ?? raw.qbHit);
  const interception = bool01(raw.interception);
  const fumbleLost = bool01(raw.fumble_lost ?? raw.fumbleLost);
  const special = bool01(raw.special ?? raw.special_teams_play);
  const yardline100 = num(raw.yardline_100 ?? raw.yardline100);
  const airYards = num(raw.air_yards ?? raw.airYards);
  const yac = num(raw.yards_after_catch ?? raw.yardsAfterCatch);
  const qtr = num(raw.qtr ?? raw.quarter);
  const playAt = str(raw.play_at ?? raw.playAt) || gameDate;

  if (!gameId || !playId || !posteam || !defteam || !playAt) {
    return { ok: false, reason: "pbp-row-incomplete", play: null };
  }

  return {
    ok: true,
    play: Object.freeze({
      schemaVersion: NFL_PBP_SCHEMA_VERSION,
      gameId,
      playId,
      season,
      week,
      gameDate,
      playAt,
      collectedAt: collectedAt || null,
      posteam,
      defteam,
      down,
      playType,
      epa,
      success,
      yardsGained,
      pass,
      rush,
      sack,
      qbHit,
      interception,
      fumbleLost,
      special,
      yardline100,
      airYards,
      yac,
      qtr,
      explosive: yardsGained != null && yardsGained >= 20 ? 1 : yardsGained == null ? null : 0,
      earlyDown: down === 1 || down === 2 ? 1 : down == null ? null : 0,
      passingDown: down === 3 || down === 4 ? 1 : down == null ? null : 0,
      redZone: yardline100 != null && yardline100 <= 20 ? 1 : yardline100 == null ? null : 0,
      turnover: interception === 1 || fumbleLost === 1 ? 1 : interception == null && fumbleLost == null ? null : 0,
    }),
  };
}

export function normalizeNflPbpPlays(rows = [], opts = {}) {
  const plays = [];
  const rejected = [];
  for (const raw of rows) {
    const out = normalizeNflPbpPlay(raw, opts);
    if (out.ok) plays.push(out.play);
    else rejected.push({ reason: out.reason, raw });
  }
  return { plays, rejected, schemaVersion: NFL_PBP_SCHEMA_VERSION };
}

/**
 * PIT filter: keep plays with playAt/gameDate <= informationCutoff.
 */
export function filterPlaysByInformationCutoff(plays = [], informationCutoff) {
  if (!informationCutoff) {
    return { ok: false, reason: "information-cutoff-required", plays: [] };
  }
  const cutMs = Date.parse(String(informationCutoff));
  if (!Number.isFinite(cutMs)) {
    return { ok: false, reason: "information-cutoff-invalid", plays: [] };
  }
  const kept = [];
  const future = [];
  for (const play of plays) {
    const t = Date.parse(String(play.playAt || play.gameDate || ""));
    if (!Number.isFinite(t)) {
      future.push(play);
      continue;
    }
    if (t <= cutMs) kept.push(play);
    else future.push(play);
  }
  return { ok: true, plays: kept, excludedFutureCount: future.length, informationCutoff };
}
