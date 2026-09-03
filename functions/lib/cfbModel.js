/**
 * Independent CFB score model (FBIS-v1.3).
 *
 * Runtime sources that actually run:
 *   CollegeFootballData — SP+/FPI/SRS/Elo (all FBS) when CFBD_API_KEY is set
 *   CollegeFootballData — team EPA proxies, transfer portal deltas, coaching continuity, returning production
 *   ESPN scoreboard — records, AP/curated rank, scores, neutralSite, conference, week
 *   ESPN roster — QB room continuity/starter class signals
 *   ESPN rankings  — AP (and other polls in the same payload) as a weekly label, not the team prior
 *   FBIS team_form — current-season points for/against from harvested finals (as-of, no leakage)
 *   Fallback prior — ESPN FPI + opponent-adjusted 2025 SRS (cfb-prior-v1) if CFBD is missing or 401/404
 *
 * Not present in this repo and NOT invented:
 *   Injuries, weather, travel, rest.
 *
 * Early-season blend (documented, versioned):
 *   w_current = n / (n + PRIOR_GAMES) with PRIOR_GAMES = 6
 *   estimate = (1 - w) * preseason_prior + w * current_season_evidence
 *
 * Score identity (enforced):
 *   projected_home + projected_away = projected_total
 *   projected_home - projected_away = projected_margin
 *
 * Win / spread / total probabilities use a Normal with explicit sigma, not a
 * disguised trained model. Sigma is larger in the early season.
 */

import { readCache, writeCache } from "./cache.js";
import { loadTeamForm, loadHfaRatings } from "./store.js";
import { pCoverHome, pGreater } from "./metrics.js";
import { buildShadowHfa, championHfaForGame } from "./hfa.js";
import { CFB_PRIOR_VERSION, freezePrior, hasTeamSpecificPrior, priorForTeam } from "./cfbPrior.js";
import { buildCfbFeatureCatalog, cfbdPublicMeta, loadCfbFeatureFeeds, loadCfbPrior, loadCfbBettingLines } from "./cfbd.js";
import { cfbSlateDiagnostics } from "./cfbDiagnostics.js";
import { resolveTeamExact } from "./teams.js";

function todayCT() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const PROJECTION_STATES = {
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  PRIOR_ONLY: "PRIOR_ONLY",
  LEAGUE_AVERAGE_ONLY: "LEAGUE_AVERAGE_ONLY",
  UNAVAILABLE: "UNAVAILABLE",
};

export const CFB_BLOCKED_MESSAGE = "Projection unavailable for betting — team-specific inputs missing.";

export const CFB_CONSTANTS = {
  priorGames: 6,
  hfaPoints: 2.5,
  leaguePpg: 26.5,
  leagueTotal: 53,
  marginSigmaBase: 15.5,
  totalSigmaBase: 13.5,
  earlySigmaBoost: 0.35,
  rankScale: 0.85,
  epaScale: 2.4,
  transferScale: 1.1,
  qbScale: 0.9,
  coachingScale: 0.7,
  returningScale: 0.8,
  talentScale: 0.6,
  priorVersion: CFB_PRIOR_VERSION,
  notes: {
    hfa: "Documented 2.5-point FBS home-field prior. Neutral site → 0.",
    priorGames: "Current-season weight = n / (n + 6). Week 0 is almost all prior.",
    sigma: "Margin SD 15.5 and total SD 13.5 are published FBS-scale heuristics, not fitted or trained on FBIS bets.",
    missing: "EPA/transfer/QB/coaching signals are fail-soft. Missing feeds stay absent and are flagged; no zero-filled fake precision.",
    prior: "cfb-prior-v2-cfbd: CollegeFootballData SP+/FPI/SRS/Elo for all FBS when the key is present. Fallback is ESPN FPI + opponent-adjusted 2025 SRS. FCS and newly promoted FBS are provisional.",
  },
};

const RANK_TTL_MS = 6 * 60 * 60 * 1000;
const QB_TTL_MS = 6 * 60 * 60 * 1000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cfbSeasonYear(date = todayCT()) {
  const y = Number(String(date).slice(0, 4));
  const m = Number(String(date).slice(5, 7));
  return m >= 8 ? y : y - 1;
}

export function powerFromRank(rank) {
  const r = num(rank);
  if (r == null || r <= 0 || r >= 99) return 0;
  return (26 - Math.min(r, 25)) * CFB_CONSTANTS.rankScale;
}

export function earlySeasonWeight(gamesPlayed, priorGames = CFB_CONSTANTS.priorGames) {
  const n = Math.max(0, Number(gamesPlayed) || 0);
  return n / (n + priorGames);
}

