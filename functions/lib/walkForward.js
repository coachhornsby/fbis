function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

export function scorePredictionRows(rows = [], modelKey) {
  const scored = [];
  let leakageN = 0;
  for (const row of rows) {
    const pred = row.models?.[modelKey];
    const ph = num(pred?.home);
    const pa = num(pred?.away);
    const ah = num(row.actualHome);
    const aa = num(row.actualAway);
    const cutoff = Date.parse(row.featureCutoff || "");
    const start = Date.parse(row.start || "");
    if (Number.isFinite(cutoff) && Number.isFinite(start) && cutoff > start) { leakageN += 1; continue; }
    if ([ph, pa, ah, aa].some((v) => v == null)) continue;
    const pHome = num(pred?.pHome);
    scored.push({
      season: Number(row.season), totalError: ph + pa - ah - aa,
      marginError: ph - pa - (ah - aa), winnerCorrect: ph === pa || ah === aa ? null : (ph > pa) === (ah > aa),
      brier: pHome == null || ah === aa ? null : (pHome - (ah > aa ? 1 : 0)) ** 2,
    });
  }
  const absTotal = scored.map((r) => Math.abs(r.totalError));
  const absMargin = scored.map((r) => Math.abs(r.marginError));
  const winner = scored.map((r) => r.winnerCorrect).filter((v) => v != null);
  const brier = scored.map((r) => r.brier).filter((v) => v != null);
  return {
    n: scored.length, seasons: [...new Set(scored.map((r) => r.season).filter(Number.isFinite))].sort(), leakageN,
    maeTotal: mean(absTotal), maeMargin: mean(absMargin),
    rmseTotal: scored.length ? Math.sqrt(mean(scored.map((r) => r.totalError ** 2))) : null,
    biasTotal: mean(scored.map((r) => r.totalError)),
    winnerHit: winner.length ? winner.filter(Boolean).length / winner.length : null,
    brier: mean(brier),
  };
}

export function walkForwardValidation(rows = [], { champion = "champion", challenger = "enriched", ablations = [] } = {}) {
  const ordered = [...rows].sort((a, b) => String(a.start || a.date).localeCompare(String(b.start || b.date)));
  const seasons = [...new Set(ordered.map((r) => Number(r.season)).filter(Number.isFinite))].sort();
  const folds = [];
  for (let i = 1; i < seasons.length; i++) {
    const testSeason = seasons[i];
    const trainSeasons = seasons.slice(0, i);
    const test = ordered.filter((r) => Number(r.season) === testSeason);
    folds.push({ testSeason, trainSeasons, n: test.length, champion: scorePredictionRows(test, champion), challenger: scorePredictionRows(test, challenger) });
  }
  const championMetrics = scorePredictionRows(ordered.filter((r) => seasons.indexOf(Number(r.season)) > 0), champion);
  const challengerMetrics = scorePredictionRows(ordered.filter((r) => seasons.indexOf(Number(r.season)) > 0), challenger);
  const ablationMetrics = Object.fromEntries(ablations.map((key) => [key, scorePredictionRows(ordered.filter((r) => seasons.indexOf(Number(r.season)) > 0), key)]));
  const improvement = championMetrics.maeTotal != null && challengerMetrics.maeTotal != null ? championMetrics.maeTotal - challengerMetrics.maeTotal : null;
  return {
    method: "rolling-origin-season-holdout", generatedAt: new Date().toISOString(), seasons, folds,
    champion: championMetrics, challenger: challengerMetrics, ablations: ablationMetrics,
    maeTotalImprovement: improvement,
    leakageOk: challengerMetrics.leakageN === 0,
    sufficient: challengerMetrics.n >= 400 && challengerMetrics.seasons.length >= 2 && seasons.length >= 3,
  };
}
