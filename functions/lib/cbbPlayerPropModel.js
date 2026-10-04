/**
 * CBB-PLAYER-PROP-v1 research model.
 *
 * Initial target markets: points, rebounds, assists. Market lines are never
 * model inputs. Projection requires a stable minutes/usage profile and an
 * independent FBIS game environment.
 */
function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round1(v) { return Math.round(v * 10) / 10; }

function projectionRow(player, market, value, sigma, q) {
  return {
    playerId: player.id ?? null,
    playerName: player.name ?? null,
    team: player.team ?? null,
    position: player.position ?? null,
    market,
    fbisProjection: round1(value),
    fbisSigma: round1(sigma),
    dataQuality: Math.round(q * 100) / 100,
    roleConfidence: finite(player.roleConfidence),
    source: "CBB-PLAYER-PROP-v1",
    maturity: "RESEARCH",
    independent: true,
    marketInformed: false,
    canQualify: false,
  };
}

export function projectCbbPlayerProps(game = {}, players = []) {
  const possessions = finite(game.projectedPossessions ?? game.possessions);
  const teamPoints = game.teamProjectedPoints || {};
  if (possessions == null || possessions <= 0) {
    return { ok: false, state: "MISSING_GAME_ENVIRONMENT", rows: [] };
  }

  const rows = [];
  for (const p of players || []) {
    const minutes = finite(p.projectedMinutes ?? p.minutes);
    const basePoss = finite(p.teamBaselinePossessions) ?? 70;
    const basePts = finite(p.teamBaselinePoints) ?? 72;
    const teamProj = finite(teamPoints[p.team]) ?? basePts;
    const pts40 = finite(p.pointsPer40);
    const reb40 = finite(p.reboundsPer40);
    const ast40 = finite(p.assistsPer40);
    const sample = finite(p.sampleSize) ?? 0;
    const role = finite(p.roleConfidence) ?? 0.5;
    if (minutes == null || minutes < 8 || [pts40, reb40, ast40].every((v) => v == null)) continue;

    const paceFactor = clamp(possessions / Math.max(basePoss, 1), 0.82, 1.18);
    const scoringFactor = clamp(teamProj / Math.max(basePts, 1), 0.78, 1.24);
    const oppPts = clamp(finite(p.opponentPointsFactor) ?? 1, 0.82, 1.18);
    const oppReb = clamp(finite(p.opponentReboundFactor) ?? 1, 0.82, 1.18);
    const oppAst = clamp(finite(p.opponentAssistFactor) ?? 1, 0.82, 1.18);
    const q = clamp(0.45 * role + 0.35 * Math.min(sample / 8, 1) + 0.20 * Math.min(minutes / 32, 1), 0, 1);
    const minuteShare = minutes / 40;

    if (pts40 != null) {
      const mean = pts40 * minuteShare * paceFactor * scoringFactor * oppPts;
      rows.push(projectionRow(p, "points", mean, Math.max(2.6, mean * 0.34), q));
    }
    if (reb40 != null) {
      const mean = reb40 * minuteShare * paceFactor * oppReb;
      rows.push(projectionRow(p, "rebounds", mean, Math.max(1.8, mean * 0.38), q));
    }
    if (ast40 != null) {
      const mean = ast40 * minuteShare * paceFactor * scoringFactor * oppAst;
      rows.push(projectionRow(p, "assists", mean, Math.max(1.4, mean * 0.42), q));
    }
  }

  return {
    ok: rows.length > 0,
    modelId: "CBB-PLAYER-PROP-v1",
    state: rows.length ? "RESEARCH_READY" : "NO_MODELABLE_PLAYERS",
    independent: true,
    marketInformed: false,
    rows,
  };
}
