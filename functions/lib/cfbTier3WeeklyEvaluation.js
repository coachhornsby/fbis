/**
 * Research-only CFB Tier 3 weekly evaluation.
 * Grades pregame features + opening spread against settled finals.
 * Never authorizes wagers or promotes projections into live boards.
 */
export const CFB_TIER3_EVAL_AUTHORITY = "research_only";

const EPS = 1e-9;

export function homeAtsResult(homeMargin, openingSpread) {
  const cover = Number(homeMargin) + Number(openingSpread);
  if (!Number.isFinite(cover)) return "unknown";
  if (Math.abs(cover) < EPS) return "push";
  return cover > 0 ? "home" : "away";
}

export function favoriteSide(openingSpread) {
  const s = Number(openingSpread);
  if (!Number.isFinite(s) || Math.abs(s) < EPS) return "pick";
  return s < 0 ? "home" : "away";
}

/** Naive research proxies — not production models. */
export function researchPredictedMargin(features = {}) {
  const elo = Number(features.home_elo) - Number(features.away_elo);
  const talent = Number(features.home_talent) - Number(features.away_talent);
  const epaOff = Number(features.home_adjusted_epa) - Number(features.away_adjusted_epa);
  const epaDef =
    Number(features.away_adjusted_epa_allowed) - Number(features.home_adjusted_epa_allowed);
  const eloMargin = Number.isFinite(elo) ? elo / 25 : null;
  const talentMargin = Number.isFinite(talent) ? talent / 40 : null;
  const epaMargin = Number.isFinite(epaOff) && Number.isFinite(epaDef) ? (epaOff + epaDef) * 50 : null;
  const parts = [eloMargin, epaMargin].filter((n) => Number.isFinite(n));
  const blend = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  return {
    eloMargin,
    talentMargin,
    epaMargin,
    blendMargin: blend,
  };
}

