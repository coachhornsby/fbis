/**
 * SOCCER-FBIS-v2 — causal, market-free soccer challenger + ensemble.
 *
 * This module does not scrape or depend on third-party market prices.
 * It consumes canonical match history already persisted by FBIS.
 * Optional advanced fields (xG, PPDA, deep completions, expected points)
 * are used only when a rights-cleared upstream feed has populated them.
 *
 * Architecture:
 *   1) SOCCER-FBIS-v1 Dixon-Coles structural model
 *   2) Causal online multinomial classifier using pre-match state only
 *   3) Reliability-weighted probability ensemble
 *
 * The online classifier is intentionally lightweight so production can rebuild
 * its state from bounded canonical history without a separate model-serving
 * dependency. Every update occurs after the historical match prediction.
 */
import { projectSoccerFromHistory, soccerConfidencePick, SOCCER_LEAGUES } from "./soccerFbisV1.js";
import { loadSoccerMatchHistory } from "./store.js";
import { loadPitchApiHistory, pitchApiHistoryToGames } from "./soccerPitchApiStore.js";

export const SOCCER_FBIS_V2_ID = "SOCCER-FBIS-v2";
export const SOCCER_FBIS_V2_VERSION = "research-v1-elo-context-online-ensemble";

export const SOCCER_V2_LEAGUE_VALIDATION = Object.freeze({
  "eng.1": Object.freeze({ n:1123, accuracy:0.5084594835262689, brier:0.1994670323709335, logLoss:1.0036071563596225, ece:0.01261252327373506 }),
  "esp.1": Object.freeze({ n:1141, accuracy:0.5030674846625767, brier:0.19558366132771868, logLoss:0.9845823469125083, ece:0.020321648612440006 }),
  "ger.1": Object.freeze({ n:888, accuracy:0.5112612612612613, brier:0.19902569946143653, logLoss:1.002476450736939, ece:0.02738841916872229 }),
  "ita.1": Object.freeze({ n:1125, accuracy:0.536, brier:0.19753388349575315, logLoss:0.9919579010121115, ece:0.012394541894685647 }),
  "fra.1": Object.freeze({ n:896, accuracy:0.5044642857142857, brier:0.20109299817092427, logLoss:1.0075524858880718, ece:0.009660522209552908 }),
  "usa.1": Object.freeze({ n:1927, accuracy:0.4644525168655942, brier:0.21273114461587123, logLoss:1.0602652422097587, ece:0.013336669286461949 }),
  "usa.nwsl": Object.freeze({ n:659, accuracy:0.48558421851289835, brier:0.20708780724009396, logLoss:1.0338034656966866, ece:0.017534927961223946 }),
});


const CFG = Object.freeze({
  eloStart: 1500,
  eloK: 20,
  eloHomeAdv: 65,
  formWindow: 5,
  venueWindow: 10,
  minHistoryMatches: 40,
  minTeamMatches: 6,
  learningRate: 0.035,
  l2: 0.0008,
  baseV1Weight: 0.68,
  advancedBonusWeight: 0.08,
  minV1Weight: 0.55,
  maxV1Weight: 0.82,
  restCapDays: 21,
  featureClip: 3.5,
});