export function blendSeason(prior, current, n, priorGames = CFB_CONSTANTS.priorGames) {
  const w = earlySeasonWeight(n, priorGames);
  if (current == null || !Number.isFinite(Number(current))) return { value: prior, w, n };
  if (prior == null || !Number.isFinite(Number(prior))) return { value: Number(current), w, n };
  return { value: (1 - w) * Number(prior) + w * Number(current), w, n };
}

export function projectCfbMatchup({
  homeOff,
  homeDef,
  awayOff,
  awayDef,
  hfa = CFB_CONSTANTS.hfaPoints,
  national = CFB_CONSTANTS.leaguePpg,
} = {}) {
  // Add opponent defensive residual to each offense. Averaging the two raw
  // scoring figures divided true power gaps by two and badly compressed
  // FBS/FCS mismatches (for example Utah vs Idaho).
  const home = round1(Number(homeOff) + (Number(awayDef) - Number(national)) + Number(hfa) / 2);
  const away = round1(Number(awayOff) + (Number(homeDef) - Number(national)) - Number(hfa) / 2);
  return {
    home,
    away,
    total: round1(home + away),
    margin: round1(home - away),
  };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function strictNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toSignedUnit(v, lo, hi) {
  const n = strictNum(v);
  if (n == null) return null;
  const span = hi - lo;
  if (span <= 0) return null;
  return clamp(((n - lo) / span) * 2 - 1, -1, 1);
}

function toUnit(v, lo, hi) {
  const n = strictNum(v);
  if (n == null) return null;
  const span = hi - lo;
  if (span <= 0) return null;
  return clamp((n - lo) / span, 0, 1);
}

export function cfbSigma({ gamesHome = 0, gamesAway = 0 } = {}) {
  const wHome = earlySeasonWeight(gamesHome);
  const wAway = earlySeasonWeight(gamesAway);
  const maturity = (wHome + wAway) / 2;
  const boost = 1 + CFB_CONSTANTS.earlySigmaBoost * (1 - maturity);
  const sample = Math.sqrt(1 + 1 / (gamesHome + 1) + 1 / (gamesAway + 1));
  return {
    margin: round1(CFB_CONSTANTS.marginSigmaBase * boost * sample),
    total: round1(CFB_CONSTANTS.totalSigmaBase * boost * sample),
    maturity,
  };
}

export function cfbWinProb(margin, sigmaMargin) {
  return pGreater(margin, 0, sigmaMargin);
}

export function cfbSpreadProb(margin, homeSpread, sigmaMargin) {
  return pCoverHome(margin, homeSpread, sigmaMargin);
}

export function cfbTotalProb(total, line, sigmaTotal, over = true) {
  const pOver = pGreater(total, line, sigmaTotal);
  if (pOver == null) return null;
  return over ? pOver : 1 - pOver;
}

export function parseEspnRankings(json) {
  const byTeam = new Map();
  const polls = json?.rankings || [];
  const preferred =
    polls.find((p) => /ap/i.test(p?.name || p?.shortName || "")) || polls[0] || null;
  for (const row of preferred?.ranks || []) {
    const team = row.team || {};
    const id = String(team.id || "");
    const abbr = String(team.abbreviation || "").toUpperCase();
    const name = team.displayName || team.nickname || "";
    const rank = num(row.current);
    if (!id && !abbr) continue;
    const entry = { id, abbr, name, rank, poll: preferred?.name || "AP" };
    if (id) byTeam.set(`id:${id}`, entry);
    if (abbr) byTeam.set(`abbr:${abbr}`, entry);
    if (name) byTeam.set(`name:${String(name).toLowerCase()}`, entry);
  }
  return { poll: preferred?.name || null, season: json?.leagues?.[0]?.season?.year || null, byTeam };
}

function teamKey(team) {
  if (team?.espnId) return `id:${team.espnId}`;
  if (team?.abbr && team.abbr !== "—") return `abbr:${String(team.abbr).toUpperCase()}`;
  return `name:${String(team?.name || "").toLowerCase()}`;
}

function lookupRank(index, team) {
  return (
    index.byTeam.get(`id:${team?.espnId}`) ||
    index.byTeam.get(`abbr:${String(team?.abbr || "").toUpperCase()}`) ||
    index.byTeam.get(`name:${String(team?.name || "").toLowerCase()}`) ||
    null
  );
}

function gamesFromRecord(rec) {
  const m = String(rec || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!m) return 0;
  return Number(m[1]) + Number(m[2]);
}

function priorUnit(power) {
  return {
    off: CFB_CONSTANTS.leaguePpg + power * 0.45,
    def: CFB_CONSTANTS.leaguePpg - power * 0.45,
    power,
    teamSpecific: false,
  };
}

function priorFromCatalog(team, catalog) {
  const row = priorForTeam(team, catalog);
  if (!hasTeamSpecificPrior(row)) return { ...priorUnit(0), catalog: row || null, teamSpecific: false };
  return {
    off: Number(row.off),
    def: Number(row.def),
    power: row.sp ?? row.fpi ?? row.srs ?? row.power ?? 0,
    teamSpecific: true,
    catalog: row,
  };
}

function lookupFeatureRow(team, featureCatalog = {}) {
  if (!team) return null;
  const id = team.espnId != null ? String(team.espnId) : "";
  if (id && featureCatalog.byEspnId?.[id]) return featureCatalog.byEspnId[id];
  const schoolKey = String(team.school || team.fullName || team.name || "").trim().toLowerCase();
  if (schoolKey && featureCatalog.bySchool?.[schoolKey]) return featureCatalog.bySchool[schoolKey];
  const resolved = resolveTeamExact("cfb", team);
  if (resolved?.espnId && featureCatalog.byEspnId?.[String(resolved.espnId)]) {
    return featureCatalog.byEspnId[String(resolved.espnId)];
  }
  const resolvedSchool = String(resolved?.school || "").trim().toLowerCase();
  if (resolvedSchool && featureCatalog.bySchool?.[resolvedSchool]) return featureCatalog.bySchool[resolvedSchool];
  return null;
}

export function buildCfbFeatureVector(team, { priorCatalogRow = null, featureCatalog = {}, qbSignals = {} } = {}) {
  const row = lookupFeatureRow(team, featureCatalog) || {};
  const qb = team?.espnId != null ? qbSignals[String(team.espnId)] : null;
  const epaRaw = strictNum(row.epaNet ?? (row.epaOff != null && row.epaDef != null ? row.epaOff - row.epaDef : null));
  const epaNorm = toSignedUnit(epaRaw, -0.5, 0.5);
  const transferNorm = toSignedUnit(row.transferNet, -15, 15);
  const qbTransferNorm = toSignedUnit(row.qbTransferNet, -2, 2);
  const transferStarNorm = toSignedUnit(row.transferStarDelta, -12, 12);
  const returningPct = strictNum(row.returningPct ?? priorCatalogRow?.returningPct);
  const returningNorm = toSignedUnit(returningPct, 35, 75);
  const talent = strictNum(priorCatalogRow?.talent);
  const talentNorm = toSignedUnit(talent, 780, 980);
  const coachTenureNorm = toUnit(row.coachTenure, 0, 8);
  const coachingNorm = row.newCoach ? -0.75 : coachTenureNorm == null ? null : clamp((coachTenureNorm - 0.25) * 1.2, -1, 1);
  const qbExperienceNorm = toUnit(qb?.starterClass, 1, 5);
  const qbContinuityNorm = qb?.starterKnown ? clamp(((qbExperienceNorm ?? 0.5) - 0.4) * 1.6, -1, 1) : null;
  const qbPriorPpaNorm = toSignedUnit(row.qbPriorPpa, -0.25, 0.45);
  const qbPriorYpaNorm = toSignedUnit(row.qbPriorYpa, 4.5, 10.5);
  const qbPriorSuccessNorm = toSignedUnit(row.qbPriorSuccessRate, 0.28, 0.58);
  const qbPriorRiskNorm = toSignedUnit(
    row.qbPriorSackRate != null && row.qbPriorTurnoverRate != null
      ? -(Number(row.qbPriorSackRate) + Number(row.qbPriorTurnoverRate))
      : null,
    -0.22,
    -0.03
  );
  const qbPriorComposite =
    qbPriorPpaNorm != null || qbPriorYpaNorm != null || qbPriorSuccessNorm != null || qbPriorRiskNorm != null
      ? clamp(
          ((qbPriorPpaNorm ?? 0) * 0.4 + (qbPriorYpaNorm ?? 0) * 0.25 + (qbPriorSuccessNorm ?? 0) * 0.2 + (qbPriorRiskNorm ?? 0) * 0.15) /
            ((qbPriorPpaNorm != null ? 0.4 : 0) + (qbPriorYpaNorm != null ? 0.25 : 0) + (qbPriorSuccessNorm != null ? 0.2 : 0) + (qbPriorRiskNorm != null ? 0.15 : 0)),
          -1,
          1
        )
      : null;
  const qbComposite =
    qbTransferNorm != null && qbContinuityNorm != null && qbPriorComposite != null
      ? clamp(qbTransferNorm * 0.4 + qbContinuityNorm * 0.3 + qbPriorComposite * 0.3, -1, 1)
      : qbPriorComposite ?? (qbTransferNorm != null && qbContinuityNorm != null ? clamp(qbTransferNorm * 0.6 + qbContinuityNorm * 0.4, -1, 1) : qbTransferNorm ?? qbContinuityNorm ?? null);
  const transferComposite =
    transferNorm != null && transferStarNorm != null ? clamp(transferNorm * 0.6 + transferStarNorm * 0.4, -1, 1) : transferNorm ?? transferStarNorm ?? null;
  const components = {
    epa: epaNorm,
    transfer: transferComposite,
    qb: qbComposite,
    coaching: coachingNorm,
    returning: returningNorm,
    talent: talentNorm,
  };
  const offAdj = round2(
    (components.epa ?? 0) * CFB_CONSTANTS.epaScale +
      (components.transfer ?? 0) * CFB_CONSTANTS.transferScale +
      (components.qb ?? 0) * CFB_CONSTANTS.qbScale +
      (components.returning ?? 0) * CFB_CONSTANTS.returningScale +
      (components.talent ?? 0) * CFB_CONSTANTS.talentScale
  );
  const defAdj = round2(
    -(components.epa ?? 0) * (CFB_CONSTANTS.epaScale * 0.8) +
      (components.returning ?? 0) * (CFB_CONSTANTS.returningScale * 0.5) +
      (components.talent ?? 0) * (CFB_CONSTANTS.talentScale * 0.6) +
      (components.coaching ?? 0) * CFB_CONSTANTS.coachingScale
  );
  const used = Object.entries(components)
    .filter(([, v]) => v != null)
    .map(([k]) => k);
  const missing = Object.entries(components)
    .filter(([, v]) => v == null)
    .map(([k]) => `${k}_missing`);
  return {
    components,
    raw: {
      epaNet: epaRaw,
      transferNet: strictNum(row.transferNet),
      qbTransferNet: strictNum(row.qbTransferNet),
      transferStarDelta: strictNum(row.transferStarDelta),
      qbPriorCount: strictNum(row.qbPriorCount),
      qbPriorPpa: strictNum(row.qbPriorPpa),
      qbPriorWepa: strictNum(row.qbPriorWepa),
      qbPriorSuccessRate: strictNum(row.qbPriorSuccessRate),
      qbPriorExplosiveRate: strictNum(row.qbPriorExplosiveRate),
      qbPriorSackRate: strictNum(row.qbPriorSackRate),
      qbPriorTurnoverRate: strictNum(row.qbPriorTurnoverRate),
      qbPriorYpa: strictNum(row.qbPriorYpa),
      qbPriorPassAttempts: strictNum(row.qbPriorPassAttempts),
      qbPriorGamesStarted: strictNum(row.qbPriorGamesStarted),
      returningPct,
      talent,
      coachTenure: strictNum(row.coachTenure),
      newCoach: Boolean(row.newCoach),
      qbStarterKnown: Boolean(qb?.starterKnown),
      qbStarterClass: qb?.starterClass ?? null,
      qbStarterTransfer: Boolean(qb?.starterTransfer),
    },
    qb: qb || null,
    source: {
      epa: row.epaNet != null || row.epaOff != null || row.epaDef != null ? "cfbd" : null,
      transfer: row.transferNet != null || row.transferStarDelta != null ? "cfbd" : null,
      coaching: row.coachTenure != null || row.newCoach ? "cfbd" : null,
      qb:
        qb?.starterKnown || row.qbPriorPpa != null || row.qbPriorYpa != null
          ? "espn+cfbd-transfer-history"
          : row.qbTransferNet != null
            ? "cfbd-transfer"
            : null,
      returning: returningPct != null ? row.returningPct != null ? "cfbd" : "prior" : null,
      talent: talent != null ? "cfbd-prior" : null,
    },
    offAdj,
    defAdj,
    used,
    missing,
  };
}

export function estimateTeam(team, { rankings, form, rankFallback, catalog, priorMeta, featureCatalog, qbSignals } = {}) {
  const ranked = lookupRank(rankings || { byTeam: new Map() }, team);
  const rank = ranked?.rank ?? (team?.rank && team.rank < 99 ? team.rank : rankFallback ?? null);
  const priorCat = priorFromCatalog(team, catalog);
  const power = priorCat.teamSpecific ? priorCat.power : powerFromRank(rank);
  const prior = priorCat.teamSpecific ? priorCat : priorUnit(power);
  const key = teamKey(team);
  const row = form?.get(key) || form?.get(`abbr:${String(team?.abbr || "").toUpperCase()}`) || null;
  const n = row?.games ?? gamesFromRecord(team?.record);
  const currentOff = row?.pointsFor != null && row.games ? row.pointsFor / row.games : null;
  const currentDef = row?.pointsAgainst != null && row.games ? row.pointsAgainst / row.games : null;
  const off = blendSeason(prior.off, currentOff, n);
  const def = blendSeason(prior.def, currentDef, n);
  const features = buildCfbFeatureVector(team, {
    priorCatalogRow: priorCat.catalog,
    featureCatalog,
    qbSignals,
  });
  const adjustedOff = round2(clamp(off.value + features.offAdj, 8, 55));
  const adjustedDef = round2(clamp(def.value - features.defAdj, 8, 55));
  const noTeamForm = currentOff == null;
  const priorMissing = !priorCat.teamSpecific;
  return {
    key,
    rank,
    poll: ranked?.poll || null,
    n,
    power,
    priorOff: prior.off,
    priorDef: prior.def,
    currentOff,
    currentDef,
    off: adjustedOff,
    def: adjustedDef,
    offBase: off.value,
    defBase: def.value,
    featureVector: features,
    w: off.w,
    teamSpecificPrior: priorCat.teamSpecific,
    priorFrozen: freezePrior(priorCat.catalog, priorMeta),
    provisional: Boolean(priorCat.catalog?.provisional),
    classification: priorCat.catalog?.classification || null,
    flags: [
      rank == null ? "unranked" : null,
      n < 3 ? "early_season" : null,
      noTeamForm ? "no_current_ppg" : null,
      noTeamForm ? "form_missing" : null,
      priorMissing ? "team_prior_missing" : null,
      ...features.missing,
      priorCat.catalog?.classification === "FCS" ? "fcs" : null,
      priorCat.catalog?.newlyPromoted ? "newly_promoted" : null,
    ].filter(Boolean),
  };
}

export function classifyCfbState(home, away) {
  const homePrior = Boolean(home?.teamSpecificPrior);
  const awayPrior = Boolean(away?.teamSpecificPrior);
  const homeForm = home?.currentOff != null;
  const awayForm = away?.currentOff != null;
  if (!homePrior && !awayPrior) return PROJECTION_STATES.LEAGUE_AVERAGE_ONLY;
  if (!homePrior || !awayPrior) return PROJECTION_STATES.PARTIAL;
  if (!homeForm && !awayForm) return PROJECTION_STATES.PRIOR_ONLY;
  if (homeForm && awayForm) return PROJECTION_STATES.COMPLETE;
  return PROJECTION_STATES.PARTIAL;
}

export function cfbBettingAllowed(state, home, away) {
  if (state !== PROJECTION_STATES.COMPLETE && state !== PROJECTION_STATES.PRIOR_ONLY) return false;
  if (!home?.teamSpecificPrior || !away?.teamSpecificPrior) return false;
  if (home.provisional || away.provisional) return false;
  return true;
}

export function projectCfbGame(game, ctx = {}) {
  const rankingsUnavailable = Boolean(ctx.rankingsUnavailable || ctx.rankings?.error);
  const formUnavailable = !ctx.form || ctx.form.size === 0;
  const home = estimateTeam(game.home, ctx);
  const away = estimateTeam(game.away, ctx);
  const priorVersion = ctx.priorMeta?.version || home.priorFrozen?.version || away.priorFrozen?.version || CFB_PRIOR_VERSION;
  const venue = championHfaForGame(game);
  const hfa = venue.hfa;
  const scores = projectCfbMatchup({
    homeOff: home.off,
    homeDef: home.def,
    awayOff: away.off,
    awayDef: away.def,
    hfa,
  });
  const sig = cfbSigma({ gamesHome: home.n, gamesAway: away.n });
  const bothUnranked = home.rank == null && away.rank == null;
  const noTeamForm = home.currentOff == null && away.currentOff == null;
  const projectionState = classifyCfbState(home, away);
  const leagueAverageOnly = projectionState === PROJECTION_STATES.LEAGUE_AVERAGE_ONLY;
  const bettingAllowed = cfbBettingAllowed(projectionState, home, away);
  const homeFeatureCount = home.featureVector?.used?.length || 0;
  const awayFeatureCount = away.featureVector?.used?.length || 0;
  const featureSparse = homeFeatureCount < 2 || awayFeatureCount < 2;
  const marketUnavailable = game.odds?.total == null && game.odds?.spread == null && game.pinSpread == null && game.pinTotal == null;
  const completeness =
    1 -
    [
      home.rank == null,
      away.rank == null,
      home.currentOff == null,
      away.currentOff == null,
      !home.teamSpecificPrior,
      !away.teamSpecificPrior,
      rankingsUnavailable,
      formUnavailable,
      featureSparse,
      venue.uncertain,
      marketUnavailable,
    ].filter(
      Boolean
    ).length *
      0.09;
  const flags = [
    ...home.flags.map((f) => `home_${f}`),
    ...away.flags.map((f) => `away_${f}`),
    game.neutralSite ? "neutral_site" : null,
    home.n < 3 || away.n < 3 ? "early_season" : null,
    rankingsUnavailable ? "rankings_unavailable" : null,
    bothUnranked ? "both_unranked" : null,
    home.rank == null ? "home_unranked" : null,
    away.rank == null ? "away_unranked" : null,
    home.currentOff == null ? "home_form_missing" : null,
    away.currentOff == null ? "away_form_missing" : null,
    !home.teamSpecificPrior ? "home_team_prior_missing" : null,
    !away.teamSpecificPrior ? "away_team_prior_missing" : null,
    noTeamForm || formUnavailable ? "no_team_form" : null,
    featureSparse ? "feature_sparse" : null,
    homeFeatureCount ? null : "home_feature_missing",
    awayFeatureCount ? null : "away_feature_missing",
    leagueAverageOnly ? "league_average_only" : null,
    venue.uncertain ? "venue_uncertain" : null,
    marketUnavailable ? "market_unavailable" : null,
    bettingAllowed ? null : "qualification_blocked",
    ...venue.flags,
  ].filter(Boolean);
  const qualityFloor = leagueAverageOnly || rankingsUnavailable ? 0.08 : bettingAllowed ? 0.35 : 0.2;
  const scoreIsDefensible = home.teamSpecificPrior && away.teamSpecificPrior;
  return {
    ...(scoreIsDefensible ? scores : { home: null, away: null, total: null, margin: null }),
    diagnosticScores: scoreIsDefensible ? null : scores,
    hfa,
    homeEst: home,
    awayEst: away,
    sigmaMargin: sig.margin,
    sigmaTotal: sig.total,
    maturity: sig.maturity,
    projectionState,
    bettingAllowed,
    blockReason: bettingAllowed ? null : CFB_BLOCKED_MESSAGE,
    dataQuality: Math.round(Math.max(qualityFloor, Math.min(1, completeness)) * 100),
    flags,
    venue,
    priorVersion,
    features: {
      home: home.featureVector,
      away: away.featureVector,
      summary: {
        homeUsed: home.featureVector?.used || [],
        awayUsed: away.featureVector?.used || [],
      },
    },
    constants: {
      priorGames: CFB_CONSTANTS.priorGames,
      hfaPoints: hfa,
      model: priorVersion,
      priorVersion,
      scales: {
        epa: CFB_CONSTANTS.epaScale,
        transfer: CFB_CONSTANTS.transferScale,
        qb: CFB_CONSTANTS.qbScale,
        coaching: CFB_CONSTANTS.coachingScale,
        returning: CFB_CONSTANTS.returningScale,
        talent: CFB_CONSTANTS.talentScale,
      },
    },
  };
}

async function fetchEspnJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.espn.com/",
    },
  });
  if (!res.ok) throw new Error(`ESPN CFB ${res.status}`);
  return res.json();
}

