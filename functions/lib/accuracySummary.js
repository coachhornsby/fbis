function finite(v) {
  return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

export function buildAccuracyDailySummaries(rows = [], now = new Date().toISOString()) {
  const groups = new Map();
  for (const row of rows) {
    const sport = row.sport;
    const date = row.date;
    if (!sport || !date) continue;
    const checkpoint = row.checkpoint || "FIRST_AVAILABLE";
    const modelVersion = row.modelVersion || "unknown";
    const key = `${sport}|${date}|${checkpoint}|${modelVersion}`;
    if (!groups.has(key)) groups.set(key, {
      id: key, sport, date, checkpoint, modelVersion,
      projectedN: 0, gradedN: 0, absTotalErrorSum: 0, totalBiasSum: 0,
      winnerCorrectN: 0, winnerGradedN: 0, brierSum: 0, brierN: 0, updatedAt: now,
    });
    const out = groups.get(key);
    const ph = finite(row.projHome);
    const pa = finite(row.projAway);
    if (ph == null || pa == null) continue;
    out.projectedN += 1;
    const ah = finite(row.actualHome);
    const aa = finite(row.actualAway);
    if (ah == null || aa == null) continue;
    out.gradedN += 1;
    const totalError = (ph + pa) - (ah + aa);
    out.absTotalErrorSum += Math.abs(totalError);
    out.totalBiasSum += totalError;
    if (ah !== aa && ph !== pa) {
      out.winnerGradedN += 1;
      if ((ph > pa) === (ah > aa)) out.winnerCorrectN += 1;
    }
    const p = finite(row.pHomeFinal);
    if (p != null && ah !== aa) {
      out.brierSum += (p - (ah > aa ? 1 : 0)) ** 2;
      out.brierN += 1;
    }
  }
  return [...groups.values()];
}

export function rollupAccuracySummaries(rows = []) {
  const sum = rows.reduce((a, r) => {
    for (const k of ["projected_n", "graded_n", "abs_total_error_sum", "total_bias_sum", "winner_correct_n", "winner_graded_n", "brier_sum", "brier_n"])
      a[k] += Number(r[k]) || 0;
    return a;
  }, { projected_n: 0, graded_n: 0, abs_total_error_sum: 0, total_bias_sum: 0, winner_correct_n: 0, winner_graded_n: 0, brier_sum: 0, brier_n: 0 });
  return {
    projected: sum.projected_n,
    graded: sum.graded_n,
    gradingCoverage: sum.projected_n ? sum.graded_n / sum.projected_n : null,
    maeTotal: sum.graded_n ? sum.abs_total_error_sum / sum.graded_n : null,
    biasTotal: sum.graded_n ? sum.total_bias_sum / sum.graded_n : null,
    winnerHit: sum.winner_graded_n ? sum.winner_correct_n / sum.winner_graded_n : null,
    brier: sum.brier_n ? sum.brier_sum / sum.brier_n : null,
  };
}