export function pearson(xs, ys) {
  if (!xs?.length || xs.length !== ys?.length) return null;
  const n = xs.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(xs[i]), y = Number(ys[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den < EPS ? null : num / den;
}

export function meanAbs(values) {
  const xs = values.filter((n) => Number.isFinite(n));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length;
}

/**
 * @param {object} snapshot parseCfbTier3WeeklyCsv result
 * @param {Map|Record} finalsByGameId {homePoints,awayPoints,completed?,status?}
 */
export function evaluateCfbTier3Weekly(snapshot, finalsByGameId, {edgeThresholds = [0, 3, 7, 10]} = {}) {
  if (!snapshot?.games?.length) throw Error("TIER3_EVAL_EMPTY_SNAPSHOT");
  const lookup = finalsByGameId instanceof Map
    ? finalsByGameId
    : new Map(Object.entries(finalsByGameId || {}));

  const graded = [];
  let missingFinals = 0, incomplete = 0;

  for (const game of snapshot.games) {
    const final = lookup.get(String(game.gameId));
    if (!final) { missingFinals++; continue; }
    const homePoints = Number(final.homePoints ?? final.home_points);
    const awayPoints = Number(final.awayPoints ?? final.away_points);
    const completed = final.completed !== false && Number.isFinite(homePoints) && Number.isFinite(awayPoints);
    if (!completed) { incomplete++; continue; }

    const homeMargin = homePoints - awayPoints;
    const ats = homeAtsResult(homeMargin, game.openingSpread);
    const favorite = favoriteSide(game.openingSpread);
    const su = homeMargin > 0 ? "home" : homeMargin < 0 ? "away" : "tie";
    const preds = researchPredictedMargin(game.features);
    const marketImplied = -Number(game.openingSpread);
    const edge = Number.isFinite(preds.blendMargin) && Number.isFinite(marketImplied)
      ? preds.blendMargin - marketImplied
      : null;
    const modelSide = Number.isFinite(preds.blendMargin)
      ? (preds.blendMargin + Number(game.openingSpread) > 0 ? "home" : "away")
      : null;
    const modelHit = ats === "push" || !modelSide ? null : modelSide === ats;
    const favoriteSuHit = favorite === "pick" || su === "tie" ? null : favorite === su;
    const edgeHit = ats === "push" || !Number.isFinite(edge) || Math.abs(edge) < EPS
      ? null
      : (edge > 0 && ats === "home") || (edge < 0 && ats === "away");

    graded.push({
      gameId: game.gameId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      openingSpread: game.openingSpread,
      homePoints,
      awayPoints,
      homeMargin,
      ats,
      favorite,
      su,
      favoriteSuHit,
      predictions: preds,
      marketImpliedMargin: marketImplied,
      edgeVsSpread: edge,
      modelSide,
      modelHit,
      edgeHit,
      authority: CFB_TIER3_EVAL_AUTHORITY,
    });
  }

  const decided = graded.filter((g) => g.ats !== "push");
  const homeAts = decided.filter((g) => g.ats === "home").length;
  const modelDecided = decided.filter((g) => g.modelHit != null);
  const favDecided = graded.filter((g) => g.favoriteSuHit != null);

  const edgeBuckets = edgeThresholds.map((thr) => {
    const subset = decided.filter((g) => Number.isFinite(g.edgeVsSpread) && Math.abs(g.edgeVsSpread) >= thr);
    const hits = subset.filter((g) => g.edgeHit === true).length;
    return {
      minAbsEdge: thr,
      n: subset.length,
      hitRate: subset.length ? hits / subset.length : null,
    };
  });

  const margins = graded.map((g) => g.homeMargin);
  const summary = {
    season: snapshot.season,
    week: snapshot.week,
    snapshotId: snapshot.snapshotId,
    sourceSha256: snapshot.sourceSha256,
    gamesInSnapshot: snapshot.rowCount,
    graded: graded.length,
    missingFinals,
    incomplete,
    pushes: graded.length - decided.length,
    homeAtsRate: decided.length ? homeAts / decided.length : null,
    favoriteSuRate: favDecided.length
      ? favDecided.filter((g) => g.favoriteSuHit).length / favDecided.length
      : null,
    naiveBlendAtsRate: modelDecided.length
      ? modelDecided.filter((g) => g.modelHit).length / modelDecided.length
      : null,
    correlations: {
      eloDiffVsMargin: pearson(
        graded.map((g) => (g.predictions.eloMargin ?? NaN) * 25),
        margins
      ),
      marketImpliedVsMargin: pearson(graded.map((g) => g.marketImpliedMargin), margins),
      blendVsMargin: pearson(graded.map((g) => g.predictions.blendMargin), margins),
      talentDiffVsMargin: pearson(
        graded.map((g) => (g.predictions.talentMargin ?? NaN) * 40),
        margins
      ),
    },
    mae: {
      openingSpread: meanAbs(graded.map((g) => g.homeMargin + g.openingSpread)),
      naiveBlend: meanAbs(graded.map((g) => g.homeMargin - g.predictions.blendMargin)),
    },
    edgeBuckets,
    authority: CFB_TIER3_EVAL_AUTHORITY,
    canAuthorizeWager: false,
    canInfluenceProjection: false,
    note: "Research ablation only. Opening spread is market reference; features remain source_feature_cutoff_unverified until publish proof.",
  };

  return { summary, games: graded, authority: CFB_TIER3_EVAL_AUTHORITY, canAuthorizeWager: false };
}

export function compareWeekSummaries(summaries = []) {
  return {
    weeks: summaries.map((s) => ({
      week: s.week,
      season: s.season,
      graded: s.graded,
      homeAtsRate: s.homeAtsRate,
      favoriteSuRate: s.favoriteSuRate,
      naiveBlendAtsRate: s.naiveBlendAtsRate,
      corrMarket: s.correlations?.marketImpliedVsMargin ?? null,
      corrBlend: s.correlations?.blendVsMargin ?? null,
      maeSpread: s.mae?.openingSpread ?? null,
      maeBlend: s.mae?.naiveBlend ?? null,
      edge7: s.edgeBuckets?.find((b) => b.minAbsEdge === 7) || null,
    })),
    authority: CFB_TIER3_EVAL_AUTHORITY,
    canAuthorizeWager: false,
  };
}

/** ESPN college-football summary → finals row (network optional; inject fetch for tests). */
export async function fetchEspnCfFinal(gameId, fetchFn = fetch) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${encodeURIComponent(gameId)}`;
  const res = await fetchFn(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw Error(`ESPN_FINAL_${res.status}:${gameId}`);
  const body = await res.json();
  const competition = body?.header?.competitions?.[0] || body?.competitions?.[0];
  if (!competition) throw Error(`ESPN_FINAL_MISSING:${gameId}`);
  const status = competition.status?.type || {};
  let homePoints = null, awayPoints = null, homeName = null, awayName = null;
  for (const c of competition.competitors || []) {
    const score = c.score === "" || c.score == null ? null : Number(c.score);
    if (c.homeAway === "home") {
      homePoints = Number.isFinite(score) ? score : null;
      homeName = c.team?.displayName || null;
    } else {
      awayPoints = Number.isFinite(score) ? score : null;
      awayName = c.team?.displayName || null;
    }
  }
  return {
    gameId: String(gameId),
    homePoints,
    awayPoints,
    homeName,
    awayName,
    completed: Boolean(status.completed) && homePoints != null && awayPoints != null,
    status: status.name || null,
    source: "espn-public-summary",
  };
}

export async function fetchEspnCfFinals(gameIds, { concurrency = 8, fetchFn = fetch } = {}) {
  const ids = [...new Set(gameIds.map(String))];
  const out = new Map();
  let i = 0;
  async function worker() {
    while (i < ids.length) {
      const idx = i++;
      const id = ids[idx];
      try {
        out.set(id, await fetchEspnCfFinal(id, fetchFn));
      } catch (err) {
        out.set(id, { gameId: id, completed: false, error: String(err?.message || err) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
  return out;
}