export async function loadCfbRankings(cfCache) {
  const key = "cfb-rankings-v1";
  const cached = await readCache(key, cfCache, RANK_TTL_MS);
  if (cached?.byTeam) {
    return { ...cached, byTeam: new Map(cached.byTeam) };
  }
  const json = await fetchEspnJson("https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings");
  const parsed = parseEspnRankings(json);
  await writeCache(key, { poll: parsed.poll, season: parsed.season, byTeam: [...parsed.byTeam.entries()] }, cfCache, RANK_TTL_MS);
  return parsed;
}

function flattenEspnAthletes(payload) {
  const groups = payload?.athletes || payload?.team?.athletes || [];
  const flat = [];
  for (const g of groups) {
    if (Array.isArray(g?.items)) flat.push(...g.items);
    else if (Array.isArray(g?.athletes)) flat.push(...g.athletes);
    else if (g && typeof g === "object" && (g.position || g.displayName)) flat.push(g);
  }
  return flat;
}

function experienceYear(raw) {
  const y = num(raw?.experience?.year ?? raw?.experience?.value ?? raw?.experienceYear ?? raw?.classRank);
  if (y != null) return y;
  const text = String(raw?.experience?.displayValue || raw?.experience?.name || raw?.class || "").toLowerCase();
  if (/fresh|fr\b/.test(text)) return 1;
  if (/soph|so\b/.test(text)) return 2;
  if (/jun|jr\b/.test(text)) return 3;
  if (/sen|sr\b|grad/.test(text)) return 4;
  return null;
}

