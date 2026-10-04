/**
 * Soccer-FBIS-v1 independent research model.
 *
 * Independent inputs only:
 * - canonical pre-match results/history from ESPN-derived soccer_matches;
 * - legacy team_form fallback while canonical history is being populated.
 *
 * Sportsbook lines, prices, public splits and line movement are prohibited
 * from this projection layer. Market joins happen only after projection freeze.
 */
import { loadTeamForm, loadSoccerMatchHistory } from "./store.js";

export const SOCCER_FBIS_ID = "SOCCER-FBIS-v1";
export const SOCCER_FBIS_VERSION = "research-v2-dixon-coles";
export const SOCCER_LEAGUES = Object.freeze([
  "eng.1",
  "esp.1",
  "ger.1",
  "ita.1",
  "fra.1",
  "usa.1",
  "usa.nwsl",
]);

const CALENDAR_YEAR_LEAGUES = new Set(["usa.1", "usa.nwsl"]);
const CFG = Object.freeze({
  fallbackLeagueGoals: 1.42,
  fallbackHomeGoalAdj: 0.18,
  formPriorGames: 10,
  splitPseudoGames: 5.5,
  halfLifeDays: 240,
  rho: -0.08,
  minGoals: 0.15,
  maxGoals: 4.5,
  maxScore: 9,
});

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d = 4) => {
  const p = 10 ** d;
  return Math.round(Number(v) * p) / p;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));
const isoDate = (v) => String(v || "").slice(0, 10);

function teamKey(team = {}) {
  if (team.teamKey) return String(team.teamKey);
  if (team.espnId != null) return `id:${team.espnId}`;
  if (team.id != null) return `id:${team.id}`;
  if (team.abbr) return `abbr:${String(team.abbr).toUpperCase()}`;
  return `name:${String(team.name || team.displayName || "").toLowerCase()}`;
}

function row(map, team) {
  if (!map?.get || !team) return null;
  for (const k of [
    team.espnId != null ? `id:${team.espnId}` : null,
    team.id != null ? `id:${team.id}` : null,
    team.abbr ? `abbr:${String(team.abbr).toUpperCase()}` : null,
    team.name ? `name:${String(team.name).toLowerCase()}` : null,
  ].filter(Boolean)) {
    const x = map.get(k);
    if (x) return x;
  }
  return null;
}

function legacyRates(r) {
  const games = num(r?.games) || 0;
  const pf = num(r?.pointsFor ?? r?.points_for);
  const pa = num(r?.pointsAgainst ?? r?.points_against);
  return games && pf != null && pa != null
    ? { games, gf: pf / games, ga: pa / games }
    : null;
}

function blend(a, b, n, w = CFG.formPriorGames) {
  if (b == null) return a;
  if (a == null) return b;
  const x = (Number(n) || 0) / ((Number(n) || 0) + w);
  return a * (1 - x) + b * x;
}

function poissonPmf(k, lambda) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return Math.exp(-lambda) * lambda ** k / f;
}

function dcTau(homeGoals, awayGoals, homeLambda, awayLambda, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeLambda * awayLambda * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeLambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayLambda * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

export function buildScoreMatrix(homeLambda, awayLambda, { rho = CFG.rho, maxScore = CFG.maxScore } = {}) {
  const cells = [];
  let sum = 0;
  for (let h = 0; h <= maxScore; h++) {
    for (let a = 0; a <= maxScore; a++) {
      const p = Math.max(
        0,
        poissonPmf(h, homeLambda) *
          poissonPmf(a, awayLambda) *
          dcTau(h, a, homeLambda, awayLambda, rho)
      );
      cells.push({ home: h, away: a, p });
      sum += p;
    }
  }
  const z = sum || 1;
  return cells.map((x) => ({ ...x, p: x.p / z }));
}

function deriveMarkets(matrix) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let bttsYes = 0;
  const totals = {
    "1.5": { over: 0, under: 0 },
    "2.5": { over: 0, under: 0 },
    "3.5": { over: 0, under: 0 },
  };
  const handicapLines = [-1.5, -1, -0.5, 0, 0.5, 1, 1.5];
  const homeAsian = Object.fromEntries(
    handicapLines.map((line) => [String(line), { win: 0, push: 0, loss: 0 }])
  );

  for (const cell of matrix) {
    const { home: h, away: a, p } = cell;
    if (h > a) home += p;
    else if (h === a) draw += p;
    else away += p;
    if (h > 0 && a > 0) bttsYes += p;

    const total = h + a;
    for (const line of [1.5, 2.5, 3.5]) {
      if (total > line) totals[String(line)].over += p;
      else totals[String(line)].under += p;
    }

    for (const line of handicapLines) {
      const adj = h - a + line;
      const bucket = homeAsian[String(line)];
      if (adj > 0) bucket.win += p;
      else if (adj < 0) bucket.loss += p;
      else bucket.push += p;
    }
  }

  return {
    pHomeWin: home,
    pDraw: draw,
    pAwayWin: away,
    pBttsYes: bttsYes,
    pBttsNo: 1 - bttsYes,
    totals,
    homeAsian,
  };
}

