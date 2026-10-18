/**
 * Leakage-safe rolling-origin walk-forward scaffold for CFB challengers.
 * Fits/evaluates only on training windows; never uses Oct-17 outcomes to select coeffs.
 * Research-only — does not promote models or authorize wagers.
 */

import { projectModelA, projectModelB, projectModelC, projectModelD } from "./cfbCurrentSeasonChallengers.js";
import { scoreErrors } from "./cfbOct17Replay.js";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Partition games by season/week for rolling-origin evaluation.
 * @param {Array<{season:number, week:number, game:object, actualHome:number, actualAway:number}>} games
 * @param {{minTrainGames?:number, holdoutWeeks?:number}} [opts]
 */
export function buildRollingOriginFolds(games = [], { minTrainGames = 40, holdoutWeeks = 1 } = {}) {
  const sorted = [...games].sort((a, b) => {
    const sa = Number(a.season) - Number(b.season);
    if (sa !== 0) return sa;
    return Number(a.week) - Number(b.week);
  });
  const folds = [];
  const weekKeys = [...new Set(sorted.map((g) => `${g.season}-W${g.week}`))];
  for (let i = 0; i < weekKeys.length; i += 1) {
    const testKey = weekKeys[i];
    const train = sorted.filter((g) => {
      const k = `${g.season}-W${g.week}`;
      return k < testKey;
    });
    const test = sorted.filter((g) => `${g.season}-W${g.week}` === testKey);
    if (train.length < minTrainGames || test.length === 0) continue;
    // holdoutWeeks reserved for future multi-week test blocks
    void holdoutWeeks;
    folds.push({
      testKey,
      trainN: train.length,
      testN: test.length,
      train,
      test,
    });
  }
  return folds;
}

function projectById(id, game, opts = {}) {
  if (id === "A") return projectModelA(game);
  if (id === "B") return projectModelB(game, opts);
  if (id === "C") return projectModelC(game, opts);
  if (id === "D") return projectModelD(game);
  return { ok: false, reason: "unknown-model" };
}

/**
 * Evaluate challengers on a single fold's test set.
 * Does not refit ridge coefficients here — uses production fitted package + research shrinkK.
 * Documented: a full coefficient refit requires historical feature archives with PIT as_of.
 */
export function evaluateFold(fold, { models = ["A", "B", "D"], coreArtifact = null } = {}) {
  const byModel = {};
  for (const id of models) {
    const rows = [];
    for (const g of fold.test || []) {
      const proj = projectById(id, g.game, { coreArtifact });
      if (!proj?.ok) {
        rows.push({ gameId: g.game?.id, ok: false, reason: proj?.reason || "projection-failed" });
        continue;
      }
      const err = scoreErrors(proj.home, proj.away, g.actualHome, g.actualAway);
      rows.push({
        gameId: g.game?.id,
        ok: true,
        home: proj.home,
        away: proj.away,
        error: err,
      });
    }
    const graded = rows.filter((r) => r.ok && r.error?.graded);
    const mae = (field) => {
      const vals = graded.map((r) => r.error[field]).filter((v) => v != null);
      if (!vals.length) return null;
      return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
    };
    const winner = graded.filter((r) => r.error.winnerCorrect).length;
    byModel[id] = {
      nGraded: graded.length,
      nFailed: rows.filter((r) => !r.ok).length,
      winnerPct: graded.length ? round2((100 * winner) / graded.length) : null,
      marginMae: mae("marginError"),
      totalMae: mae("totalError"),
      homeMae: mae("homeError"),
      awayMae: mae("awayError"),
      biasHome: (() => {
        const vals = graded.map((r) => r.error.biasHome).filter((v) => v != null);
        return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
      })(),
    };
  }
  return {
    testKey: fold.testKey,
    trainN: fold.trainN,
    testN: fold.testN,
    byModel,
    note: "Uses locked production ridge + research shrinkK; not a full OOS coefficient refit",
  };
}

/**
 * Summarize walk-forward across folds. Model C reported only when artifact present.
 */
export function summarizeWalkForward(foldResults = [], { coreArtifactAvailable = false } = {}) {
  const models = new Set();
  for (const f of foldResults) {
    Object.keys(f.byModel || {}).forEach((m) => models.add(m));
  }
  const summary = {};
  for (const id of models) {
    const parts = foldResults.map((f) => f.byModel?.[id]).filter(Boolean);
    const weighted = (field) => {
      let numSum = 0;
      let den = 0;
      for (const p of parts) {
        if (p[field] == null || !p.nGraded) continue;
        numSum += p[field] * p.nGraded;
        den += p.nGraded;
      }
      return den ? round2(numSum / den) : null;
    };
    summary[id] = {
      folds: parts.length,
      totalGraded: parts.reduce((a, p) => a + (p.nGraded || 0), 0),
      winnerPct: weighted("winnerPct"),
      marginMae: weighted("marginMae"),
      totalMae: weighted("totalMae"),
      homeMae: weighted("homeMae"),
      awayMae: weighted("awayMae"),
      biasHome: weighted("biasHome"),
    };
  }
  return {
    summary,
    foldCount: foldResults.length,
    coreIncrementalValue: coreArtifactAvailable
      ? "evaluated-when-Model-C-included"
      : "UNPROVEN — fitted CORE OOS artifact unavailable; Model C fails closed",
    authority: "research_only",
    canPromote: false,
    canAuthorizeWager: false,
  };
}

/**
 * Systematic error slice: weak offenses (ppaOff < 0) home overprojection bias.
 */
export function analyzeSystematicSlices(rows = []) {
  const weakOffHome = rows.filter((r) => num(r.homePpaOff) != null && r.homePpaOff < 0 && r.error?.graded);
  const strongDefHome = rows.filter((r) => num(r.homePpaDef) != null && r.homePpaDef < -0.05 && r.error?.graded);
  const meanBias = (list) => {
    if (!list.length) return null;
    return round2(list.reduce((a, r) => a + r.error.biasHome, 0) / list.length);
  };
  return {
    weakOffenseHomeOverprojection: {
      n: weakOffHome.length,
      meanHomeBias: meanBias(weakOffHome),
      hypothesis: "Negative current PPA offenses with strong 2025 priors remain inflated under k=6",
    },
    strongDefenseHomeBias: {
      n: strongDefHome.length,
      meanHomeBias: meanBias(strongDefHome),
      hypothesis: "Strong defenses (low PPA allowed) may still see high projected points against them when opponent priors dominate",
    },
    classification: "model-calibration patterns; do not retune from a single slate",
  };
}
