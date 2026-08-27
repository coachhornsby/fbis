/**
 * Pal-style projection accuracy: bias AND error magnitude, by model and slice.
 */

import { CHECKPOINTS } from "./checkpoints.js";
import { brierScore, logLoss } from "./pricing.js";
import { withinBands } from "./metrics.js";

function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}

function sum(xs) {
  return xs.reduce((s, n) => s + n, 0);
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function emptyMetric() {
  return {
    n: 0,
    actual: null,
    projected: null,
    diff: null,
    pctDiff: null,
    mae: null,
    median: null,
    medianAbs: null,
    rmse: null,
    bias: null,
  };
}

export function seriesStats(pairs, perGame = true) {
  const xs = (pairs || []).filter((p) => p.actual != null && p.proj != null && Number.isFinite(p.actual) && Number.isFinite(p.proj));
  const n = xs.length;
  if (!n) return emptyMetric();
  const actualSum = sum(xs.map((p) => p.actual));
  const projSum = sum(xs.map((p) => p.proj));
  const errs = xs.map((p) => p.proj - p.actual);
  const abs = errs.map(Math.abs);
  return {
    n,
    actual: perGame ? actualSum / n : actualSum,
    projected: perGame ? projSum / n : projSum,
    diff: perGame ? (projSum - actualSum) / n : projSum - actualSum,
    pctDiff: actualSum !== 0 ? (projSum - actualSum) / actualSum : null,
    mae: mean(abs),
    median: median(errs),
    medianAbs: median(abs),
    rmse: Math.sqrt(mean(errs.map((e) => e ** 2))),
    bias: mean(errs),
  };
}

function share(errs, thr) {
  if (!errs.length) return null;
  return errs.filter((e) => Math.abs(e) <= thr).length / errs.length;
}

function ensembleHome(r) {
  if (r.projHome != null && r.palHome != null) return (r.projHome + r.palHome) / 2;
  return r.projHome ?? r.palHome ?? null;
}

function ensembleAway(r) {
  if (r.projAway != null && r.palAway != null) return (r.projAway + r.palAway) / 2;
  return r.projAway ?? r.palAway ?? null;
}

export const MODEL_GETTERS = {
  ensemble: {
    home: ensembleHome,
    away: ensembleAway,
    pHome: (r) => r.pHomeFinal ?? r.pHome,
  },
  proprietary: {
    home: (r) => r.projHome,
    away: (r) => r.projAway,
    pHome: (r) => r.pScore,
  },
  pal: {
    home: (r) => r.palHome,
    away: (r) => r.palAway,
    pHome: (r) => r.pPal ?? r.palPHome,
  },
  savant: {
    home: (r) => r.projHome,
    away: (r) => r.projAway,
    pHome: (r) => r.pScore,
  },
  market: {
    home: () => null,
    away: () => null,
    pHome: (r) => r.impliedHome ?? r.pMarket,
  },
};

export function gradedRows(rows) {
  return (rows || []).filter((r) => r.actualHome != null && r.actualAway != null);
}

function pairsFor(rows, getHome, getAway, kind) {
  const out = [];
  for (const r of rows) {
    const ah = r.actualHome;
    const aa = r.actualAway;
    const ph = getHome(r);
    const pa = getAway(r);
    if (kind === "home" && ph != null && ah != null) out.push({ actual: ah, proj: ph, row: r });
    else if (kind === "away" && pa != null && aa != null) out.push({ actual: aa, proj: pa, row: r });
    else if (kind === "total" && ph != null && pa != null && ah != null && aa != null) {
      out.push({ actual: ah + aa, proj: ph + pa, row: r });
    } else if (kind === "margin" && ph != null && pa != null && ah != null && aa != null) {
      out.push({ actual: ah - aa, proj: ph - pa, row: r });
    } else if (kind === "f5") {
      const afh = r.f5ActualHome;
      const afa = r.f5ActualAway;
      const pfh = r.f5Home ?? r.palF5Home;
      const pfa = r.f5Away ?? r.palF5Away;
      if (afh != null && afa != null && pfh != null && pfa != null) {
        out.push({ actual: afh + afa, proj: pfh + pfa, row: r });
      }
    } else if (kind === "team") {
      if (ph != null && ah != null) out.push({ actual: ah, proj: ph, row: r });
      if (pa != null && aa != null) out.push({ actual: aa, proj: pa, row: r });
    }
  }
  return out;
}

export function projectionTable(rows, model = "ensemble", perGame = true) {
  const get = MODEL_GETTERS[model] || MODEL_GETTERS.ensemble;
  const graded = gradedRows(rows);
  const home = seriesStats(pairsFor(graded, get.home, get.away, "home"), perGame);
  const away = seriesStats(pairsFor(graded, get.home, get.away, "away"), perGame);
  const total = seriesStats(pairsFor(graded, get.home, get.away, "total"), perGame);
  const margin = seriesStats(pairsFor(graded, get.home, get.away, "margin"), perGame);
  const f5 = seriesStats(pairsFor(graded, get.home, get.away, "f5"), perGame);
  const team = seriesStats(pairsFor(graded, get.home, get.away, "team"), perGame);
  const homeBias = home.pctDiff;
  const awayBias = away.pctDiff;
  const headline = {
    n: total.n,
    actualRuns: perGame ? total.actual : total.actual,
    projectedRuns: total.projected,
    diff: total.diff,
    pctDiff: total.pctDiff,
    homeBias,
    awayBias,
    median: total.median,
    medianAbs: total.medianAbs,
    mae: total.mae,
    rmse: total.rmse,
  };
  return {
    headline,
    rows: [
      { key: "home", label: "Home runs", ...home },
      { key: "away", label: "Away runs", ...away },
      { key: "total", label: "Total runs", ...total },
      { key: "margin", label: "Run margin", ...margin },
      { key: "team", label: "Team score", ...team },
      { key: "f5", label: "F5 total", ...f5 },
    ],
  };
}

export function errorDistribution(rows, model = "ensemble", sport = null) {
  const get = MODEL_GETTERS[model] || MODEL_GETTERS.ensemble;
  const graded = gradedRows(rows);
  const id = sport || graded[0]?.sport || "mlb";
  const tot = pairsFor(graded, get.home, get.away, "total").map((p) => p.proj - p.actual);
  const team = pairsFor(graded, get.home, get.away, "team").map((p) => p.proj - p.actual);
  const mgn = pairsFor(graded, get.home, get.away, "margin").map((p) => p.proj - p.actual);
  const total = withinBands(tot, id, "total");
  const teamB = withinBands(team, id, "team");
  const margin = withinBands(mgn, id, "margin");
  return {
    sport: id,
    total: { n: tot.length, within05: total.within05 ?? null, within1: total.within1 ?? null, within2: total.within2 ?? null, within3: total.within3 ?? null, within4: total.within4 ?? null, bands: total.bands },
    team: { n: team.length, within05: teamB.within05 ?? null, within1: teamB.within1 ?? null, within2: teamB.within2 ?? null, bands: teamB.bands },
    margin: { n: mgn.length, within1: margin.within1 ?? null, within2: margin.within2 ?? null, within3: margin.within3 ?? null, bands: margin.bands },
  };
}

export function modelComparison(rows) {
  const graded = gradedRows(rows);
  const block = (key, label) => {
    const get = MODEL_GETTERS[key];
    const tot = seriesStats(pairsFor(graded, get.home, get.away, "total"), true);
    const team = seriesStats(pairsFor(graded, get.home, get.away, "team"), true);
    const mgn = seriesStats(pairsFor(graded, get.home, get.away, "margin"), true);
    const pRows = graded.filter((r) => get.pHome(r) != null && r.actualHome !== r.actualAway);
    const brier = pRows.length
      ? mean(pRows.map((r) => brierScore(get.pHome(r), r.actualHome > r.actualAway ? 1 : 0)))
      : null;
    const ll = pRows.length
      ? mean(pRows.map((r) => logLoss(get.pHome(r), r.actualHome > r.actualAway ? 1 : 0)))
      : null;
    const winner = pRows.length
      ? pRows.filter((r) => (get.pHome(r) > 0.5) === (r.actualHome > r.actualAway)).length / pRows.length
      : null;
    return {
      key,
      label,
      n: tot.n || team.n || pRows.length,
      unavailable: key === "pal" && !(tot.n || team.n || pRows.length),
      maeTotal: tot.n || team.n ? tot.mae : null,
      maeTeam: team.n ? team.mae : null,
      maeMargin: mgn.n ? mgn.mae : null,
      rmse: tot.n ? tot.rmse : null,
      bias: tot.n ? tot.bias : null,
      brier,
      logLoss: ll,
      winnerHit: winner,
    };
  };
  return [
    block("pal", "Ballpark Pal"),
    block("proprietary", "FBIS Proprietary"),
    block("ensemble", "FBIS Ensemble"),
    block("market", "Pinnacle"),
  ];
}

function groupTable(rows, model, keyFn, labelFn) {
  const get = MODEL_GETTERS[model] || MODEL_GETTERS.ensemble;
  const map = new Map();
  for (const r of gradedRows(rows)) {
    const keys = keyFn(r);
    for (const k of keys) {
      if (!k) continue;
      if (!map.has(k.key)) map.set(k.key, { key: k.key, label: labelFn ? labelFn(k) : k.key, rows: [] });
      map.get(k.key).rows.push(k.row || r);
    }
  }
  return [...map.values()]
    .map((g) => {
      const tot = seriesStats(pairsFor(g.rows, get.home, get.away, "total"), true);
      const team = seriesStats(pairsFor(g.rows, get.home, get.away, "team"), true);
      const pRows = g.rows.filter((r) => get.pHome(r) != null && r.actualHome !== r.actualAway);
      const brier = pRows.length
        ? mean(pRows.map((r) => brierScore(get.pHome(r), r.actualHome > r.actualAway ? 1 : 0)))
        : null;
      return {
        key: g.key,
        label: g.label,
        n: tot.n || g.rows.length,
        actual: tot.actual,
        projected: tot.projected,
        bias: tot.bias,
        pctDiff: tot.pctDiff,
        mae: tot.mae,
        maeTeam: team.mae,
        maeMargin: seriesStats(pairsFor(g.rows, get.home, get.away, "margin"), true).mae,
        brier,
      };
    })
    .sort((a, b) => (b.n || 0) - (a.n || 0));
}

function monthKey(date) {
  if (!date) return null;
  const [y, m] = String(date).split("-");
  return `${y}-${m}`;
}

function monthLabel(ym) {
  const [y, m] = String(ym).split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1] || m} ${y}`;
}

export function breakdowns(rows, model = "ensemble") {
  const graded = gradedRows(rows);
  const teamRpg = [...new Map(graded.flatMap((r) => {
    const out = [];
    if (r.homeAbbr) out.push([r.homeAbbr, r]);
    if (r.awayAbbr) out.push([r.awayAbbr, r]);
    return out;
  })).keys()].map((abbr) => {
    const homeG = graded.filter((r) => r.homeAbbr === abbr);
    const awayG = graded.filter((r) => r.awayAbbr === abbr);
    const get = MODEL_GETTERS[model] || MODEL_GETTERS.ensemble;
    const pairs = [
      ...homeG.filter((r) => get.home(r) != null).map((r) => ({ actual: r.actualHome, proj: get.home(r) })),
      ...awayG.filter((r) => get.away(r) != null).map((r) => ({ actual: r.actualAway, proj: get.away(r) })),
    ];
    const st = seriesStats(pairs, true);
    return { key: abbr, label: abbr, n: st.n, actual: st.actual, projected: st.projected, bias: st.bias, mae: st.mae, pctDiff: st.pctDiff };
  }).sort((a, b) => (b.n || 0) - (a.n || 0));

  const byPark = groupTable(graded, model, (r) => (r.park ? [{ key: r.park }] : []));
  const byStarter = groupTable(graded, model, (r) => {
    const items = [];
    if (r.homeSp) items.push({ key: r.homeSp, row: { ...r, projHome: r.projAway, palHome: r.palAway, actualHome: r.actualAway, actualAway: 0, palAway: 0, projAway: 0 } });
    if (r.awaySp) items.push({ key: r.awaySp, row: { ...r } });
    return items;
  });
  const starterRpg = [];
  const get = MODEL_GETTERS[model] || MODEL_GETTERS.ensemble;
  const spMap = new Map();
  for (const r of graded) {
    if (r.homeSp) {
      const projOpp = get.away(r);
      if (projOpp != null) {
        if (!spMap.has(r.homeSp)) spMap.set(r.homeSp, []);
        spMap.get(r.homeSp).push({ actual: r.actualAway, proj: projOpp });
      }
    }
    if (r.awaySp) {
      const projOpp = get.home(r);
      if (projOpp != null) {
        if (!spMap.has(r.awaySp)) spMap.set(r.awaySp, []);
        spMap.get(r.awaySp).push({ actual: r.actualHome, proj: projOpp });
      }
    }
  }
  for (const [name, pairs] of spMap) {
    const st = seriesStats(pairs, true);
    starterRpg.push({ key: name, label: name, n: st.n, actual: st.actual, projected: st.projected, bias: st.bias, mae: st.mae });
  }
  starterRpg.sort((a, b) => (b.n || 0) - (a.n || 0));

  const byMonth = groupTable(graded, model, (r) => {
    const k = monthKey(r.date);
    return k ? [{ key: k }] : [];
  }).map((row) => ({ ...row, label: monthLabel(row.key) }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const byDay = groupTable(graded, model, (r) => (r.date ? [{ key: r.date }] : []))
    .sort((a, b) => String(b.key).localeCompare(String(a.key)));

  const byHomeAway = [
    { key: "home", label: "Home", ...seriesStats(pairsFor(graded, get.home, get.away, "home"), true) },
    { key: "away", label: "Away", ...seriesStats(pairsFor(graded, get.home, get.away, "away"), true) },
  ];

  const byVersion = groupTable(graded, model, (r) => (r.modelVersion ? [{ key: r.modelVersion }] : []));
  const byCheckpoint = CHECKPOINTS.map((cp) => {
    const xs = graded.filter((r) => r.checkpoint === cp);
    const tot = seriesStats(pairsFor(xs, get.home, get.away, "total"), true);
    const mgn = seriesStats(pairsFor(xs, get.home, get.away, "margin"), true);
    const pRows = xs.filter((r) => get.pHome(r) != null && r.actualHome !== r.actualAway);
    const brier = pRows.length
      ? mean(pRows.map((r) => brierScore(get.pHome(r), r.actualHome > r.actualAway ? 1 : 0)))
      : null;
    return { key: cp, label: cp, n: tot.n, mae: tot.mae, maeMargin: mgn.mae, bias: tot.bias, brier };
  });

  const fav = graded.filter((r) => (r.pHomeFinal ?? r.pHome ?? 0.5) >= 0.5);
  const dog = graded.filter((r) => (r.pHomeFinal ?? r.pHome ?? 0.5) < 0.5);
  const totVals = graded.map((r) => (get.home(r) ?? 0) + (get.away(r) ?? 0)).filter((n) => n > 0);
  const medTot = median(totVals);
  const high = medTot == null ? [] : graded.filter((r) => (get.home(r) ?? 0) + (get.away(r) ?? 0) >= medTot);
  const low = medTot == null ? [] : graded.filter((r) => (get.home(r) ?? 0) + (get.away(r) ?? 0) < medTot);

  const biasSlices = [
    { key: "home", label: "Home projections", ...seriesStats(pairsFor(graded, get.home, get.away, "home"), true) },
    { key: "away", label: "Away projections", ...seriesStats(pairsFor(graded, get.home, get.away, "away"), true) },
    { key: "overall", label: "Overall totals", ...seriesStats(pairsFor(graded, get.home, get.away, "total"), true) },
    { key: "favorites", label: "Favorites (p≥50%)", ...seriesStats(pairsFor(fav, get.home, get.away, "total"), true) },
    { key: "dogs", label: "Underdogs (p<50%)", ...seriesStats(pairsFor(dog, get.home, get.away, "total"), true) },
    { key: "high", label: "High totals", ...seriesStats(pairsFor(high, get.home, get.away, "total"), true) },
    { key: "low", label: "Low totals", ...seriesStats(pairsFor(low, get.home, get.away, "total"), true) },
  ];

  const sorted = [...graded].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start || "").localeCompare(String(b.start || "")));
  const rolling = [];
  const window = 50;
  for (let i = 0; i < sorted.length; i++) {
    if (i + 1 < Math.min(window, 20)) continue;
    const slice = sorted.slice(Math.max(0, i + 1 - window), i + 1);
    const tot = seriesStats(pairsFor(slice, get.home, get.away, "total"), true);
    const pRows = slice.filter((r) => get.pHome(r) != null && r.actualHome !== r.actualAway);
    const brier = pRows.length
      ? mean(pRows.map((r) => brierScore(get.pHome(r), r.actualHome > r.actualAway ? 1 : 0)))
      : null;
    rolling.push({ date: sorted[i].date, n: slice.length, mae: tot.mae, brier });
  }

  const byWeek = groupTable(graded, model, (r) => (r.week != null ? [{ key: `W${r.week}` }] : []));
  const byConference = groupTable(graded, model, (r) => (r.conference ? [{ key: String(r.conference) }] : []));
  const byFavDog = [
    { key: "favorite", label: "Favorites", ...seriesStats(pairsFor(fav, get.home, get.away, "total"), true) },
    { key: "underdog", label: "Underdogs", ...seriesStats(pairsFor(dog, get.home, get.away, "total"), true) },
  ];
  const spreadRange = groupTable(graded, model, (r) => {
    const sp = r.pinSpread ?? r.spread;
    if (sp == null) return [];
    const a = Math.abs(Number(sp));
    const key = a < 3.5 ? "spread < 3.5" : a < 10.5 ? "spread 3.5–10.5" : "spread > 10.5";
    return [{ key }];
  });
  const totalRange = groupTable(graded, model, (r) => {
    const t = r.pinTotal ?? r.projTotal;
    if (t == null) return [];
    const key = t < 45 ? "total < 45" : t < 55 ? "total 45–55" : "total > 55";
    return [{ key }];
  });
  const byUncertainty = groupTable(graded, model, (r) => {
    const u = r.uncertainty?.maturity ?? r.dataQuality;
    if (u == null) return [];
    const key = Number(u) < 0.35 || Number(u) < 40 ? "high uncertainty" : Number(u) < 0.7 || Number(u) < 70 ? "medium uncertainty" : "low uncertainty";
    return [{ key }];
  });

  return {
    team: teamRpg,
    park: byPark,
    starter: starterRpg,
    month: byMonth,
    day: byDay,
    homeAway: byHomeAway,
    version: byVersion,
    checkpoint: byCheckpoint,
    biasSlices,
    rolling,
    week: byWeek,
    conference: byConference,
    favDog: byFavDog,
    spreadRange,
    totalRange,
    uncertainty: byUncertainty,
  };
}

export function buildAccuracyPack(rows, { model = "ensemble", perGame = true, sport = null } = {}) {
  return {
    table: projectionTable(rows, model, perGame),
    distribution: errorDistribution(rows, model, sport),
    models: modelComparison(rows),
    breakdowns: breakdowns(rows, model),
  };
}