function blankTeamState() {
  const make = () => ({ w: 0, gf: 0, ga: 0, rawGames: 0 });
  return { all: make(), home: make(), away: make(), lastDate: null };
}

function addStat(s, gf, ga, w) {
  s.w += w;
  s.gf += gf * w;
  s.ga += ga * w;
  s.rawGames += 1;
}

function daysBetween(a, b) {
  const x = Date.parse(String(a || "").slice(0, 10) + "T12:00:00Z");
  const y = Date.parse(String(b || "").slice(0, 10) + "T12:00:00Z");
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (y - x) / 86400000;
}

export function buildSoccerHistoryState(history = [], cutoff = null, options = {}) {
  const halfLifeDays = Number(options.halfLifeDays) > 0 ? Number(options.halfLifeDays) : CFG.halfLifeDays;
  const cutoffDate = isoDate(cutoff) || "9999-12-31";
  const teams = new Map();
  let homeGoals = 0;
  let awayGoals = 0;
  let leagueWeight = 0;
  let rawMatches = 0;

  for (const g of history || []) {
    const date = isoDate(g.date || g.start);
    if (!date || date >= cutoffDate) continue;
    const hs = num(g.homeScore);
    const as = num(g.awayScore);
    if (hs == null || as == null) continue;
    const ageDays = Math.max(0, daysBetween(date, cutoffDate) ?? 0);
    const w = 0.5 ** (ageDays / halfLifeDays);
    const hk = teamKey(g.home);
    const ak = teamKey(g.away);
    if (!hk || !ak) continue;
    if (!teams.has(hk)) teams.set(hk, blankTeamState());
    if (!teams.has(ak)) teams.set(ak, blankTeamState());
    const h = teams.get(hk);
    const a = teams.get(ak);
    addStat(h.all, hs, as, w);
    addStat(h.home, hs, as, w);
    addStat(a.all, as, hs, w);
    addStat(a.away, as, hs, w);
    h.lastDate = !h.lastDate || date > h.lastDate ? date : h.lastDate;
    a.lastDate = !a.lastDate || date > a.lastDate ? date : a.lastDate;
    homeGoals += hs * w;
    awayGoals += as * w;
    leagueWeight += w;
    rawMatches += 1;
  }

  const leagueHome = leagueWeight > 0 ? homeGoals / leagueWeight : CFG.fallbackLeagueGoals + CFG.fallbackHomeGoalAdj / 2;
  const leagueAway = leagueWeight > 0 ? awayGoals / leagueWeight : CFG.fallbackLeagueGoals - CFG.fallbackHomeGoalAdj / 2;
  return {
    cutoff: cutoffDate,
    teams,
    leagueHome,
    leagueAway,
    leagueTotal: leagueHome + leagueAway,
    rawMatches,
    effectiveMatches: leagueWeight,
    halfLifeDays,
  };
}

function splitRate(state, splitName, field, leagueRate, pseudo = CFG.splitPseudoGames) {
  const split = state?.[splitName];
  const overall = state?.all;
  const overallRate = overall?.w > 0 ? overall[field] / overall.w : leagueRate;
  const splitAnchor = 0.65 * overallRate + 0.35 * leagueRate;
  if (!(split?.w > 0)) return splitAnchor;
  return (split[field] + pseudo * splitAnchor) / (split.w + pseudo);
}