const FEATURE_NAMES = Object.freeze([
  "elo_diff",
  "s2d_ppg_diff",
  "s2d_gf_diff",
  "s2d_ga_diff",
  "form_ppg_diff",
  "form_gf_diff",
  "form_ga_diff",
  "venue_ppg_diff",
  "venue_gf_diff",
  "venue_ga_diff",
  "rest_diff",
  "sot_diff",
  "possession_diff",
  "xg_diff",
  "xga_diff",
  "ppda_diff",
  "deep_diff",
  "xpoints_diff",
]);

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v)));
}
function round(v, d = 4) {
  const p = 10 ** d;
  return Math.round(Number(v) * p) / p;
}
function iso(v) {
  return String(v || "").slice(0, 10);
}
function daysBetween(a, b) {
  const x = Date.parse(iso(a) + "T12:00:00Z");
  const y = Date.parse(iso(b) + "T12:00:00Z");
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (y - x) / 86400000;
}
function key(team = {}) {
  if (team.teamKey) return String(team.teamKey);
  if (team.espnId != null) return `id:${team.espnId}`;
  if (team.id != null) return `id:${team.id}`;
  if (team.abbr) return `abbr:${String(team.abbr).toUpperCase()}`;
  return `name:${String(team.name || team.displayName || "").toLowerCase()}`;
}
function keys(team = {}) {
  return [...new Set([
    team.teamKey ? String(team.teamKey) : null,
    team.espnId != null ? `id:${team.espnId}` : null,
    team.id != null ? `id:${team.id}` : null,
    team.abbr ? `abbr:${String(team.abbr).toUpperCase()}` : null,
    (team.name || team.displayName) ? `name:${String(team.name || team.displayName).toLowerCase()}` : null,
  ].filter(Boolean))];
}
function findByAliases(map, team) {
  for (const k of keys(team)) {
    if (map.has(k)) return map.get(k);
  }
  return null;
}
function setAliases(map, team, value) {
  for (const k of keys(team)) map.set(k, value);
}
function mean(arr, field) {
  const xs = (arr || []).map((x) => n(field ? x?.[field] : x)).filter((x) => x != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function safeDiff(a, b, scale = 1) {
  const x = n(a);
  const y = n(b);
  if (x == null || y == null) return 0;
  return clamp((x - y) / scale, -CFG.featureClip, CFG.featureClip);
}
function softmax(logits) {
  const m = Math.max(...logits);
  const ex = logits.map((x) => Math.exp(x - m));
  const s = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map((x) => x / s);
}
function resultIndex(h, a) {
  return h > a ? 0 : h === a ? 1 : 2;
}
function gdMultiplier(gd) {
  const x = Math.abs(Number(gd) || 0);
  if (x <= 1) return 1;
  if (x === 2) return 1.5;
  return (11 + x) / 8;
}
function blankRecord() {
  return {
    matches: 0, points: 0, gf: 0, ga: 0,
    shotsOnTarget: 0, possession: 0, xg: 0, xga: 0, ppda: 0,
    deep: 0, xpoints: 0,
    advancedCounts: { shotsOnTarget: 0, possession: 0, xg: 0, xga: 0, ppda: 0, deep: 0, xpoints: 0 },
  };
}
function blankTeam() {
  return {
    all: blankRecord(),
    home: blankRecord(),
    away: blankRecord(),
    recent: [],
    recentHome: [],
    recentAway: [],
    lastDate: null,
  };
}
function addOptional(rec, field, value) {
  const x = n(value);
  if (x == null) return;
  rec[field] += x;
  rec.advancedCounts[field] += 1;
}
function addRecord(rec, gf, ga, points, extra = {}) {
  rec.matches += 1;
  rec.gf += gf;
  rec.ga += ga;
  rec.points += points;
  addOptional(rec, "shotsOnTarget", extra.shotsOnTarget);
  addOptional(rec, "possession", extra.possession);
  addOptional(rec, "xg", extra.xg);
  addOptional(rec, "xga", extra.xga);
  addOptional(rec, "ppda", extra.ppda);
  addOptional(rec, "deep", extra.deep);
  addOptional(rec, "xpoints", extra.xpoints);
}
function avgRecord(rec) {
  const games = Math.max(1, Number(rec?.matches || 0));
  const opt = (field) => {
    const c = Number(rec?.advancedCounts?.[field] || 0);
    return c > 0 ? rec[field] / c : null;
  };
  return {
    matches: Number(rec?.matches || 0),
    ppg: Number(rec?.points || 0) / games,
    gf: Number(rec?.gf || 0) / games,
    ga: Number(rec?.ga || 0) / games,
    shotsOnTarget: opt("shotsOnTarget"),
    possession: opt("possession"),
    xg: opt("xg"),
    xga: opt("xga"),
    ppda: opt("ppda"),
    deep: opt("deep"),
    xpoints: opt("xpoints"),
  };
}
function avgRecent(rows = []) {
  if (!rows.length) return avgRecord(blankRecord());
  const out = blankRecord();
  for (const r of rows) addRecord(out, r.gf, r.ga, r.points, r);
  return avgRecord(out);
}
function trimPush(arr, row, max) {
  arr.push(row);
  while (arr.length > max) arr.shift();
}
function advancedCoverage(game) {
  const fields = [
    game.homeXg, game.awayXg, game.homePpda, game.awayPpda,
    game.homeDeepCompletions, game.awayDeepCompletions,
    game.homeExpectedPoints, game.awayExpectedPoints,
  ];
  return fields.filter((x) => n(x) != null).length / fields.length;
}

function createClassifier() {
  const d = FEATURE_NAMES.length + 1;
  return {
    weights: Array.from({ length: 3 }, () => Array(d).fill(0)),
    updates: 0,
    loss: 0,
  };
}
function logits(model, features) {
  const x = [1, ...features];
  return model.weights.map((w) => w.reduce((s, wi, i) => s + wi * x[i], 0));
}
function classify(model, features) {
  return softmax(logits(model, features));
}
function updateClassifier(model, features, outcome) {
  const x = [1, ...features];
  const p = classify(model, features);
  for (let c = 0; c < 3; c++) {
    const y = c === outcome ? 1 : 0;
    const err = y - p[c];
    for (let j = 0; j < x.length; j++) {
      const reg = j === 0 ? 0 : CFG.l2 * model.weights[c][j];
      model.weights[c][j] += CFG.learningRate * (err * x[j] - reg);
    }
  }
  model.updates += 1;
  model.loss += -Math.log(Math.max(1e-9, p[outcome]));
  return p;
}

function createState() {
  return {
    teams: new Map(),
    elo: new Map(),
    classifier: createClassifier(),
    leagueMatches: 0,
    advancedMatches: 0,
  };
}
function ensureTeam(state, team) {
  let record = findByAliases(state.teams, team);
  if (!record) record = blankTeam();
  setAliases(state.teams, team, record);
  let elo = findByAliases(state.elo, team);
  if (elo == null) elo = CFG.eloStart;
  setAliases(state.elo, team, elo);
  return record;
}
function eloFor(state, team) {
  const elo = findByAliases(state.elo, team);
  return elo == null ? CFG.eloStart : elo;
}
function setElo(state, team, value) {
  setAliases(state.elo, team, value);
}
function points(gf, ga) {
  return gf > ga ? 3 : gf === ga ? 1 : 0;
}
function recordAdvanced(game, side) {
  const home = side === "home";
  return {
    shotsOnTarget: n(home ? game.homeShotsOnTarget : game.awayShotsOnTarget),
    possession: n(home ? game.homePossession : game.awayPossession),
    xg: n(home ? game.homeXg : game.awayXg),
    xga: n(home ? game.awayXg : game.homeXg),
    ppda: n(home ? game.homePpda : game.awayPpda),
    deep: n(home ? game.homeDeepCompletions : game.awayDeepCompletions),
    xpoints: n(home ? game.homeExpectedPoints : game.awayExpectedPoints),
  };
}
function featureVector(state, game) {
  const hk = key(game.home);
  const ak = key(game.away);
  const h = findByAliases(state.teams, game.home) || blankTeam();
  const a = findByAliases(state.teams, game.away) || blankTeam();
  const ho = avgRecord(h.all);
  const ao = avgRecord(a.all);
  const hf = avgRecent(h.recent.slice(-CFG.formWindow));
  const af = avgRecent(a.recent.slice(-CFG.formWindow));
  const hv = avgRecent(h.recentHome.slice(-CFG.venueWindow));
  const av = avgRecent(a.recentAway.slice(-CFG.venueWindow));
  const hElo = eloFor(state, game.home);
  const aElo = eloFor(state, game.away);
  const date = iso(game.date || game.start);
  const hRest = h.lastDate ? clamp(daysBetween(h.lastDate, date) ?? 7, 0, CFG.restCapDays) : 7;
  const aRest = a.lastDate ? clamp(daysBetween(a.lastDate, date) ?? 7, 0, CFG.restCapDays) : 7;

  const xgDiff = ho.xg != null && ao.xg != null ? safeDiff(ho.xg - ho.xga, ao.xg - ao.xga, 1.25) : 0;
  const xgaDiff = ho.xga != null && ao.xga != null ? safeDiff(ao.xga, ho.xga, 1.25) : 0;
  const ppdaDiff = ho.ppda != null && ao.ppda != null ? safeDiff(ao.ppda, ho.ppda, 8) : 0; // lower PPDA = stronger press
  const deepDiff = safeDiff(ho.deep, ao.deep, 5);
  const xpDiff = safeDiff(ho.xpoints, ao.xpoints, 1.5);

  return {
    vector: [
      safeDiff(hElo + (game.neutralSite ? 0 : CFG.eloHomeAdv), aElo, 400),
      safeDiff(ho.ppg, ao.ppg, 1.5),
      safeDiff(ho.gf, ao.gf, 1.5),
      safeDiff(ao.ga, ho.ga, 1.5),
      safeDiff(hf.ppg, af.ppg, 1.5),
      safeDiff(hf.gf, af.gf, 1.5),
      safeDiff(af.ga, hf.ga, 1.5),
      safeDiff(hv.ppg, av.ppg, 1.5),
      safeDiff(hv.gf, av.gf, 1.5),
      safeDiff(av.ga, hv.ga, 1.5),
      safeDiff(hRest, aRest, 7),
      safeDiff(ho.shotsOnTarget, ao.shotsOnTarget, 4),
      safeDiff(ho.possession, ao.possession, 20),
      xgDiff,
      xgaDiff,
      ppdaDiff,
      deepDiff,
      xpDiff,
    ],
    diagnostics: {
      homeElo: round(hElo, 1),
      awayElo: round(aElo, 1),
      eloDiff: round(hElo - aElo + (game.neutralSite ? 0 : CFG.eloHomeAdv), 1),
      homeMatches: ho.matches,
      awayMatches: ao.matches,
      homeRestDays: round(hRest, 1),
      awayRestDays: round(aRest, 1),
      homeFormPpg: round(hf.ppg, 3),
      awayFormPpg: round(af.ppg, 3),
      homeVenuePpg: round(hv.ppg, 3),
      awayVenuePpg: round(av.ppg, 3),
      advanced: {
        homeXg: ho.xg == null ? null : round(ho.xg, 3),
        awayXg: ao.xg == null ? null : round(ao.xg, 3),
        homeXga: ho.xga == null ? null : round(ho.xga, 3),
        awayXga: ao.xga == null ? null : round(ao.xga, 3),
        homePpda: ho.ppda == null ? null : round(ho.ppda, 3),
        awayPpda: ao.ppda == null ? null : round(ao.ppda, 3),
        homeDeep: ho.deep == null ? null : round(ho.deep, 3),
        awayDeep: ao.deep == null ? null : round(ao.deep, 3),
      },
    },
  };
}
function applyMatch(state, game) {
  const hs = n(game.homeScore);
  const as = n(game.awayScore);
  if (hs == null || as == null) return;
  const h = ensureTeam(state, game.home);
  const a = ensureTeam(state, game.away);
  const hk = key(game.home);
  const ak = key(game.away);

  const features = featureVector(state, game).vector;
  updateClassifier(state.classifier, features, resultIndex(hs, as));

  const hElo = state.elo.get(hk) ?? CFG.eloStart;
  const aElo = state.elo.get(ak) ?? CFG.eloStart;
  const expectedHome = 1 / (1 + 10 ** (-(hElo - aElo + (game.neutralSite ? 0 : CFG.eloHomeAdv)) / 400));
  const actualHome = hs > as ? 1 : hs === as ? 0.5 : 0;
  const delta = CFG.eloK * gdMultiplier(hs - as) * (actualHome - expectedHome);
  setElo(state, game.home, hElo + delta);
  setElo(state, game.away, aElo - delta);

  const hp = points(hs, as);
  const ap = points(as, hs);
  const he = recordAdvanced(game, "home");
  const ae = recordAdvanced(game, "away");
  addRecord(h.all, hs, as, hp, he);
  addRecord(h.home, hs, as, hp, he);
  addRecord(a.all, as, hs, ap, ae);
  addRecord(a.away, as, hs, ap, ae);
  trimPush(h.recent, { gf: hs, ga: as, points: hp, ...he }, CFG.formWindow);
  trimPush(a.recent, { gf: as, ga: hs, points: ap, ...ae }, CFG.formWindow);
  trimPush(h.recentHome, { gf: hs, ga: as, points: hp, ...he }, CFG.venueWindow);
  trimPush(a.recentAway, { gf: as, ga: hs, points: ap, ...ae }, CFG.venueWindow);
  h.lastDate = iso(game.date || game.start);
  a.lastDate = iso(game.date || game.start);
  state.leagueMatches += 1;
  if (advancedCoverage(game) >= 0.5) state.advancedMatches += 1;
}

export function buildSoccerV2State(history = [], cutoff = null) {
  const target = iso(cutoff) || "9999-12-31";
  const state = createState();
  const rows = [...(history || [])]
    .filter((g) => iso(g.date || g.start) && iso(g.date || g.start) < target)
    .sort((a, b) => {
      const da = String(a.start || a.date || "");
      const db = String(b.start || b.date || "");
      return da.localeCompare(db) || String(a.id || "").localeCompare(String(b.id || ""));
    });
  for (const game of rows) {
    ensureTeam(state, game.home);
    ensureTeam(state, game.away);
    applyMatch(state, game);
  }
  return state;
}

function ensembleWeight(v1, state, diag) {
  const teamMin = Math.min(Number(diag.homeMatches || 0), Number(diag.awayMatches || 0));
  let w = CFG.baseV1Weight;
  if (teamMin < 10) w += 0.08;
  if (state.classifier.updates < 120) w += 0.05;
  const advRate = state.leagueMatches ? state.advancedMatches / state.leagueMatches : 0;
  if (advRate >= 0.5) w -= CFG.advancedBonusWeight;
  if (String(v1?.uncertainty?.level || "").toUpperCase() === "HIGH") w -= 0.06;
  return clamp(w, CFG.minV1Weight, CFG.maxV1Weight);
}
function combineProb(v1, challenger, w) {
  const p = [
    w * Number(v1.pHomeWin) + (1 - w) * Number(challenger[0]),
    w * Number(v1.pDraw) + (1 - w) * Number(challenger[1]),
    w * Number(v1.pAwayWin) + (1 - w) * Number(challenger[2]),
  ];
  const s = p.reduce((a, b) => a + b, 0) || 1;
  return p.map((x) => x / s);
}

export function projectSoccerV2(game = {}, history = [], options = {}) {
  const cutoff = iso(game.start || game.date || options.cutoff || new Date().toISOString());
  const v1 = projectSoccerFromHistory(game, history, options.v1 || {});
  if (!v1?.ok) {
    return {
      ok: false,
      modelId: SOCCER_FBIS_V2_ID,
      modelVersion: SOCCER_FBIS_V2_VERSION,
      reason: v1?.reason || "v1-structural-projection-unavailable",
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
    };
  }

  const state = buildSoccerV2State(history, cutoff);
  const fv = featureVector(state, game);
  const h = findByAliases(state.teams, game.home);
  const a = findByAliases(state.teams, game.away);
  const minTeam = Math.min(Number(h?.all?.matches || 0), Number(a?.all?.matches || 0));
  const enough = state.leagueMatches >= CFG.minHistoryMatches && minTeam >= CFG.minTeamMatches;
  const challenger = enough ? classify(state.classifier, fv.vector) : [v1.pHomeWin, v1.pDraw, v1.pAwayWin];
  const w = enough ? ensembleWeight(v1, state, fv.diagnostics) : 1;
  const probs = combineProb(v1, challenger, w);

  const uncertainty = {
    ...(v1.uncertainty || {}),
    level: !enough ? "HIGH" : v1.uncertainty?.level || "MEDIUM",
    v2HistoryMatches: state.leagueMatches,
    classifierUpdates: state.classifier.updates,
    advancedCoverage: state.leagueMatches ? round(state.advancedMatches / state.leagueMatches, 4) : 0,
    challengerActive: enough,
  };

  const out = {
    ...v1,
    modelId: SOCCER_FBIS_V2_ID,
    modelVersion: SOCCER_FBIS_V2_VERSION,
    pHomeWin: probs[0],
    pDraw: probs[1],
    pAwayWin: probs[2],
    maturity: "RESEARCH",
    canQualify: false,
    canAuthorize: false,
    uncertainty,
    validation: SOCCER_V2_LEAGUE_VALIDATION[String(game.soccerLeague || game.league || "")] || null,
    v1: {
      modelId: v1.modelId,
      modelVersion: v1.modelVersion,
      pHomeWin: v1.pHomeWin,
      pDraw: v1.pDraw,
      pAwayWin: v1.pAwayWin,
      home: v1.home,
      away: v1.away,
    },
    challenger: {
      active: enough,
      family: "causal-online-multinomial",
      pHomeWin: challenger[0],
      pDraw: challenger[1],
      pAwayWin: challenger[2],
      updates: state.classifier.updates,
      averageTrainingLogLoss: state.classifier.updates ? round(state.classifier.loss / state.classifier.updates, 4) : null,
      featureNames: FEATURE_NAMES,
    },
    ensemble: {
      v1Weight: round(w, 4),
      challengerWeight: round(1 - w, 4),
      adaptive: true,
      advancedFieldsOptional: true,
    },
    diagnostics: {
      ...(v1.diagnostics || {}),
      ...fv.diagnostics,
      v2AdvancedCoverage: uncertainty.advancedCoverage,
      challengerActive: enough,
    },
    provenance: {
      ...(v1.provenance || {}),
      model: SOCCER_FBIS_V2_ID,
      modelVersion: SOCCER_FBIS_V2_VERSION,
      marketUsed: false,
      pointInTimeCutoff: cutoff,
      featurePolicy: "strictly-pre-match",
      optionalAdvancedFields: ["xG", "PPDA", "deepCompletions", "expectedPoints"],
    },
  };
  out.confidencePick = soccerConfidencePick(game, out);
  return out;
}

function attachV2(game, p) {
  if (!p?.ok) return { ...game, soccerFbisV2: p };
  const confidence = soccerConfidencePick(game, p);
  return {
    ...game,
    soccerFbisV2: p,
    soccerFbis: p,
    soccerConfidence: confidence,
    confidencePick: confidence,
    projHomeScore: p.home,
    projAwayScore: p.away,
    projectionKind: "FBIS",
    projectionEngine: SOCCER_FBIS_V2_ID,
    projectionMaturity: "RESEARCH",
    projectionDisplayLabel: "FBIS SOCCER V2 RESEARCH PROJECTION",
    pureProjectionAvailable: true,
    qualificationBlocked: true,
    canQualify: false,
    canAuthorizeWager: false,
    publicationStatus: "RESEARCH_PUBLISHABLE",
    bettingAuthority: "NOT_ELIGIBLE",
    modelVersion: SOCCER_FBIS_V2_VERSION,
    model: {
      ...(game.model || {}),
      projHome: p.home,
      projAway: p.away,
      projMargin: p.margin,
      projTotal: p.total,
      pHomeFinal: p.pHomeWin,
      pHome: p.pHomeWin,
      pDraw: p.pDraw,
      pAway: p.pAwayWin,
      pBttsYes: p.pBttsYes,
      totals: p.totals,
      homeAsian: p.homeAsian,
      heritageMarkets: p.heritageMarkets || null,
      projectionKind: "FBIS",
      maturity: "RESEARCH",
      canQualify: false,
      canAuthorize: false,
      canShowCalibratedEv: false,
      uncertainty: p.uncertainty,
      confidenceStars: confidence.stars,
      confidenceScore: confidence.score,
      confidencePick: confidence,
      recipe: {
        engine: SOCCER_FBIS_V2_ID,
        version: SOCCER_FBIS_V2_VERSION,
        family: "dixon-coles + causal online classifier ensemble",
        steps: [
          "point-in-time canonical match history",
          "v1 Dixon-Coles structural score model",
          "pre-match Elo, season, recent-form, venue and rest features",
          "optional rights-cleared xG/PPDA/deep-completion/xPoints features",
          "causal online multinomial challenger",
          "reliability-weighted 1X2 ensemble",
          "Research only — no wager authority",
        ],
      },
    },
    researchProjection: {
      modelId: SOCCER_FBIS_V2_ID,
      modelVersion: SOCCER_FBIS_V2_VERSION,
      maturity: "RESEARCH",
      home: p.home,
      away: p.away,
      total: p.total,
      margin: p.margin,
      pHome: p.pHomeWin,
      pDraw: p.pDraw,
      pAway: p.pAwayWin,
      pBttsYes: p.pBttsYes,
      totals: p.totals,
      heritageMarkets: p.heritageMarkets || null,
      uncertainty: p.uncertainty,
      confidencePick: confidence,
      ensemble: p.ensemble,
      challenger: p.challenger,
      note: "Independent causal soccer ensemble. Market data excluded.",
      canQualify: false,
      canAuthorize: false,
    },
    challengers: {
      ...(game.challengers || {}),
      [SOCCER_FBIS_V2_ID]: p,
      [p.v1?.modelId || "SOCCER-FBIS-v1"]: p.v1,
    },
  };
}

function startDateDaysBefore(date, days) {
  const d = new Date(iso(date || new Date().toISOString()) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function attachSoccerV2Research(games = [], env = {}) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length) return {
    games: [],
    meta: {
      modelId: SOCCER_FBIS_V2_ID,
      version: SOCCER_FBIS_V2_VERSION,
      projected: 0,
      missing: 0,
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
      maturity: "RESEARCH",
    },
  };

  const grouped = new Map();
  for (const game of list) {
    const league = String(game.soccerLeague || game.league || "");
    if (!grouped.has(league)) grouped.set(league, []);
    grouped.get(league).push(game);
  }

  const out = new Map();
  let projected = 0;
  let missing = 0;
  let challengerActive = 0;
  let advancedActive = 0;

  for (const [league, leagueGames] of grouped.entries()) {
    const cutoff = iso(leagueGames.map((g) => g.start || g.date).filter(Boolean).sort()[0] || new Date().toISOString());
    const history = SOCCER_LEAGUES.includes(league)
      ? await loadSoccerMatchHistory(env, {
          league,
          startDate: startDateDaysBefore(cutoff, 900),
          beforeDate: cutoff,
        }).catch(() => [])
      : pitchApiHistoryToGames(await loadPitchApiHistory(env, {
          leagueKey: league,
          startDate: startDateDaysBefore(cutoff, 1100),
          beforeDate: cutoff,
        }).catch(() => []));
    for (const game of leagueGames) {
      const p = projectSoccerV2(game, history);
      if (p.ok) {
        projected += 1;
        if (p.challenger?.active) challengerActive += 1;
        if (Number(p.uncertainty?.advancedCoverage || 0) >= 0.5) advancedActive += 1;
      } else missing += 1;
      out.set(String(game.id), attachV2(game, p));
    }
  }

  return {
    games: list.map((g) => out.get(String(g.id)) || g),
    meta: {
      modelId: SOCCER_FBIS_V2_ID,
      version: SOCCER_FBIS_V2_VERSION,
      leagues: [...new Set(list.map(g=>String(g.soccerLeague||g.league||"")).filter(Boolean))],
      projected,
      missing,
      challengerActive,
      advancedActive,
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
      maturity: "RESEARCH",
      architecture: "Dixon-Coles + causal online outcome model ensemble",
      optionalAdvancedFeatures: ["xG/xGA", "PPDA", "deep completions", "expected points"],
      probabilityMarkets: ["1X2", "totals", "BTTS", "Asian handicap"],
    },
  };
}
