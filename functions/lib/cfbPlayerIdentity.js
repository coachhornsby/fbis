/**
 * CFB player role identity — QB1 / RB1 / WR1 only.
 * Role selection is temporal: only information available before kickoff.
 * Never use end-of-season leaders for historical role assignment.
 */

import { TEMPORAL_CLASS } from "./cfbFeaturePipeline.js";

export const PLAYER_ROLES = Object.freeze(["QB1", "RB1", "WR1"]);
export const IDENTITY_VERSION = "cfb-player-identity-v1";

/** Explicit role-confidence tiers for historical identity audit. */
export const ROLE_CONFIDENCE_TIERS = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
});

/**
 * Map numeric confidence + identity state → LOW/MEDIUM/HIGH.
 * Uncertain competitions always LOW and widen uncertainty.
 */
export function classifyRoleConfidence(confidence, state = null) {
  const c = Number(confidence);
  const s = String(state || "").toUpperCase();
  if (s.includes("UNCERTAIN") || !Number.isFinite(c) || c < 0.45) return ROLE_CONFIDENCE_TIERS.LOW;
  if (c < 0.7 || s === "LIKELY") return ROLE_CONFIDENCE_TIERS.MEDIUM;
  return ROLE_CONFIDENCE_TIERS.HIGH;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function schoolKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function posOf(row) {
  return String(row?.position || row?.pos || "").toUpperCase();
}

function playerIdOf(row) {
  return row?.athleteId != null
    ? String(row.athleteId)
    : row?.id != null
      ? String(row.id)
      : row?.playerId != null
        ? String(row.playerId)
        : null;
}

function playerNameOf(row) {
  return row?.name || row?.player || row?.athleteName || null;
}

function filterTeam(rows, team) {
  const key = schoolKey(team);
  return (rows || []).filter((r) => schoolKey(r.team || r.school) === key);
}

/** Reject player-game observations on/after kickoff. */
export function filterPlayerGamesBeforeKickoff(rows = [], kickoffTimestamp) {
  const kick = Date.parse(kickoffTimestamp || "");
  if (!Number.isFinite(kick)) return [];
  return (rows || []).filter((r) => {
    const start = Date.parse(r.startDate || r.start_date || r.gameDate || r.kickoff || "");
    if (!Number.isFinite(start)) {
      // Season aggregates without game date are NOT safe for historical role — exclude
      return false;
    }
    return start < kick;
  });
}

function parseIntStat(v) {
  if (v == null || v === "") return null;
  const s = String(v);
  if (s.includes("/")) {
    const parts = s.split("/");
    return { left: num(parts[0]), right: num(parts[1]) };
  }
  return num(s.replace(/,/g, ""));
}

/**
 * Flatten CFBD `/games/players` nested game→teams→categories→types→athletes
 * into flat player-game rows consumable by identifyQb1/Rb1/Wr1.
 */
export function flattenGamesPlayersResponse(rows = [], opts = {}) {
  const gamesById = opts.gamesById || null;
  const week = opts.week ?? null;
  const season = opts.season ?? null;
  const out = [];
  for (const game of rows || []) {
    if (game && (game.team || game.school) && (game.name || game.player || game.athleteName) && !game.teams) {
      out.push({
        ...game,
        gameId: game.gameId || game.game_id || game.id || null,
        startDate: game.startDate || game.start_date || (gamesById && gamesById.get(String(game.gameId || game.id))) || null,
        week: game.week ?? week,
        season: game.season ?? season,
      });
      continue;
    }
    const gameId = game?.id ?? game?.gameId ?? null;
    const kick =
      game?.startDate ||
      game?.start_date ||
      (gamesById && gameId != null ? gamesById.get(String(gameId)) : null) ||
      null;
    const gameWeek = game?.week ?? week;
    const gameSeason = game?.season ?? game?.year ?? season;
    for (const teamBlock of game?.teams || []) {
      const team = teamBlock?.team || teamBlock?.school || null;
      const byAthlete = new Map();
      for (const cat of teamBlock?.categories || []) {
        const catName = String(cat?.name || "").toLowerCase();
        for (const typ of cat?.types || []) {
          const typeName = String(typ?.name || "").toUpperCase();
          for (const ath of typ?.athletes || []) {
            const aid = ath?.id != null ? String(ath.id) : nameKey(ath?.name);
            if (!aid || !ath?.name) continue;
            const row =
              byAthlete.get(aid) ||
              {
                gameId: gameId != null ? String(gameId) : null,
                team,
                name: ath.name,
                athleteId: ath.id != null ? String(ath.id) : null,
                position: null,
                startDate: kick,
                week: gameWeek,
                season: gameSeason,
                endpoint: "/games/players",
                passingAttempts: null,
                passingCompletions: null,
                passingYards: null,
                rushingAttempts: null,
                rushingYards: null,
                receptions: null,
                receivingYards: null,
                targets: null,
              };
            const parsed = parseIntStat(ath.stat);
            if (catName === "passing") {
              row.position = row.position || "QB";
              if (typeName === "C/ATT" && parsed && typeof parsed === "object") {
                row.passingCompletions = parsed.left;
                row.passingAttempts = parsed.right;
              } else if (typeName === "YDS") row.passingYards = typeof parsed === "number" ? parsed : null;
            } else if (catName === "rushing") {
              if (!row.position) row.position = "RB";
              if (typeName === "CAR") row.rushingAttempts = typeof parsed === "number" ? parsed : null;
              else if (typeName === "YDS") row.rushingYards = typeof parsed === "number" ? parsed : null;
            } else if (catName === "receiving") {
              if (!row.position || row.position === "RB") row.position = "WR";
              if (typeName === "REC") row.receptions = typeof parsed === "number" ? parsed : null;
              else if (typeName === "YDS") row.receivingYards = typeof parsed === "number" ? parsed : null;
              else if (typeName === "TGTS" || typeName === "TARGETS") {
                row.targets = typeof parsed === "number" ? parsed : null;
              }
            }
            byAthlete.set(aid, row);
          }
        }
      }
      for (const row of byAthlete.values()) out.push(row);
    }
  }
  return out;
}

/**
 * Reject using future production to pick a role.
 * Season leader after week N for a week-N game is leakage.
 */
export function assertNoFutureRoleLeakage({ roleWeek = null, evidenceThroughWeek = null } = {}) {
  if (roleWeek == null || evidenceThroughWeek == null) return { ok: true, errors: [] };
  if (Number(evidenceThroughWeek) >= Number(roleWeek)) {
    return { ok: false, errors: ["role-evidence-includes-current-or-future-week"] };
  }
  return { ok: true, errors: [] };
}

function confidenceFromScores(best, second) {
  if (best == null) return 0;
  if (second == null || second <= 0) return Math.min(0.95, 0.55 + best / 100);
  const gap = (best - second) / Math.max(best, 1e-6);
  return Math.max(0.15, Math.min(0.98, 0.4 + gap * 0.55));
}

/**
 * Identify QB1. Prefer confirmed starter when provided; else usage + pass PPA from prior games.
 * If cannot confidently identify → QB_UNCERTAIN (does not silently invent a starter).
 */
export function identifyQb1({
  team,
  rosterRows = [],
  playerPpaRows = [],
  usageRows = [],
  playerGameRows = [],
  confirmedStarter = null,
  kickoffTimestamp = null,
  week = null,
  identityAsOf = null,
} = {}) {
  const asOf = identityAsOf || new Date().toISOString();
  const teamRoster = filterTeam(rosterRows, team).filter((r) => ["QB", "QB1"].includes(posOf(r)) || posOf(r) === "QB");
  const priorGames = kickoffTimestamp
    ? filterPlayerGamesBeforeKickoff(filterTeam(playerGameRows, team), kickoffTimestamp)
    : filterTeam(playerGameRows, team);

  if (confirmedStarter?.name || confirmedStarter?.playerName) {
    const name = confirmedStarter.name || confirmedStarter.playerName;
    return {
      role: "QB1",
      player_id: confirmedStarter.playerId || confirmedStarter.id || null,
      player_name: name,
      team,
      position: "QB",
      role_confidence: Math.min(0.99, num(confirmedStarter.confidence) ?? 0.92),
      identity_as_of: asOf,
      state: "CONFIRMED_STARTER",
      selection: { method: "confirmed-starter", week },
      provenance: { identityVersion: IDENTITY_VERSION, temporalClass: TEMPORAL_CLASS.A, kickoffTimestamp },
    };
  }

  // Score candidates from prior game production + usage (never post-kickoff)
  const candidates = new Map();
  const bump = (row, score, source) => {
    const id = playerIdOf(row) || nameKey(playerNameOf(row));
    if (!id || !playerNameOf(row)) return;
    const prev = candidates.get(id) || {
      player_id: playerIdOf(row),
      player_name: playerNameOf(row),
      position: "QB",
      score: 0,
      sources: [],
      sample_size: 0,
    };
    prev.score += score;
    prev.sources.push(source);
    prev.sample_size += 1;
    candidates.set(id, prev);
  };

  for (const g of priorGames) {
    if (!["QB"].includes(posOf(g)) && num(g.passingAttempts ?? g.attempts) == null) continue;
    const attempts = num(g.passingAttempts ?? g.attempts) || 0;
    const yards = num(g.passingYards ?? g.yards) || 0;
    bump(g, attempts * 1.2 + yards / 25, "prior-game");
  }

  for (const row of filterTeam(playerPpaRows, team)) {
    if (posOf(row) && posOf(row) !== "QB") continue;
    // Season PPA without game bounding: only allowed as weak prior for Week 1 / when no game rows
    const weight = priorGames.length ? 0.15 : 0.6;
    const ppa = num(row.averagePPA?.pass ?? row.averagePpa?.pass ?? row.averagePPA?.all ?? row.ppa) || 0;
    const games = num(row.games) || 1;
    bump(row, weight * (ppa * 20 + games), priorGames.length ? "season-ppa-weak" : "season-ppa-week1");
  }

  for (const row of filterTeam(usageRows, team)) {
    if (posOf(row) && posOf(row) !== "QB") continue;
    const usg = num(row.usage?.overall ?? row.usage?.pass ?? row.usage) || 0;
    bump(row, usg * (priorGames.length ? 8 : 25), "usage");
  }

  // Roster first-string hint
  for (const row of teamRoster) {
    const depth = num(row.depth ?? row.firstString ?? row.starter);
    if (depth === 1 || row.firstString === true || row.starter === true) {
      bump(row, 12, "roster-depth");
    }
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  const conf = confidenceFromScores(best?.score, second?.score);
  const week1 = week === 1 || week === "1";

  if (!best || conf < 0.35 || (week1 && conf < 0.45 && !priorGames.length)) {
    return {
      role: "QB1",
      player_id: best?.player_id || null,
      player_name: best?.player_name || null,
      team,
      position: "QB",
      role_confidence: conf,
      identity_as_of: asOf,
      state: "QB_UNCERTAIN",
      selection: { method: "uncertain", week, rankedTop: ranked.slice(0, 3) },
      provenance: {
        identityVersion: IDENTITY_VERSION,
        temporalClass: TEMPORAL_CLASS.C,
        kickoffTimestamp,
        widenUncertainty: true,
      },
    };
  }

  return {
    role: "QB1",
    player_id: best.player_id,
    player_name: best.player_name,
    team,
    position: "QB",
    role_confidence: conf,
    identity_as_of: asOf,
    state: conf >= 0.7 ? "PRIMARY" : "LIKELY",
    selection: {
      method: priorGames.length ? "prior-games+usage" : "preseason-prior",
      week,
      score: best.score,
      sample_size: best.sample_size,
      sources: best.sources,
    },
    provenance: { identityVersion: IDENTITY_VERSION, temporalClass: TEMPORAL_CLASS.C, kickoffTimestamp },
  };
}

/**
 * Identify RB1 from recent carries + rush share — not season yardage alone.
 */
export function identifyRb1({
  team,
  rosterRows = [],
  playerPpaRows = [],
  usageRows = [],
  playerGameRows = [],
  kickoffTimestamp = null,
  week = null,
  identityAsOf = null,
} = {}) {
  const asOf = identityAsOf || new Date().toISOString();
  const priorGames = kickoffTimestamp
    ? filterPlayerGamesBeforeKickoff(filterTeam(playerGameRows, team), kickoffTimestamp)
    : filterTeam(playerGameRows, team);
  const candidates = new Map();
  const bump = (row, score, source) => {
    const id = playerIdOf(row) || nameKey(playerNameOf(row));
    if (!id || !playerNameOf(row)) return;
    const prev = candidates.get(id) || {
      player_id: playerIdOf(row),
      player_name: playerNameOf(row),
      position: "RB",
      score: 0,
      sources: [],
      recentCarries: 0,
      sample_size: 0,
    };
    prev.score += score;
    prev.sources.push(source);
    prev.sample_size += 1;
    candidates.set(id, prev);
  };

  // Weight recent games more heavily (last 3 before kickoff)
  const sortedGames = [...priorGames].sort(
    (a, b) => Date.parse(b.startDate || b.start_date || 0) - Date.parse(a.startDate || a.start_date || 0)
  );
  sortedGames.forEach((g, idx) => {
    const pos = posOf(g);
    // Dual-threat QBs have CAR stats — never select them as RB1
    // Note: num(null)===0 because Number(null)===0; only treat explicit pass attempts as QB signal
    if (pos === "QB" || (g.passingAttempts != null && Number(g.passingAttempts) > 0)) return;
    if (pos && !["RB", "TB", "HB", "FB"].includes(pos) && num(g.rushingAttempts ?? g.carries) == null) return;
    const carries = num(g.rushingAttempts ?? g.carries) || 0;
    const yards = num(g.rushingYards ?? g.yards) || 0;
    const recency = idx < 3 ? 1.6 : idx < 6 ? 1.1 : 0.7;
    const id = playerIdOf(g) || nameKey(playerNameOf(g));
    bump(g, recency * (carries * 2.2 + yards / 20), "prior-game");
    if (candidates.has(id)) candidates.get(id).recentCarries += carries;
  });

  for (const row of filterTeam(playerPpaRows, team)) {
    if (posOf(row) && !["RB", "TB", "HB"].includes(posOf(row))) continue;
    const weight = priorGames.length ? 0.12 : 0.55;
    const ppa = num(row.averagePPA?.rush ?? row.averagePPA?.all ?? row.ppa) || 0;
    bump(row, weight * (ppa * 15 + (num(row.games) || 0)), priorGames.length ? "season-ppa-weak" : "season-ppa-week1");
  }

  for (const row of filterTeam(usageRows, team)) {
    if (posOf(row) && !["RB", "TB", "HB"].includes(posOf(row))) continue;
    const rushUsg = num(row.usage?.rush ?? row.usage?.overall ?? row.usage) || 0;
    bump(row, rushUsg * (priorGames.length ? 10 : 28), "usage");
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  const conf = confidenceFromScores(best?.score, second?.score);

  // Role-change guard: if season yards leader differs from recent carry leader, prefer recent
  if (best && second && best.recentCarries + 4 < second.recentCarries) {
    // Prefer higher recent carries
    const swap = second.recentCarries > best.recentCarries + 4;
    if (swap) {
      return finalizeSkill(second, ranked, {
        role: "RB1",
        team,
        position: "RB",
        asOf,
        week,
        kickoffTimestamp,
        method: "recent-role-override",
        conf: confidenceFromScores(second.score, best.score) * 0.9,
      });
    }
  }

  if (!best || conf < 0.3) {
    return {
      role: "RB1",
      player_id: best?.player_id || null,
      player_name: best?.player_name || null,
      team,
      position: "RB",
      role_confidence: conf,
      identity_as_of: asOf,
      state: "RB_UNCERTAIN",
      selection: { method: "uncertain", week, rankedTop: ranked.slice(0, 3) },
      provenance: { identityVersion: IDENTITY_VERSION, temporalClass: TEMPORAL_CLASS.C, kickoffTimestamp, widenUncertainty: true },
    };
  }

  return finalizeSkill(best, ranked, {
    role: "RB1",
    team,
    position: "RB",
    asOf,
    week,
    kickoffTimestamp,
    method: priorGames.length ? "recent-carries+usage" : "preseason-prior",
    conf,
  });
}

/**
 * Identify WR1 from recent targets/receptions/yards + receiving usage — not season yards alone.
 */
export function identifyWr1({
  team,
  rosterRows = [],
  playerPpaRows = [],
  usageRows = [],
  playerGameRows = [],
  kickoffTimestamp = null,
  week = null,
  identityAsOf = null,
} = {}) {
  const asOf = identityAsOf || new Date().toISOString();
  const priorGames = kickoffTimestamp
    ? filterPlayerGamesBeforeKickoff(filterTeam(playerGameRows, team), kickoffTimestamp)
    : filterTeam(playerGameRows, team);
  const candidates = new Map();
  const bump = (row, score, source, extra = {}) => {
    const id = playerIdOf(row) || nameKey(playerNameOf(row));
    if (!id || !playerNameOf(row)) return;
    const prev = candidates.get(id) || {
      player_id: playerIdOf(row),
      player_name: playerNameOf(row),
      position: "WR",
      score: 0,
      sources: [],
      recentTargets: 0,
      recentRec: 0,
      sample_size: 0,
    };
    prev.score += score;
    prev.sources.push(source);
    prev.sample_size += 1;
    if (extra.targets) prev.recentTargets += extra.targets;
    if (extra.rec) prev.recentRec += extra.rec;
    candidates.set(id, prev);
  };

  const sortedGames = [...priorGames].sort(
    (a, b) => Date.parse(b.startDate || b.start_date || 0) - Date.parse(a.startDate || a.start_date || 0)
  );
  sortedGames.forEach((g, idx) => {
    const pos = posOf(g);
    // Note: num(null)===0 because Number(null)===0; only treat explicit pass attempts as QB signal
    if (pos === "QB" || (g.passingAttempts != null && Number(g.passingAttempts) > 0)) return;
    if (pos && !["WR", "WR1", "WR2"].includes(pos) && num(g.receptions ?? g.receivingYards) == null) return;
    // TE excluded from WR1 by design in this phase
    if (pos === "TE") return;
    const targets = num(g.targets ?? g.receivingTargets);
    const rec = num(g.receptions) || 0;
    const yards = num(g.receivingYards ?? g.yards) || 0;
    const opportunity = targets != null ? targets : rec * 1.35; // proxy when targets missing
    const recency = idx < 3 ? 1.7 : idx < 6 ? 1.15 : 0.7;
    bump(g, recency * (opportunity * 2.5 + yards / 18 + rec), "prior-game", {
      targets: targets || 0,
      rec,
    });
  });

  for (const row of filterTeam(playerPpaRows, team)) {
    if (posOf(row) === "TE") continue;
    if (posOf(row) && !["WR"].includes(posOf(row))) continue;
    const weight = priorGames.length ? 0.12 : 0.55;
    const ppa = num(row.averagePPA?.pass ?? row.averagePPA?.all ?? row.ppa) || 0;
    bump(row, weight * (ppa * 18 + (num(row.games) || 0)), priorGames.length ? "season-ppa-weak" : "season-ppa-week1");
  }

  for (const row of filterTeam(usageRows, team)) {
    if (posOf(row) === "TE") continue;
    if (posOf(row) && posOf(row) !== "WR") continue;
    const passUsg = num(row.usage?.pass ?? row.usage?.overall ?? row.usage) || 0;
    bump(row, passUsg * (priorGames.length ? 12 : 30), "usage");
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0] || null;
  const second = ranked[1] || null;
  let pick = best;
  let conf = confidenceFromScores(best?.score, second?.score);
  let method = priorGames.length ? "recent-usage+targets" : "preseason-prior";

  // Prefer current usage over season yards leader
  if (best && second && best.recentTargets + 3 < second.recentTargets) {
    pick = second;
    conf = confidenceFromScores(second.score, best.score) * 0.9;
    method = "recent-role-override";
  }

  if (!pick || conf < 0.3) {
    return {
      role: "WR1",
      player_id: pick?.player_id || null,
      player_name: pick?.player_name || null,
      team,
      position: "WR",
      role_confidence: conf,
      identity_as_of: asOf,
      state: "WR_UNCERTAIN",
      selection: { method: "uncertain", week, rankedTop: ranked.slice(0, 3) },
      provenance: { identityVersion: IDENTITY_VERSION, temporalClass: TEMPORAL_CLASS.C, kickoffTimestamp, widenUncertainty: true },
    };
  }

  return finalizeSkill(pick, ranked, {
    role: "WR1",
    team,
    position: "WR",
    asOf,
    week,
    kickoffTimestamp,
    method,
    conf,
  });
}

function finalizeSkill(best, ranked, { role, team, position, asOf, week, kickoffTimestamp, method, conf }) {
  return {
    role,
    player_id: best.player_id,
    player_name: best.player_name,
    team,
    position,
    role_confidence: conf,
    identity_as_of: asOf,
    state: conf >= 0.7 ? "PRIMARY" : "LIKELY",
    selection: {
      method,
      week,
      score: best.score,
      sample_size: best.sample_size,
      sources: best.sources,
      rankedTop: ranked.slice(0, 3).map((r) => ({
        player_name: r.player_name,
        score: r.score,
        recentCarries: r.recentCarries,
        recentTargets: r.recentTargets,
      })),
    },
    provenance: { identityVersion: IDENTITY_VERSION, temporalClass: TEMPORAL_CLASS.C, kickoffTimestamp },
  };
}

/**
 * Identify all six player roles for a game (away/home × QB1/RB1/WR1).
 */
export function identifyGamePlayerRoles(game = {}, feeds = {}) {
  const kickoff = game.startDate || game.start_date || game.kickoff || game.start;
  const week = game.week ?? null;
  const asOf = feeds.identityAsOf || new Date().toISOString();
  const sides = [
    { side: "away", team: game.awayTeam || game.away_team || game.away?.school || game.away?.name || game.away?.fullName },
    { side: "home", team: game.homeTeam || game.home_team || game.home?.school || game.home?.name || game.home?.fullName },
  ];
  const roles = {};
  for (const { side, team } of sides) {
    const sideFeeds = feeds[side] || feeds;
    const confirmed = sideFeeds.confirmedQb || game?.cfbDetail?.[side]?.qb;
    roles[side] = {
      QB1: identifyQb1({
        team,
        rosterRows: sideFeeds.rosterRows || feeds.rosterRows,
        playerPpaRows: sideFeeds.qbPpaRows || feeds.qbPpaRows,
        usageRows: sideFeeds.usageRows || feeds.usageRows,
        playerGameRows: sideFeeds.playerGameRows || feeds.playerGameRows,
        confirmedStarter: confirmed?.starterKnown
          ? { name: confirmed.starterName, confidence: 0.93, playerId: confirmed.playerId }
          : null,
        kickoffTimestamp: kickoff,
        week,
        identityAsOf: asOf,
      }),
      RB1: identifyRb1({
        team,
        rosterRows: sideFeeds.rosterRows || feeds.rosterRows,
        playerPpaRows: sideFeeds.rbPpaRows || feeds.rbPpaRows,
        usageRows: sideFeeds.usageRows || feeds.usageRows,
        playerGameRows: sideFeeds.playerGameRows || feeds.playerGameRows,
        kickoffTimestamp: kickoff,
        week,
        identityAsOf: asOf,
      }),
      WR1: identifyWr1({
        team,
        rosterRows: sideFeeds.rosterRows || feeds.rosterRows,
        playerPpaRows: sideFeeds.wrPpaRows || feeds.wrPpaRows,
        usageRows: sideFeeds.usageRows || feeds.usageRows,
        playerGameRows: sideFeeds.playerGameRows || feeds.playerGameRows,
        kickoffTimestamp: kickoff,
        week,
        identityAsOf: asOf,
      }),
    };
  }
  return {
    game_id: game.id || game.gameId || null,
    season: game.season || game.year || null,
    week,
    kickoff_timestamp: kickoff,
    identity_as_of: asOf,
    identityVersion: IDENTITY_VERSION,
    maxPlayers: 6,
    roles,
  };
}