function uncertaintyState(homeState, awayState, historyState) {
  const homeN = Number(homeState?.all?.rawGames || 0);
  const awayN = Number(awayState?.all?.rawGames || 0);
  const minTeamGames = Math.min(homeN, awayN);
  const historyN = Number(historyState?.rawMatches || 0);
  let level = "LOW";
  if (minTeamGames < 5 || historyN < 40) level = "HIGH";
  else if (minTeamGames < 10 || historyN < 100) level = "MEDIUM";
  return {
    level,
    homeHistoryGames: homeN,
    awayHistoryGames: awayN,
    leagueHistoryMatches: historyN,
    pointInTime: true,
  };
}

export function projectSoccerFromHistory(game = {}, history = [], options = {}) {
  const cutoff = isoDate(game.start || game.date || options.cutoff || new Date().toISOString());
  const state = buildSoccerHistoryState(history, cutoff, options);
  const hk = teamKey(game.home);
  const ak = teamKey(game.away);
  const homeState = state.teams.get(hk);
  const awayState = state.teams.get(ak);

  if (!homeState || !awayState) {
    return {
      ok: false,
      modelId: SOCCER_FBIS_ID,
      modelVersion: SOCCER_FBIS_VERSION,
      reason: "canonical-team-history-missing",
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
    };
  }

  const neutral = Boolean(game.neutralSite);
  const leagueHome = neutral ? state.leagueTotal / 2 : state.leagueHome;
  const leagueAway = neutral ? state.leagueTotal / 2 : state.leagueAway;
  const homeSplit = neutral ? "all" : "home";
  const awaySplit = neutral ? "all" : "away";

  const homeAttack = splitRate(homeState, homeSplit, "gf", leagueHome, options.splitPseudoGames);
  const awayDefense = splitRate(awayState, awaySplit, "ga", leagueHome, options.splitPseudoGames);
  const awayAttack = splitRate(awayState, awaySplit, "gf", leagueAway, options.splitPseudoGames);
  const homeDefense = splitRate(homeState, homeSplit, "ga", leagueAway, options.splitPseudoGames);

  const homeLambda = clamp(
    leagueHome * (homeAttack / Math.max(0.15, leagueHome)) * (awayDefense / Math.max(0.15, leagueHome)),
    CFG.minGoals,
    CFG.maxGoals
  );
  const awayLambda = clamp(
    leagueAway * (awayAttack / Math.max(0.15, leagueAway)) * (homeDefense / Math.max(0.15, leagueAway)),
    CFG.minGoals,
    CFG.maxGoals
  );

  const rho = Number.isFinite(Number(options.rho)) ? Number(options.rho) : CFG.rho;
  const matrix = buildScoreMatrix(homeLambda, awayLambda, { rho, maxScore: options.maxScore || CFG.maxScore });
  const markets = deriveMarkets(matrix);
  const homeRest = homeState.lastDate ? daysBetween(homeState.lastDate, cutoff) : null;
  const awayRest = awayState.lastDate ? daysBetween(awayState.lastDate, cutoff) : null;

  return {
    ok: true,
    modelId: SOCCER_FBIS_ID,
    modelVersion: SOCCER_FBIS_VERSION,
    home: round(homeLambda, 2),
    away: round(awayLambda, 2),
    total: round(homeLambda + awayLambda, 2),
    margin: round(homeLambda - awayLambda, 2),
    pHomeWin: markets.pHomeWin,
    pDraw: markets.pDraw,
    pAwayWin: markets.pAwayWin,
    pBttsYes: markets.pBttsYes,
    pBttsNo: markets.pBttsNo,
    totals: markets.totals,
    homeAsian: markets.homeAsian,
    scoreMatrix: matrix,
    independent: true,
    marketInformed: false,
    maturity: "RESEARCH",
    canQualify: false,
    canAuthorize: false,
    uncertainty: uncertaintyState(homeState, awayState, state),
    diagnostics: {
      leagueHomeGoals: round(state.leagueHome, 4),
      leagueAwayGoals: round(state.leagueAway, 4),
      homeAttackRate: round(homeAttack, 4),
      awayDefenseRate: round(awayDefense, 4),
      awayAttackRate: round(awayAttack, 4),
      homeDefenseRate: round(homeDefense, 4),
      homeRestDays: homeRest == null ? null : round(homeRest, 2),
      awayRestDays: awayRest == null ? null : round(awayRest, 2),
      restAdjustmentApplied: false,
      dixonColesRho: rho,
    },
    provenance: {
      source: "canonical soccer match history",
      marketUsed: false,
      pointInTimeCutoff: cutoff,
      historyMatches: state.rawMatches,
      halfLifeDays: state.halfLifeDays,
      splitPseudoGames: Number(options.splitPseudoGames) || CFG.splitPseudoGames,
      dixonColesRho: rho,
      rhoStatus: "research-parameter-requires-validation",
    },
  };
}

