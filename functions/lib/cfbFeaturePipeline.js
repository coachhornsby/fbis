/**
 * CFBD → FBIS canonical CFB feature pipeline.
 * Only uses endpoints confirmed AVAILABLE by audit (or assumed until audit merges).
 * Missing values stay null — never zero-filled. Market lines never enter independent scores.
 */

import { cfbdGet } from "./collegeApi.js";
import { CFBD_FEATURE_CATALOG } from "./cfbdFeatureCatalog.js";
import {
  filterGamesBeforeKickoff,
  rollingTeamStrengthFromGames,
  blendPriorCurrent,
  buildPregameFeatureRecord,
  SOURCE_VERSION,
} from "./cfbFeatureStore.js";

export const PIPELINE_VERSION = "cfb-feature-pipeline-v2";

/** Temporal safety classes (Phase 4). */
export const TEMPORAL_CLASS = {
  A: "PRE-KICKOFF-SAFE-DIRECTLY",
  B: "SAFE-IF-WEEK-GAME-FILTERED",
  C: "MUST-RECONSTRUCT-FROM-GAME-PLAY",
  D: "NOT-SAFE-FOR-HISTORICAL-BACKTEST",
  E: "EVALUATION-ONLY",
};

export function temporalClassForFeature(feature) {
  if (feature.use === "evaluation") return TEMPORAL_CLASS.E;
  if (feature.pregameSafe === true && feature.leakageRisk === "none") return TEMPORAL_CLASS.A;
  if (feature.grain === "game") return TEMPORAL_CLASS.B;
  if (feature.endpoint === "/ppa/games" || feature.endpoint === "/stats/game/advanced") return TEMPORAL_CLASS.B;
  if (
    ["/ppa/teams", "/stats/season/advanced", "/stats/season"].includes(feature.endpoint) ||
    (feature.grain === "season" && feature.leakageRisk === "high" && feature.use === "matchup")
  ) {
    return TEMPORAL_CLASS.C;
  }
  if (feature.grain === "season" && ["prior", "benchmark"].includes(feature.use)) {
    // Prior-season freeze is A; same-season SP+/FPI without dated observation is D
    return TEMPORAL_CLASS.D;
  }
  if (feature.pregameSafe === true) return TEMPORAL_CLASS.A;
  return TEMPORAL_CLASS.D;
}