function parseQbSignals(payload) {
  const athletes = flattenEspnAthletes(payload);
  const qbs = athletes
    .filter((a) => {
      const pos = String(a?.position?.abbreviation || a?.position?.name || "").toUpperCase();
      return pos === "QB" || /QUARTERBACK/.test(pos);
    })
    .map((a) => ({
      name: a?.displayName || a?.fullName || a?.shortName || null,
      classYear: experienceYear(a),
      starter: Boolean(a?.starter) || /starter|qb1/.test(String(a?.status?.type?.detail || "").toLowerCase()),
      transfer:
        Boolean(a?.transfer) ||
        Boolean(a?.previousSchool) ||
        /transfer/.test(
          `${a?.status?.type?.detail || ""} ${a?.status?.displayValue || ""} ${a?.displayName || ""}`.toLowerCase()
        ),
    }));
  if (!qbs.length) return { starterKnown: false, starterClass: null, starterTransfer: false, qbDepth: 0, qbNames: [] };
  qbs.sort((a, b) => {
    const s = Number(b.starter) - Number(a.starter);
    if (s) return s;
    return Number(b.classYear || 0) - Number(a.classYear || 0);
  });
  const starter = qbs[0];
  return {
    starterKnown: Boolean(starter?.name),
    starterName: starter?.name || null,
    starterClass: starter?.classYear ?? null,
    starterTransfer: Boolean(starter?.transfer),
    qbDepth: qbs.length,
    qbNames: qbs.map((q) => q.name).filter(Boolean).slice(0, 4),
  };
}