export function soccerSeasonYear(date = new Date(), league = null) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  if (CALENDAR_YEAR_LEAGUES.has(String(league || ""))) return y;
  const m = d.getUTCMonth() + 1;
  return m >= 7 ? y : y - 1;
}

/**
 * Legacy team-form projection used only while canonical match history is absent.
 */
export function projectSoccerForm(game, { homePrior = null, awayPrior = null, homeCurrent = null, awayCurrent = null } = {}) {
  const hp = legacyRates(homePrior);
  const ap = legacyRates(awayPrior);
  const hc = legacyRates(homeCurrent);
  const ac = legacyRates(awayCurrent);
  if (!(hp || hc) || !(ap || ac)) {
    return {
      ok: false,
      modelId: SOCCER_FBIS_ID,
      modelVersion: SOCCER_FBIS_VERSION,
      reason: "team-form-evidence-missing",
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
    };
  }
  const hgf = blend(hp?.gf ?? CFG.fallbackLeagueGoals, hc?.gf, hc?.games || 0);
  const hga = blend(hp?.ga ?? CFG.fallbackLeagueGoals, hc?.ga, hc?.games || 0);
  const agf = blend(ap?.gf ?? CFG.fallbackLeagueGoals, ac?.gf, ac?.games || 0);
  const aga = blend(ap?.ga ?? CFG.fallbackLeagueGoals, ac?.ga, ac?.games || 0);
  const hfa = game?.neutralSite ? 0 : CFG.fallbackHomeGoalAdj;
  const home = clamp((hgf + aga) / 2 + hfa, CFG.minGoals, CFG.maxGoals);
  const away = clamp((agf + hga) / 2, CFG.minGoals, CFG.maxGoals);
  const matrix = buildScoreMatrix(home, away, { rho: CFG.rho });
  const markets = deriveMarkets(matrix);
  return {
    ok: true,
    modelId: SOCCER_FBIS_ID,
    modelVersion: SOCCER_FBIS_VERSION,
    home: round(home, 2),
    away: round(away, 2),
    total: round(home + away, 2),
    margin: round(home - away, 2),
    pHomeWin: markets.pHomeWin,
    pDraw: markets.pDraw,
    pAwayWin: markets.pAwayWin,
    pBttsYes: markets.pBttsYes,
    pBttsNo: markets.pBttsNo,
    totals: markets.totals,
    homeAsian: markets.homeAsian,
    independent: true,
    marketInformed: false,
    maturity: "RESEARCH",
    canQualify: false,
    canAuthorize: false,
    uncertainty: { level: "HIGH", legacyTeamFormFallback: true },
    provenance: {
      source: "legacy scoreboard-derived soccer team_form",
      marketUsed: false,
      priorGames: CFG.formPriorGames,
      hfa,
      dixonColesRho: CFG.rho,
    },
  };
}