export function catalogWithTemporalClasses(auditByEndpoint = {}) {
  return CFBD_FEATURE_CATALOG.map((f) => {
    const audit = auditByEndpoint[f.endpoint];
    const entitled =
      f.endpoint === "internal"
        ? true
        : audit
          ? ["AVAILABLE", "AVAILABLE-BUT-EMPTY"].includes(audit.classification)
          : null;
    return {
      ...f,
      temporalClass: temporalClassForFeature(f),
      auditClassification: audit?.classification || (f.endpoint === "internal" ? "INTERNAL" : "UNPROBED"),
      entitled,
      sampleFieldNames: audit?.sampleFieldNames || f.rawFields,
    };
  });
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

function pickNested(row, path) {
  return path.split(".").reduce((cur, key) => (cur == null ? null : cur[key]), row);
}

function indexByTeam(rows, nameKeys = ["team", "school"]) {
  const out = {};
  for (const row of rows || []) {
    for (const k of nameKeys) {
      const key = schoolKey(row[k]);
      if (key) {
        out[key] = row;
        break;
      }
    }
  }
  return out;
}

/**
 * Fetch a season bundle for pipeline use. Caller supplies which endpoints are entitled.
 */
export async function fetchSeasonFeatureBundle(env, season, { entitled = null, week = null, fetchFn = fetch } = {}) {
  const allow = (path) => {
    if (!entitled) return true;
    return entitled.has(path) || entitled.has("*");
  };
  const get = async (path, query) => {
    if (!allow(path)) return { ok: false, path, data: [], skipped: true, reason: "not-entitled" };
    const res = await cfbdGet(path, env, { query, fetchFn, skipCache: false });
    return { ok: res.ok, path, data: res.ok ? res.data || [] : [], status: res.status, reason: res.reason };
  };

  const [sp, fpi, srs, elo, core, ppaTeams, talent, returning, recruiting, venues, coaches] = await Promise.all([
    get("/ratings/sp", { year: season }),
    get("/ratings/fpi", { year: season }),
    get("/ratings/srs", { year: season }),
    get("/ratings/elo", { year: season }),
    get("/ratings/core", { year: season }),
    get("/ppa/teams", { year: season, seasonType: "regular" }),
    get("/talent", { year: season }),
    get("/player/returning", { year: season }),
    get("/recruiting/teams", { year: season }),
    get("/venues", {}),
    get("/coaches", { year: season }),
  ]);

  // Week-scoped game PPA / advanced for reconstruction (optional)
  let ppaGames = { ok: false, data: [], path: "/ppa/games" };
  let advGames = { ok: false, data: [], path: "/stats/game/advanced" };
  let games = { ok: false, data: [], path: "/games" };
  let lines = { ok: false, data: [], path: "/lines" };
  let weather = { ok: false, data: [], path: "/games/weather" };
  let qbPpa = { ok: false, data: [], path: "/ppa/players/season" };
  let usage = { ok: false, data: [], path: "/player/usage" };
  let advSeason = { ok: false, data: [], path: "/stats/season/advanced" };

  if (week != null) {
    ppaGames = await get("/ppa/games", { year: season, week, seasonType: "regular" });
    advGames = await get("/stats/game/advanced", { year: season, week, seasonType: "regular" });
    games = await get("/games", { year: season, week, seasonType: "regular" });
    lines = await get("/lines", { year: season, week, seasonType: "regular" });
    weather = await get("/games/weather", { year: season, week, seasonType: "regular" });
  } else {
    games = await get("/games", { year: season, seasonType: "regular" });
  }
  qbPpa = await get("/ppa/players/season", { year: season, position: "QB" });
  usage = await get("/player/usage", { year: season });
  advSeason = await get("/stats/season/advanced", { year: season });

  return {
    season,
    week,
    collectedAt: new Date().toISOString(),
    pipelineVersion: PIPELINE_VERSION,
    endpoints: {
      sp,
      fpi,
      srs,
      elo,
      core,
      ppaTeams,
      ppaGames,
      advSeason,
      advGames,
      talent,
      returning,
      recruiting,
      venues,
      coaches,
      games,
      lines,
      weather,
      qbPpa,
      usage,
    },
  };
}

/**
 * Build per-team prior from PRIOR season ratings only (temporal-safe for early weeks).
 * Ratings are regularized — correlated SP+/FPI/SRS/Elo are not naïvely averaged 1:1.
 */
export function buildPriorCatalog(priorSeasonBundle) {
  const sp = indexByTeam(priorSeasonBundle?.endpoints?.sp?.data);
  const fpi = indexByTeam(priorSeasonBundle?.endpoints?.fpi?.data);
  const srs = indexByTeam(priorSeasonBundle?.endpoints?.srs?.data);
  const elo = indexByTeam(priorSeasonBundle?.endpoints?.elo?.data);
  const core = indexByTeam(priorSeasonBundle?.endpoints?.core?.data);
  const talent = indexByTeam(priorSeasonBundle?.endpoints?.talent?.data, ["school", "team"]);
  const returning = indexByTeam(priorSeasonBundle?.endpoints?.returning?.data);
  const recruiting = indexByTeam(priorSeasonBundle?.endpoints?.recruiting?.data);
  const ppa = indexByTeam(priorSeasonBundle?.endpoints?.ppaTeams?.data);

  const schools = new Set([
    ...Object.keys(sp),
    ...Object.keys(fpi),
    ...Object.keys(srs),
    ...Object.keys(elo),
    ...Object.keys(core),
  ]);

  const bySchool = {};
  for (const key of schools) {
    const spRow = sp[key] || {};
    const fpiRow = fpi[key] || {};
    const srsRow = srs[key] || {};
    const eloRow = elo[key] || {};
    const coreRow = core[key] || {};
    const ppaRow = ppa[key] || {};
    const talentRow = talent[key] || {};
    const retRow = returning[key] || {};
    const recRow = recruiting[key] || {};
    const classification = String(srsRow.division || spRow.conference || "").toUpperCase().includes("FCS")
      ? "FCS"
      : srsRow.division || null;

    const priorBlend = regularizePreseasonPrior({
      spOverall: num(spRow.rating),
      spOffense: num(spRow.offense?.rating),
      spDefense: num(spRow.defense?.rating),
      fpi: num(fpiRow.fpi ?? fpiRow.rating),
      srs: num(srsRow.rating),
      elo: num(eloRow.elo),
      coreOverall: num(coreRow.rating ?? coreRow.overall),
      coreOffense: num(coreRow.offense?.rating ?? coreRow.offense),
      coreDefense: num(coreRow.defense?.rating ?? coreRow.defense),
      talent: num(talentRow.talent),
      returningPct: num(retRow.percentPPA ?? retRow.usage),
      recruitingPoints: num(recRow.points),
    });

    bySchool[key] = {
      school: spRow.team || fpiRow.team || srsRow.team || eloRow.team || coreRow.team || key,
      conference: spRow.conference || fpiRow.conference || srsRow.conference || coreRow.conference || null,
      classification,
      spOverall: num(spRow.rating),
      priorOff: priorBlend.priorOff,
      priorDef: priorBlend.priorDef,
      priorOverall: priorBlend.priorOverall,
      priorBlend,
      fpi: num(fpiRow.fpi ?? fpiRow.rating),
      srs: num(srsRow.rating),
      elo: num(eloRow.elo),
      coreOverall: num(coreRow.rating ?? coreRow.overall),
      talent: num(talentRow.talent),
      returningPct: num(retRow.percentPPA ?? retRow.usage),
      recruitingPoints: num(recRow.points),
      priorPassPpa: num(ppaRow.offense?.passing),
      priorRushPpa: num(ppaRow.offense?.rushing),
      priorPassPpaAllowed: num(ppaRow.defense?.passing),
      priorRushPpaAllowed: num(ppaRow.defense?.rushing),
      missingness: {
        sp: spRow.rating == null,
        fpi: fpiRow.fpi == null && fpiRow.rating == null,
        srs: srsRow.rating == null,
        elo: eloRow.elo == null,
        core: coreRow.rating == null && coreRow.overall == null,
        talent: talentRow.talent == null,
        returning: retRow.percentPPA == null && retRow.usage == null,
      },
      sourceSeason: priorSeasonBundle?.season ?? null,
      temporalClass: TEMPORAL_CLASS.A,
      provenance: "prior-season-freeze",
      artifactHash: priorBlend.hash,
    };
  }
  return { bySchool, season: priorSeasonBundle?.season ?? null, n: Object.keys(bySchool).length, frozen: true };
}

/**
 * Regularized preseason prior — avoid double-counting correlated ratings.
 * Weights prefer SP+ offense/defense when present; FPI/SRS/Elo/CORE shrink toward consensus.
 */
export function regularizePreseasonPrior(input = {}) {
  const spOff = num(input.spOffense);
  const spDef = num(input.spDefense);
  const coreOff = num(input.coreOffense);
  const coreDef = num(input.coreDefense);
  const fpi = num(input.fpi);
  const srs = num(input.srs);
  const eloPower = num(input.elo) != null ? (num(input.elo) - 1500) / 25 : null;
  const core = num(input.coreOverall);
  const sp = num(input.spOverall);

  // Overall consensus with diminishing weights for correlated strength ratings
  const overallParts = [];
  if (sp != null) overallParts.push({ v: sp, w: 0.35 });
  if (core != null) overallParts.push({ v: core, w: 0.25 });
  if (fpi != null) overallParts.push({ v: fpi, w: 0.2 });
  if (srs != null) overallParts.push({ v: srs, w: 0.12 });
  if (eloPower != null) overallParts.push({ v: eloPower, w: 0.08 });
  const wSum = overallParts.reduce((a, p) => a + p.w, 0) || 1;
  const priorOverall =
    overallParts.length === 0 ? null : overallParts.reduce((a, p) => a + p.v * p.w, 0) / wSum;

  // Offense/defense: prefer SP+, then CORE, else split overall ±0
  let priorOff = spOff;
  let priorDef = spDef;
  if (priorOff == null && coreOff != null) priorOff = coreOff;
  if (priorDef == null && coreDef != null) priorDef = coreDef;
  if (priorOff == null && priorOverall != null) priorOff = 26.5 + priorOverall * 0.35;
  if (priorDef == null && priorOverall != null) priorDef = 26.5 - priorOverall * 0.35;

  // Personnel continuity soft bump (not a rating substitute)
  const returning = num(input.returningPct);
  const talent = num(input.talent);
  const recruiting = num(input.recruitingPoints);
  let personnelAdj = 0;
  if (returning != null) personnelAdj += (returning - 0.55) * 1.5;
  if (talent != null) personnelAdj += (talent - 700) / 400;
  if (recruiting != null) personnelAdj += (recruiting - 200) / 500;
  personnelAdj = Math.max(-1.5, Math.min(1.5, personnelAdj));

  if (priorOff != null) priorOff += personnelAdj * 0.5;
  if (priorDef != null) priorDef -= personnelAdj * 0.35;

  const hashPayload = JSON.stringify({
    sp,
    core,
    fpi,
    srs,
    eloPower,
    priorOff,
    priorDef,
    personnelAdj,
  });
  // Simple stable hash without crypto
  let h = 0;
  for (let i = 0; i < hashPayload.length; i++) h = (h * 31 + hashPayload.charCodeAt(i)) >>> 0;

  return {
    priorOff: priorOff == null ? null : Math.round(priorOff * 100) / 100,
    priorDef: priorDef == null ? null : Math.round(priorDef * 100) / 100,
    priorOverall: priorOverall == null ? null : Math.round(priorOverall * 100) / 100,
    personnelAdj: Math.round(personnelAdj * 100) / 100,
    weights: { sp: 0.35, core: 0.25, fpi: 0.2, srs: 0.12, elo: 0.08 },
    hash: `prior-${h.toString(16)}`,
    method: "regularized-correlated-ratings",
  };
}

/**
 * Rolling current-season strength from game PPA rows strictly before kickoff.
 */
export function buildRollingMatchupFeatures({ ppaGameRows = [], advGameRows = [], team, kickoffTimestamp }) {
  const rolling = rollingTeamStrengthFromGames(ppaGameRows, team, { kickoffTimestamp });
  const teamKey = schoolKey(team);
  const advBefore = filterGamesBeforeKickoff(
    (advGameRows || []).filter((r) => schoolKey(r.team) === teamKey),
    kickoffTimestamp
  );
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const success = avg(advBefore.map((r) => num(r.offense?.successRate)).filter((v) => v != null));
  const successAllowed = avg(advBefore.map((r) => num(r.defense?.successRate)).filter((v) => v != null));
  const explosive = avg(advBefore.map((r) => num(r.offense?.explosiveness)).filter((v) => v != null));
  const explosiveAllowed = avg(advBefore.map((r) => num(r.defense?.explosiveness)).filter((v) => v != null));
  const havoc = avg(advBefore.map((r) => num(r.defense?.havoc?.total ?? r.defense?.havoc)).filter((v) => v != null));
  const havocAllowed = avg(advBefore.map((r) => num(r.offense?.havoc?.total ?? r.offense?.havoc)).filter((v) => v != null));
  const lineYards = avg(advBefore.map((r) => num(r.offense?.lineYards)).filter((v) => v != null));
  const lineYardsAllowed = avg(advBefore.map((r) => num(r.defense?.lineYards)).filter((v) => v != null));
  const stuff = avg(advBefore.map((r) => num(r.defense?.stuffRate)).filter((v) => v != null));
  const ppo = avg(advBefore.map((r) => num(r.offense?.pointsPerOpportunity)).filter((v) => v != null));
  const ppoAllowed = avg(advBefore.map((r) => num(r.defense?.pointsPerOpportunity)).filter((v) => v != null));
  const plays = avg(advBefore.map((r) => num(r.offense?.plays)).filter((v) => v != null));

  return {
    ...rolling,
    successRate: success,
    successRateAllowed: successAllowed,
    explosiveRate: explosive,
    explosiveRateAllowed: explosiveAllowed,
    havocRate: havoc,
    havocAllowed,
    lineYards,
    lineYardsAllowed,
    stuffRate: stuff,
    pointsPerOpportunity: ppo,
    pointsPerOpportunityAllowed: ppoAllowed,
    pacePlays: plays,
    passEpa: rolling.passOffensePpa,
    rushEpa: rolling.rushOffensePpa,
    passEpaAllowed: rolling.passDefensePpa,
    rushEpaAllowed: rolling.rushDefensePpa,
    temporalClass: TEMPORAL_CLASS.C,
    reconstructedFromGames: true,
  };
}

/**
 * FCS conference → FBS-equivalent mapping from SRS/Elo of FCS schools.
 */
export function buildFcsConferenceStrength(priorCatalog) {
  const byConf = {};
  for (const row of Object.values(priorCatalog.bySchool || {})) {
    const isFcs =
      String(row.classification || "").toUpperCase().includes("FCS") ||
      (row.srs != null && row.spOverall == null && row.fpi == null);
    if (!isFcs) continue;
    const conf = row.conference || "FCS-UNKNOWN";
    if (!byConf[conf]) byConf[conf] = { srs: [], elo: [], n: 0 };
    if (row.srs != null) byConf[conf].srs.push(row.srs);
    if (row.elo != null) byConf[conf].elo.push(row.elo);
    byConf[conf].n += 1;
  }
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const out = {};
  for (const [conf, rec] of Object.entries(byConf)) {
    const meanSrs = avg(rec.srs);
    const meanElo = avg(rec.elo);
    // Rough FBS-equivalent power: SRS is already point-ish; Elo → (elo-1500)/25
    const fromElo = meanElo != null ? (meanElo - 1500) / 25 : null;
    out[conf] = {
      conference: conf,
      n: rec.n,
      meanSrs,
      meanElo,
      fbsEquivalentPower: meanSrs != null ? meanSrs : fromElo,
      provisional: rec.n < 4 || (meanSrs == null && fromElo == null),
    };
  }
  return out;
}

export function fcsEquivalentForTeam(teamRow, confMap = {}) {
  if (!teamRow) return { provisional: true, fbsEquivalentPower: null, reason: "missing-team" };
  const isFcs = String(teamRow.classification || "").toUpperCase().includes("FCS");
  if (!isFcs) return { provisional: false, fbsEquivalentPower: null, state: "FBS" };
  if (teamRow.srs != null) {
    return { provisional: false, fbsEquivalentPower: teamRow.srs, state: "FCS_TEAM_SRS", source: "team-srs" };
  }
  if (teamRow.elo != null) {
    return {
      provisional: false,
      fbsEquivalentPower: (teamRow.elo - 1500) / 25,
      state: "FCS_TEAM_ELO",
      source: "team-elo",
    };
  }
  const conf = confMap[teamRow.conference];
  if (conf?.fbsEquivalentPower != null) {
    return {
      provisional: conf.provisional,
      fbsEquivalentPower: conf.fbsEquivalentPower,
      state: conf.provisional ? "PROVISIONAL" : "FCS_CONFERENCE",
      source: "conference",
    };
  }
  return { provisional: true, fbsEquivalentPower: null, state: "PROVISIONAL", reason: "fcs-strength-unavailable" };
}

/**
 * QB features from player PPA + usage. Residual vs team pass PPA when both present.
 */
export function buildQbFeatures({ qbRows = [], usageRows = [], team, kickoffTimestamp = null }) {
  const teamKey = schoolKey(team);
  const candidates = (qbRows || []).filter((r) => schoolKey(r.team) === teamKey);
  // Prefer highest usage / averagePPA
  let best = null;
  let bestScore = -Infinity;
  for (const row of candidates) {
    const ppa = num(row.averagePPA?.all ?? row.averagePPA?.pass ?? row.ppa);
    const usg = num(row.usage) || 0;
    const score = (ppa ?? 0) * 10 + usg;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  const usageHit = (usageRows || []).find(
    (r) => schoolKey(r.team) === teamKey && String(r.position || "").toUpperCase() === "QB"
  );
  if (!best && !usageHit) {
    return {
      qbStarterKnown: false,
      qbPpa: null,
      qbUsage: null,
      qbName: null,
      missingness: { qb: true },
      temporalClass: TEMPORAL_CLASS.C,
    };
  }
  return {
    qbStarterKnown: true,
    qbName: best?.name || best?.player || usageHit?.name || null,
    qbPpa: num(best?.averagePPA?.all ?? best?.averagePPA?.pass ?? best?.ppa),
    qbPassPpa: num(best?.averagePPA?.pass),
    qbRushPpa: num(best?.averagePPA?.rush),
    qbUsage: num(usageHit?.usage?.overall ?? usageHit?.usage ?? best?.usage),
    qbGamesPlayed: num(best?.games) || null,
    missingness: { qb: false },
    temporalClass: TEMPORAL_CLASS.C,
    // Season aggregates: for historical backtest only use prior-season QB or reconstruct from player games
    leakageNote: "season QB PPA is cumulative — prefer prior-season or player-game reconstruction for backtests",
  };
}

/**
 * Assemble one game's pregame feature vector for CFB-FBIS-v2.
 * Market/lines attached only under evaluation namespace.
 */
export function assembleGameFeatures({
  game,
  priorCatalog,
  confMap,
  ppaGameRows = [],
  advGameRows = [],
  qbRows = [],
  usageRows = [],
  weatherRow = null,
  venueRow = null,
  lineRow = null,
  coreByTeam = null,
  shrinkK = 6,
  collectionTimestamp = null,
}) {
  const kickoff = game.startDate || game.start_date || game.start || game.kickoff;
  const homeName = game.homeTeam || game.home_team || game.home?.school || game.home?.name;
  const awayName = game.awayTeam || game.away_team || game.away?.school || game.away?.name;
  const homePrior = priorCatalog.bySchool[schoolKey(homeName)] || {};
  const awayPrior = priorCatalog.bySchool[schoolKey(awayName)] || {};
  const homeRoll = buildRollingMatchupFeatures({ ppaGameRows, advGameRows, team: homeName, kickoffTimestamp: kickoff });
  const awayRoll = buildRollingMatchupFeatures({ ppaGameRows, advGameRows, team: awayName, kickoffTimestamp: kickoff });
  const homeQb = buildQbFeatures({ qbRows, usageRows, team: homeName, kickoffTimestamp: kickoff });
  const awayQb = buildQbFeatures({ qbRows, usageRows, team: awayName, kickoffTimestamp: kickoff });
  const homeFcs = fcsEquivalentForTeam(homePrior, confMap);
  const awayFcs = fcsEquivalentForTeam(awayPrior, confMap);

  // Week-bounded CORE (class B) preferred over undated same-season SP for current strength
  const homeCore = coreByTeam?.[schoolKey(homeName)] || null;
  const awayCore = coreByTeam?.[schoolKey(awayName)] || null;
  const coreToPoints = (coreOff) => (coreOff == null ? null : 26.5 + Number(coreOff) * 0.4);

  const homeCurrentOff =
    homeRoll.offensePpa != null
      ? 26.5 + homeRoll.offensePpa * 40
      : coreToPoints(homeCore?.offense ?? homeCore?.rating);
  const homeCurrentDef =
    homeRoll.defensePpa != null
      ? 26.5 + homeRoll.defensePpa * 40
      : coreToPoints(homeCore?.defense != null ? -homeCore.defense : null);
  const awayCurrentOff =
    awayRoll.offensePpa != null
      ? 26.5 + awayRoll.offensePpa * 40
      : coreToPoints(awayCore?.offense ?? awayCore?.rating);
  const awayCurrentDef =
    awayRoll.defensePpa != null
      ? 26.5 + awayRoll.defensePpa * 40
      : coreToPoints(awayCore?.defense != null ? -awayCore.defense : null);

  const homeOffBlend = blendPriorCurrent(homePrior.priorOff, homeCurrentOff, homeRoll.gamesPlayed || (homeCore ? 3 : 0), shrinkK);
  const homeDefBlend = blendPriorCurrent(homePrior.priorDef, homeCurrentDef, homeRoll.gamesPlayed || (homeCore ? 3 : 0), shrinkK);
  const awayOffBlend = blendPriorCurrent(awayPrior.priorOff, awayCurrentOff, awayRoll.gamesPlayed || (awayCore ? 3 : 0), shrinkK);
  const awayDefBlend = blendPriorCurrent(awayPrior.priorDef, awayCurrentDef, awayRoll.gamesPlayed || (awayCore ? 3 : 0), shrinkK);

  const side = (prior, roll, qb, fcs, offB, defB, core) => ({
    priorOff: prior.priorOff ?? null,
    priorDef: prior.priorDef ?? null,
    spOffense: prior.priorOff ?? null,
    spDefense: prior.priorDef ?? null,
    coreThroughWeek: core?.throughWeek ?? null,
    coreRating: core?.rating ?? null,
    coreOffense: core?.offense ?? null,
    coreDefense: core?.defense ?? null,
    off: offB.value,
    def: defB.value,
    gamesPlayed: roll.gamesPlayed,
    passEpa: roll.passEpa,
    rushEpa: roll.rushEpa,
    passEpaAllowed: roll.passEpaAllowed,
    rushEpaAllowed: roll.rushEpaAllowed,
    successRate: roll.successRate,
    successRateAllowed: roll.successRateAllowed,
    explosiveRate: roll.explosiveRate,
    explosiveRateAllowed: roll.explosiveRateAllowed,
    havocRate: roll.havocRate,
    havocAllowed: roll.havocAllowed,
    lineYards: roll.lineYards,
    lineYardsAllowed: roll.lineYardsAllowed,
    stuffRate: roll.stuffRate,
    pointsPerOpportunity: roll.pointsPerOpportunity,
    pointsPerOpportunityAllowed: roll.pointsPerOpportunityAllowed,
    paceNorm: roll.pacePlays != null ? (roll.pacePlays - 70) / 15 : null,
    classification: prior.classification,
    fbsEquivalentPower: fcs.fbsEquivalentPower,
    fcsState: fcs.state,
    ...qb,
    temperature: weatherRow ? num(weatherRow.temperature) : null,
    windSpeed: weatherRow ? num(weatherRow.windSpeed ?? weatherRow.wind_speed) : null,
    humidity: weatherRow ? num(weatherRow.humidity) : null,
    gameIndoors: weatherRow?.gameIndoors ?? venueRow?.dome ?? null,
    elevation: venueRow ? num(venueRow.elevation) : null,
    timezone: venueRow?.timezone || null,
    missingness: {
      ...(prior.missingness || {}),
      ...(qb.missingness || {}),
      rolling: roll.gamesPlayed === 0,
      core: !core,
      weather: !weatherRow,
    },
  });

  const features = {
    home: side(homePrior, homeRoll, homeQb, homeFcs, homeOffBlend, homeDefBlend, homeCore),
    away: side(awayPrior, awayRoll, awayQb, awayFcs, awayOffBlend, awayDefBlend, awayCore),
    neutralSite: Boolean(game.neutralSite ?? game.neutral_site ?? game.neutral),
    dataCompleteness: null,
    evaluation: {
      // Market — never for independent score
      closingSpread: lineRow ? num(lineRow.spread ?? lineRow.lines?.[0]?.spread) : null,
      closingTotal: lineRow ? num(lineRow.overUnder ?? lineRow.lines?.[0]?.overUnder) : null,
      lineProvider: lineRow?.lines?.[0]?.provider || null,
    },
    provenance: {
      pipelineVersion: PIPELINE_VERSION,
      priorSeason: priorCatalog.season,
      sourceVersion: SOURCE_VERSION,
      marketInIndependentScore: false,
      coreWeekBounded: Boolean(homeCore || awayCore),
      shrinkK,
    },
  };

  const present = [
    features.home.priorOff,
    features.home.passEpa,
    features.home.successRate,
    features.home.qbPpa,
    features.away.priorOff,
    features.away.passEpa,
  ];
  features.dataCompleteness = present.filter((v) => v != null).length / present.length;

  const record = buildPregameFeatureRecord({
    gameId: game.id || game.gameId,
    season: game.season || game.year,
    week: game.week,
    kickoffTimestamp: kickoff,
    homeTeam: homeName,
    awayTeam: awayName,
    features,
    sourceEndpoint: "/ppa/games+/stats/game/advanced+prior-season-ratings",
    sourceVersion: SOURCE_VERSION,
    collectionTimestamp: collectionTimestamp || new Date().toISOString(),
    featureAsOfTimestamp: collectionTimestamp || new Date().toISOString(),
  });

  return record;
}

export function entitledPathSet(auditByEndpoint = {}) {
  const set = new Set();
  for (const [path, row] of Object.entries(auditByEndpoint)) {
    if (["AVAILABLE", "AVAILABLE-BUT-EMPTY"].includes(row.classification)) set.add(path);
  }
  return set;
}

export { pickNested, schoolKey, indexByTeam, num };