async function loadQbSignalForTeam(teamId, season, cfCache) {
  const cacheKey = `cfb-qb-signal-v1:${season}:${teamId}`;
  const cached = await readCache(cacheKey, cfCache, QB_TTL_MS);
  if (cached) return cached;
  try {
    const roster = await fetchEspnJson(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/roster`);
    const parsed = parseQbSignals(roster);
    await writeCache(cacheKey, parsed, cfCache, QB_TTL_MS);
    return parsed;
  } catch (err) {
    const fallback = {
      starterKnown: false,
      starterClass: null,
      starterTransfer: false,
      qbDepth: 0,
      error: String(err?.message || err),
    };
    await writeCache(cacheKey, fallback, cfCache, 20 * 60 * 1000);
    return fallback;
  }
}

async function loadQbSignals(games, season, cfCache) {
  const ids = new Set();
  for (const g of games || []) {
    if (g?.home?.espnId) ids.add(String(g.home.espnId));
    if (g?.away?.espnId) ids.add(String(g.away.espnId));
  }
  const out = {};
  await Promise.all(
    [...ids].map(async (id) => {
      out[id] = await loadQbSignalForTeam(id, season, cfCache);
    })
  );
  return out;
}

export async function applyCfbModel(games, env = {}) {
  let rankings = { byTeam: new Map(), poll: null };
  try {
    rankings = await loadCfbRankings(env.caches);
  } catch (err) {
    rankings = { byTeam: new Map(), poll: null, error: String(err?.message || err) };
  }
  const season = cfbSeasonYear();
  const form = await loadTeamForm(env, "cfb", season);
  const priorBundle = await loadCfbPrior(env);
  const featureBundle = await loadCfbFeatureFeeds(env);
  const weeks = [...new Set((games || []).map((g) => Number(g.week)).filter((n) => Number.isFinite(n)))];
  const linesBundle = await loadCfbBettingLines(env, { year: season, weeks: weeks.length ? weeks : undefined });
  const qbSignals = await loadQbSignals(games || [], season, env.caches);
  const rankingsUnavailable = Boolean(rankings.error) || !rankings.byTeam?.size;
  let scoreByTeam = {};
  let marketByTeam = {};
  try {
    scoreByTeam = await loadHfaRatings(env, "score-based", season - 1);
    marketByTeam = await loadHfaRatings(env, "market-residual", season - 1);
  } catch {
    scoreByTeam = {};
    marketByTeam = {};
  }
  const scoreFit = Object.keys(scoreByTeam).length
    ? { available: true, byTeam: scoreByTeam }
    : { available: false, reason: "insufficient-data", byTeam: {} };
  const marketFit = Object.keys(marketByTeam).length
    ? { available: true, byTeam: marketByTeam }
    : { available: false, reason: "no-timestamped-closes", byTeam: {}, note: "No timestamped historical closing lines are stored." };
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const awaySchool = resolveTeamExact("cfb", game.away)?.school || game.away?.school || game.away?.name || "";
    const homeSchool = resolveTeamExact("cfb", game.home)?.school || game.home?.school || game.home?.name || "";
    const lineKey = `${String(awaySchool).trim().toLowerCase()}@${String(homeSchool).trim().toLowerCase()}`;
    const cfbdLine = linesBundle.byGame?.[lineKey] ||
      linesBundle.byGame?.[`${String(game.away?.school || game.away?.name || "").trim().toLowerCase()}@${String(game.home?.school || game.home?.name || "").trim().toLowerCase()}`] ||
      null;
    const odds = { ...(game.odds || {}) };
    if (odds.spread == null && cfbdLine?.spread != null) odds.spread = cfbdLine.spread;
    if (odds.total == null && cfbdLine?.total != null) odds.total = cfbdLine.total;
    if (odds.pinHomeMl == null && cfbdLine?.homeMl != null) odds.pinHomeMl = cfbdLine.homeMl;
    if (odds.pinAwayMl == null && cfbdLine?.awayMl != null) odds.pinAwayMl = cfbdLine.awayMl;
    const linedGame = { ...game, odds };
    const marketHome =
      linedGame.odds?.total != null && linedGame.odds?.spread != null
        ? linedGame.odds.total / 2 - linedGame.odds.spread / 2
        : null;
    const marketAway =
      linedGame.odds?.total != null && linedGame.odds?.spread != null
        ? linedGame.odds.total / 2 + linedGame.odds.spread / 2
        : null;
    const proj = projectCfbGame(linedGame, {
      rankings,
      form,
      rankingsUnavailable,
      catalog: priorBundle.catalog,
      priorMeta: priorBundle.meta,
      featureCatalog: featureBundle.catalog,
      qbSignals,
    });
    const shadowHfa = buildShadowHfa(linedGame, {
      scoreFit,
      marketFit,
      homeEst: proj.homeEst,
      awayEst: proj.awayEst,
    });
    return {
      ...linedGame,
      marketProjHome: marketHome,
      marketProjAway: marketAway,
      projHomeScore: proj.home,
      projAwayScore: proj.away,
      projectionState: proj.projectionState,
      projectionKind: "FBIS",
      qualificationBlocked: !proj.bettingAllowed,
      cfb: { ...proj, shadowHfa, cfbdLine: cfbdLine || null },
    };
  });
  const diagnostics = cfbSlateDiagnostics(next);
  const evidence = summarizeCfbEvidenceCoverage(next);
  return {
    games: next,
    meta: {
      enabled: true,
      poll: rankings.poll || null,
      ranked: rankings.byTeam?.size || 0,
      formTeams: form.size,
      error: rankings.error || null,
      constants: CFB_CONSTANTS,
      priorVersion: priorBundle.version || CFB_PRIOR_VERSION,
      cfbd: cfbdPublicMeta(priorBundle.meta),
      cfbFeatures: cfbdPublicMeta(featureBundle.meta),
      cfbLines: cfbdPublicMeta(linesBundle.meta),
      diagnostics,
      evidenceCoverage: evidence,
    },
  };
}

export function summarizeCfbEvidenceCoverage(games = []) {
  const missing = {
    epa_missing: 0,
    coaching_missing: 0,
    missing_lines: 0,
    qb_missing: 0,
    transfer_missing: 0,
    returning_missing: 0,
    talent_missing: 0,
  };
  let complete = 0;
  let partial = 0;
  let blocked = 0;
  for (const g of games || []) {
    const homeMissing = g.cfb?.homeEst?.featureVector?.missing || [];
    const awayMissing = g.cfb?.awayEst?.featureVector?.missing || [];
    const both = [...homeMissing, ...awayMissing];
    for (const key of Object.keys(missing)) {
      if (key === "missing_lines") continue;
      missing[key] += both.filter((k) => k === key).length;
    }
    if (g.odds?.spread == null && g.odds?.total == null) missing.missing_lines += 1;
    if (g.qualificationBlocked || g.cfb?.bettingAllowed === false) blocked += 1;
    const state = g.cfb?.projectionState || g.projectionState;
    if (state === "COMPLETE") complete += 1;
    else if (state === "PARTIAL") partial += 1;
  }
  return {
    games: (games || []).length,
    complete,
    partial,
    blocked,
    missing,
    qualificationReady: blocked === 0 && missing.epa_missing === 0 && missing.coaching_missing === 0 && missing.missing_lines === 0,
  };
}

/** Used by harvest to fold a final into as-of team form without touching pregame snapshots. */
export function formDelta(final) {
  const hs = num(final.home?.score);
  const as = num(final.away?.score);
  if (hs == null || as == null) return [];
  return [
    { team: final.home, pointsFor: hs, pointsAgainst: as },
    { team: final.away, pointsFor: as, pointsAgainst: hs },
  ];
}