function startDateDaysBefore(date, days) {
  const d = new Date(String(date || new Date().toISOString()).slice(0, 10) + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function attachProjection(game, p) {
  if (!p.ok) {
    return {
      ...game,
      soccerFbis: p,
      pureProjectionAvailable: false,
      qualificationBlocked: true,
      canQualify: false,
      canAuthorizeWager: false,
    };
  }
  return {
    ...game,
    soccerFbis: p,
    projHomeScore: p.home,
    projAwayScore: p.away,
    projectionKind: "FBIS",
    projectionEngine: SOCCER_FBIS_ID,
    projectionMaturity: "RESEARCH",
    projectionDisplayLabel: "FBIS SOCCER RESEARCH PROJECTION",
    pureProjectionAvailable: true,
    qualificationBlocked: true,
    canQualify: false,
    canAuthorizeWager: false,
    publicationStatus: "RESEARCH_PUBLISHABLE",
    bettingAuthority: "NOT_ELIGIBLE",
    modelVersion: SOCCER_FBIS_VERSION,
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
      projectionKind: "FBIS",
      maturity: "RESEARCH",
      canQualify: false,
      canAuthorize: false,
      canShowCalibratedEv: false,
      uncertainty: p.uncertainty,
      recipe: {
        engine: SOCCER_FBIS_ID,
        version: SOCCER_FBIS_VERSION,
        family: "research",
        steps: [
          "point-in-time canonical match history",
          "recency-weighted league scoring environment",
          "shrunk home/away attack-defense strengths",
          "Dixon-Coles low-score correction",
          "1X2/totals/BTTS/Asian-handicap probability derivation",
          "Research only — no wager authority",
        ],
      },
    },
    researchProjection: {
      modelId: SOCCER_FBIS_ID,
      modelVersion: SOCCER_FBIS_VERSION,
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
      uncertainty: p.uncertainty,
      note: "Independent point-in-time soccer projection. Market data excluded.",
      canQualify: false,
      canAuthorize: false,
    },
    challengers: { ...(game.challengers || {}), [SOCCER_FBIS_ID]: p },
  };
}

export async function attachSoccerResearch(games = [], env = {}) {
  const list = Array.isArray(games) ? games : [];
  if (!list.length) {
    return {
      games: [],
      meta: {
        modelId: SOCCER_FBIS_ID,
        version: SOCCER_FBIS_VERSION,
        projected: 0,
        missing: 0,
        marketInformed: false,
        canQualify: false,
        canAuthorize: false,
        maturity: "RESEARCH",
      },
    };
  }

  const grouped = new Map();
  for (const g of list) {
    const league = String(g.soccerLeague || g.league || "");
    if (!grouped.has(league)) grouped.set(league, []);
    grouped.get(league).push(g);
  }

  const output = new Map();
  let projected = 0;
  let missing = 0;
  let canonicalProjected = 0;
  let legacyProjected = 0;

  for (const [league, leagueGames] of grouped.entries()) {
    const cutoff = isoDate(
      leagueGames.map((g) => g.start || g.date).filter(Boolean).sort()[0] || new Date().toISOString()
    );
    const history = SOCCER_LEAGUES.includes(league)
      ? await loadSoccerMatchHistory(env, {
          league,
          startDate: startDateDaysBefore(cutoff, 620),
          beforeDate: cutoff,
        }).catch(() => [])
      : [];

    let prior = new Map();
    let current = new Map();
    let legacyGlobalPrior = new Map();
    let legacyGlobalCurrent = new Map();
    if (!history.length) {
      const season = soccerSeasonYear(new Date(cutoff + "T12:00:00Z"), league);
      [prior, current, legacyGlobalPrior, legacyGlobalCurrent] = await Promise.all([
        loadTeamForm(env, `soccer:${league}`, season - 1).catch(() => new Map()),
        loadTeamForm(env, `soccer:${league}`, season).catch(() => new Map()),
        loadTeamForm(env, "soccer", season - 1).catch(() => new Map()),
        loadTeamForm(env, "soccer", season).catch(() => new Map()),
      ]);
    }

    for (const game of leagueGames) {
      let p;
      if (history.length) {
        p = projectSoccerFromHistory(game, history);
        if (p.ok) canonicalProjected++;
      }
      if (!p?.ok) {
        const pick = (specific, global, team) => row(specific, team) || row(global, team);
        p = projectSoccerForm(game, {
          homePrior: pick(prior, legacyGlobalPrior, game.home),
          awayPrior: pick(prior, legacyGlobalPrior, game.away),
          homeCurrent: pick(current, legacyGlobalCurrent, game.home),
          awayCurrent: pick(current, legacyGlobalCurrent, game.away),
        });
        if (p.ok) legacyProjected++;
      }
      if (p.ok) projected++;
      else missing++;
      output.set(String(game.id), attachProjection(game, p));
    }
  }

  return {
    games: list.map((g) => output.get(String(g.id)) || g),
    meta: {
      modelId: SOCCER_FBIS_ID,
      version: SOCCER_FBIS_VERSION,
      leagues: SOCCER_LEAGUES,
      projected,
      missing,
      canonicalProjected,
      legacyProjected,
      marketInformed: false,
      canQualify: false,
      canAuthorize: false,
      maturity: "RESEARCH",
      probabilityMarkets: ["1X2", "totals", "BTTS", "Asian handicap"],
    },
  };
}
