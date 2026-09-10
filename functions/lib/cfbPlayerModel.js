/**
 * CFB-PLAYER-v1 — shadow player projection model for QB1 / RB1 / WR1 only.
 * Consumes independent CFB game environment (CFB-FBIS-v2). Never uses market lines.
 */

import { COLLEGE_MODELS, failClosedShadow } from "./collegeModels.js";
import { pGreater } from "./metrics.js";
import CFB_PLAYER_V1_ARTIFACT from "../../data/models/cfb-player-v1.js";
import { identifyGamePlayerRoles } from "./cfbPlayerIdentity.js";
import { reconcileGamePlayerCoherence } from "./cfbPlayerCoherence.js";

export const CFB_PLAYER_V1_ID = "CFB-PLAYER-v1";

export const PLAYER_ABLATION_MASKS = {
  qb: {
    A: { historical: true },
    B: { historical: true, pace: true },
    C: { historical: true, pace: true, script: true },
    D: { historical: true, pace: true, script: true, opponent: true },
    E: { historical: true, pace: true, script: true, opponent: true, playerPpa: true },
    F: { historical: true, pace: true, script: true, opponent: true, playerPpa: true, weather: true },
    G: { historical: true, pace: true, script: true, opponent: true, playerPpa: true, weather: true },
  },
  rb: {
    A: { historical: true },
    B: { historical: true, opportunity: true },
    C: { historical: true, opportunity: true, script: true },
    D: { historical: true, opportunity: true, script: true, opponent: true },
    E: { historical: true, opportunity: true, script: true, opponent: true, trenches: true },
    F: { historical: true, opportunity: true, script: true, opponent: true, trenches: true },
  },
  wr: {
    A: { historical: true },
    B: { historical: true, dropbacks: true },
    C: { historical: true, dropbacks: true, script: true },
    D: { historical: true, dropbacks: true, script: true, opponent: true },
    E: { historical: true, dropbacks: true, script: true, opponent: true, efficiency: true },
    F: { historical: true, dropbacks: true, script: true, opponent: true, efficiency: true },
  },
};

const COEF = CFB_PLAYER_V1_ARTIFACT.coefficients;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

function normalQuantiles(mean, sigma) {
  // Approximate normal quantiles via known z scores
  const z = { p10: -1.2816, p25: -0.6745, p50: 0, p75: 0.6745, p90: 1.2816 };
  const q = {};
  for (const [k, zz] of Object.entries(z)) {
    q[k] = round1(mean + sigma * zz);
  }
  return q;
}

function uncertaintyState(sigma, base, roleConfidence, sampleSize) {
  const ratio = sigma / Math.max(base, 1e-6);
  if (ratio >= 1.35 || roleConfidence < 0.4 || sampleSize < 2) return "HIGH";
  if (ratio >= 1.15 || roleConfidence < 0.6 || sampleSize < 4) return "MEDIUM";
  return "LOW";
}

/**
 * Derive team opportunity environment from CFB-FBIS-v2 (or compatible) game projection.
 */
export function deriveTeamEnvironment(game = {}, side = "home") {
  const v2 = game.cfbFbisV2 || game.challengers?.["CFB-FBIS-v2"] || {};
  const feat = game.cfbFbisV2Input?.[side] || game.cfbDeepInput?.[side] || game.cfbDetail?.[side] || {};
  const teamScore = side === "home" ? num(v2.home) : num(v2.away);
  const oppScore = side === "home" ? num(v2.away) : num(v2.home);
  const margin = (teamScore ?? 0) - (oppScore ?? 0);
  const expectedPossessions = num(v2.decomposition?.expectedPossessions) || COEF.expectedPossessions;
  const paceNorm = num(feat.paceNorm) || 0;
  const plays = COEF.basePlays * (1 + paceNorm * COEF.pacePlayScale);

  // Pass rate: baseline + pass matchup edge - trailing script (leading teams rush more)
  const passEpa = num(feat.passEpa);
  const rushEpa = num(feat.rushEpa);
  let passRate = COEF.basePassRate;
  if (passEpa != null && rushEpa != null) {
    passRate = clamp(COEF.basePassRate + (passEpa - rushEpa) * COEF.passRateFromEpa, 0.35, 0.72);
  }
  const scriptAdj = clamp(-margin * COEF.scriptPassPerPoint, -0.08, 0.08);
  passRate = clamp(passRate + scriptAdj, 0.35, 0.72);
  const rushRate = 1 - passRate;

  return {
    side,
    teamScore,
    oppScore,
    expectedMargin: round1(margin),
    expectedPossessions: round2(expectedPossessions),
    expectedPlays: round1(plays),
    expectedPassRate: round2(passRate),
    expectedRushRate: round2(rushRate),
    expectedDropbacks: round1(plays * passRate),
    expectedRushAttempts: round1(plays * rushRate),
    passEpa,
    rushEpa,
    successRate: num(feat.successRate),
    lineYards: num(feat.lineYards),
    stuffRate: num(feat.stuffRate),
    explosiveRate: num(feat.explosiveRate),
    havocAllowed: num(feat.havocAllowed ?? feat.havocRate),
    opponentPassDef: num(
      side === "home"
        ? game.cfbFbisV2Input?.away?.passEpaAllowed ?? game.cfbDeepInput?.away?.passEpaAllowed
        : game.cfbFbisV2Input?.home?.passEpaAllowed ?? game.cfbDeepInput?.home?.passEpaAllowed
    ),
    opponentRushDef: num(
      side === "home"
        ? game.cfbFbisV2Input?.away?.rushEpaAllowed ?? game.cfbDeepInput?.away?.rushEpaAllowed
        : game.cfbFbisV2Input?.home?.rushEpaAllowed ?? game.cfbDeepInput?.home?.rushEpaAllowed
    ),
    temperature: num(feat.temperature),
    windSpeed: num(feat.windSpeed),
    gameIndoors: feat.gameIndoors ?? null,
    gamesPlayed: num(feat.gamesPlayed) || 0,
    gameModelId: v2.modelId || CFB_PLAYER_V1_ARTIFACT.gameModelId,
    gameOk: Boolean(v2.ok),
  };
}

function propContract({
  player,
  role,
  team,
  side,
  market,
  projection,
  sigma,
  dataQuality,
  sampleSize,
  roleConfidence,
  ablation,
  extras = {},
}) {
  const mean = round1(projection);
  const sig = round2(Math.max(0.5, sigma));
  const unc = uncertaintyState(sig, COEF.sigmaBase[market] || 10, roleConfidence, sampleSize);
  return {
    player: player?.player_name || null,
    player_id: player?.player_id || null,
    role,
    team,
    side,
    market,
    projection: mean,
    median: mean,
    sigma: sig,
    quantiles: normalQuantiles(mean, sig),
    threshold: null,
    probabilityOver: null,
    probabilityUnder: null,
    data_quality: round2(dataQuality),
    sample_size: sampleSize,
    uncertainty_state: unc,
    role_confidence: round2(roleConfidence),
    modelVersion: CFB_PLAYER_V1_ID,
    ablation,
    ...extras,
  };
}

/**
 * QB projections: attempts, completions, passing yards, carries, rushing yards.
 */
export function projectQb(env, player, { ablation = "G" } = {}) {
  const mask = PLAYER_ABLATION_MASKS.qb[ablation] || PLAYER_ABLATION_MASKS.qb.G;
  const histAttempts = num(player.hist?.passAttempts) ?? COEF.qb.defaultAttempts;
  const histCompPct = num(player.hist?.compPct) ?? COEF.qb.defaultCompPct;
  const histYpa = num(player.hist?.ypa) ?? COEF.qb.defaultYpa;
  const histRushAtt = num(player.hist?.rushAttempts) ?? COEF.qb.defaultRushAtt;
  const histYpc = num(player.hist?.rushYpc) ?? COEF.qb.defaultRushYpc;

  let attempts = histAttempts;
  if (mask.pace || mask.historical) {
    const dropbacks = env.expectedDropbacks;
    const qbShare = num(player.dropbackShare) ?? COEF.qb.defaultDropbackShare;
    if (mask.pace) attempts = dropbacks * qbShare;
    else attempts = 0.5 * histAttempts + 0.5 * dropbacks * qbShare;
  }
  if (mask.script) {
    attempts *= 1 + clamp(env.expectedMargin * COEF.qb.scriptAttemptPerPoint, -0.08, 0.08);
  }
  if (mask.opponent && env.opponentPassDef != null) {
    attempts *= 1 + clamp(-env.opponentPassDef * COEF.qb.oppAttemptScale, -0.06, 0.06);
  }
  if (mask.weather && !env.gameIndoors && env.windSpeed != null && env.windSpeed >= COEF.weather.windThreshold) {
    attempts *= COEF.weather.passAttemptMult;
  }

  let compPct = histCompPct;
  if (mask.opponent && env.opponentPassDef != null) {
    compPct = clamp(compPct - env.opponentPassDef * COEF.qb.oppCompScale, 0.45, 0.78);
  }
  if (mask.playerPpa && player.passPpa != null) {
    compPct = clamp(compPct + player.passPpa * COEF.qb.ppaCompScale, 0.45, 0.78);
  }
  if (mask.weather && !env.gameIndoors && env.windSpeed != null && env.windSpeed >= COEF.weather.windThreshold) {
    compPct *= COEF.weather.compPctMult;
  }

  let ypa = histYpa;
  if (mask.opponent && env.opponentPassDef != null) {
    ypa = clamp(ypa - env.opponentPassDef * COEF.qb.oppYpaScale, 5.5, 11.5);
  }
  if (mask.playerPpa && player.passPpa != null) {
    ypa = clamp(ypa + player.passPpa * COEF.qb.ppaYpaScale, 5.5, 11.5);
  }
  if (mask.weather && !env.gameIndoors && env.windSpeed != null && env.windSpeed >= COEF.weather.windThreshold) {
    ypa *= COEF.weather.ypaMult;
  }

  const completions = attempts * compPct;
  const passYards = attempts * ypa;

  let rushAtt = histRushAtt;
  if (mask.pace) {
    rushAtt = env.expectedRushAttempts * (num(player.qbRushShare) ?? COEF.qb.defaultRushShare);
  }
  if (mask.script) {
    rushAtt *= 1 + clamp(-env.expectedMargin * COEF.qb.scriptRushPerPoint, -0.1, 0.1);
  }
  let rushYpc = histYpc;
  if (mask.opponent && env.opponentRushDef != null) {
    rushYpc = clamp(rushYpc - env.opponentRushDef * COEF.qb.oppRushYpcScale, 2.5, 7.5);
  }
  const rushYards = rushAtt * rushYpc;

  const roleConf = num(player.role_confidence) ?? 0.5;
  const sample = num(player.sample_size) ?? 0;
  const dq = clamp((roleConf * 0.6 + Math.min(1, sample / 6) * 0.4) * (env.gameOk ? 1 : 0.7), 0.05, 1);
  const sigmaBoost = player.state === "QB_UNCERTAIN" || player.provenance?.widenUncertainty ? 1.25 : 1;

  return {
    attempts: propContract({
      player,
      role: "QB1",
      team: player.team,
      side: env.side,
      market: "pass_attempts",
      projection: attempts,
      sigma: COEF.sigmaBase.pass_attempts * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
    }),
    completions: propContract({
      player,
      role: "QB1",
      team: player.team,
      side: env.side,
      market: "completions",
      projection: completions,
      sigma: COEF.sigmaBase.completions * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: { impliedCompPct: round2(compPct) },
    }),
    passing_yards: propContract({
      player,
      role: "QB1",
      team: player.team,
      side: env.side,
      market: "passing_yards",
      projection: passYards,
      sigma: COEF.sigmaBase.passing_yards * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: { impliedYpa: round2(ypa) },
    }),
    carries: propContract({
      player,
      role: "QB1",
      team: player.team,
      side: env.side,
      market: "qb_carries",
      projection: rushAtt,
      sigma: COEF.sigmaBase.qb_carries * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
    }),
    rushing_yards: propContract({
      player,
      role: "QB1",
      team: player.team,
      side: env.side,
      market: "qb_rushing_yards",
      projection: rushYards,
      sigma: COEF.sigmaBase.qb_rushing_yards * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: { impliedYpc: round2(rushYpc) },
    }),
  };
}

export function projectRb(env, player, { ablation = "F" } = {}) {
  const mask = PLAYER_ABLATION_MASKS.rb[ablation] || PLAYER_ABLATION_MASKS.rb.F;
  const histCarries = num(player.hist?.carries) ?? COEF.rb.defaultCarries;
  const histYpc = num(player.hist?.ypc) ?? COEF.rb.defaultYpc;
  let carries = histCarries;
  if (mask.opportunity) {
    const share = num(player.carryShare) ?? COEF.rb.defaultCarryShare;
    carries = env.expectedRushAttempts * share;
  } else if (mask.historical) {
    carries = histCarries;
  }
  if (mask.script) {
    // Leading → more rushes
    carries *= 1 + clamp(env.expectedMargin * COEF.rb.scriptCarryPerPoint, -0.12, 0.12);
  }
  if (mask.opponent && env.opponentRushDef != null) {
    carries *= 1 + clamp(-env.opponentRushDef * COEF.rb.oppCarryScale, -0.08, 0.08);
  }

  let ypc = histYpc;
  if (mask.opponent && env.opponentRushDef != null) {
    ypc = clamp(ypc - env.opponentRushDef * COEF.rb.oppYpcScale, 2.8, 6.8);
  }
  if (mask.trenches && env.lineYards != null) {
    ypc = clamp(ypc + (env.lineYards - 2.5) * COEF.rb.trenchYpcScale, 2.8, 6.8);
  }
  if (mask.trenches && env.stuffRate != null) {
    ypc = clamp(ypc - (env.stuffRate - 0.2) * COEF.rb.stuffYpcScale, 2.8, 6.8);
  }
  const yards = carries * ypc;
  const roleConf = num(player.role_confidence) ?? 0.5;
  const sample = num(player.sample_size) ?? 0;
  const dq = clamp((roleConf * 0.6 + Math.min(1, sample / 6) * 0.4) * (env.gameOk ? 1 : 0.7), 0.05, 1);
  const sigmaBoost = player.state === "RB_UNCERTAIN" || player.provenance?.widenUncertainty ? 1.22 : 1;

  return {
    carries: propContract({
      player,
      role: "RB1",
      team: player.team,
      side: env.side,
      market: "rb_carries",
      projection: carries,
      sigma: COEF.sigmaBase.rb_carries * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: { expectedCarryShare: round2(num(player.carryShare) ?? COEF.rb.defaultCarryShare) },
    }),
    rushing_yards: propContract({
      player,
      role: "RB1",
      team: player.team,
      side: env.side,
      market: "rb_rushing_yards",
      projection: yards,
      sigma: COEF.sigmaBase.rb_rushing_yards * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: { expectedYpc: round2(ypc) },
    }),
  };
}

export function projectWr(env, player, { ablation = "F" } = {}) {
  const mask = PLAYER_ABLATION_MASKS.wr[ablation] || PLAYER_ABLATION_MASKS.wr.F;
  const histTargets = num(player.hist?.targets) ?? COEF.wr.defaultTargets;
  const histCatch = num(player.hist?.catchRate) ?? COEF.wr.defaultCatchRate;
  const histYpt = num(player.hist?.ypt) ?? COEF.wr.defaultYpt;

  let targets = histTargets;
  if (mask.dropbacks) {
    const share = num(player.targetShare) ?? COEF.wr.defaultTargetShare;
    targets = env.expectedDropbacks * share;
  }
  if (mask.script) {
    targets *= 1 + clamp(-env.expectedMargin * COEF.wr.scriptTargetPerPoint, -0.1, 0.1);
  }
  if (mask.opponent && env.opponentPassDef != null) {
    targets *= 1 + clamp(-env.opponentPassDef * COEF.wr.oppTargetScale, -0.08, 0.08);
  }

  let catchRate = histCatch;
  if (mask.opponent && env.opponentPassDef != null) {
    catchRate = clamp(catchRate - env.opponentPassDef * COEF.wr.oppCatchScale, 0.45, 0.78);
  }
  if (mask.efficiency && player.recPpa != null) {
    catchRate = clamp(catchRate + player.recPpa * COEF.wr.ppaCatchScale, 0.45, 0.78);
  }

  let ypt = histYpt;
  if (mask.opponent && env.opponentPassDef != null) {
    ypt = clamp(ypt - env.opponentPassDef * COEF.wr.oppYptScale, 5.5, 12);
  }
  if (mask.efficiency && player.recPpa != null) {
    ypt = clamp(ypt + player.recPpa * COEF.wr.ppaYptScale, 5.5, 12);
  }
  if (mask.efficiency && env.explosiveRate != null) {
    ypt = clamp(ypt + (env.explosiveRate - 1.1) * COEF.wr.explosiveYptScale, 5.5, 12);
  }

  const receptions = targets * catchRate;
  const yards = targets * ypt;
  const roleConf = num(player.role_confidence) ?? 0.5;
  const sample = num(player.sample_size) ?? 0;
  const dq = clamp((roleConf * 0.6 + Math.min(1, sample / 6) * 0.4) * (env.gameOk ? 1 : 0.7), 0.05, 1);
  const sigmaBoost = player.state === "WR_UNCERTAIN" || player.provenance?.widenUncertainty ? 1.22 : 1;

  return {
    receptions: propContract({
      player,
      role: "WR1",
      team: player.team,
      side: env.side,
      market: "receptions",
      projection: receptions,
      sigma: COEF.sigmaBase.receptions * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: {
        expectedTargets: round1(targets),
        targetShare: round2(num(player.targetShare) ?? COEF.wr.defaultTargetShare),
        targetProxy: player.targetProxy || "targets-or-receptions-proxy",
      },
    }),
    receiving_yards: propContract({
      player,
      role: "WR1",
      team: player.team,
      side: env.side,
      market: "receiving_yards",
      projection: yards,
      sigma: COEF.sigmaBase.receiving_yards * sigmaBoost,
      dataQuality: dq,
      sampleSize: sample,
      roleConfidence: roleConf,
      ablation,
      extras: { expectedYpt: round2(ypt), expectedTargets: round1(targets) },
    }),
  };
}

function enrichPlayer(roleRow, hist = {}) {
  return {
    ...roleRow,
    sample_size: roleRow.selection?.sample_size || hist.sample_size || 0,
    hist,
    dropbackShare: hist.dropbackShare,
    carryShare: hist.carryShare,
    targetShare: hist.targetShare,
    qbRushShare: hist.qbRushShare,
    passPpa: hist.passPpa,
    recPpa: hist.recPpa,
    targetProxy: hist.targetProxy,
  };
}

/**
 * Project all six players for a game from independent game model environment.
 */
export function projectCfbPlayerV1(game = {}, opts = {}) {
  const rolesBundle = opts.roles || identifyGamePlayerRoles(game, opts.feeds || {});
  const hist = opts.playerHistory || {};
  const sideOut = {};

  for (const side of ["away", "home"]) {
    const env = deriveTeamEnvironment(game, side);
    const roles = rolesBundle.roles?.[side] || {};
    const qb = enrichPlayer(roles.QB1 || { role: "QB1", team: env.side, state: "QB_UNCERTAIN", role_confidence: 0 }, hist[side]?.QB1);
    const rb = enrichPlayer(roles.RB1 || { role: "RB1", team: env.side, state: "RB_UNCERTAIN", role_confidence: 0 }, hist[side]?.RB1);
    const wr = enrichPlayer(roles.WR1 || { role: "WR1", team: env.side, state: "WR_UNCERTAIN", role_confidence: 0 }, hist[side]?.WR1);

    const qbProj = projectQb(env, qb, { ablation: opts.qbAblation || "G" });
    const rbProj = projectRb(env, rb, { ablation: opts.rbAblation || "F" });
    const wrProj = projectWr(env, wr, { ablation: opts.wrAblation || "F" });

    sideOut[side] = {
      environment: env,
      identity: { QB1: roles.QB1, RB1: roles.RB1, WR1: roles.WR1 },
      QB1: qbProj,
      RB1: rbProj,
      WR1: wrProj,
    };
  }

  const coherence = reconcileGamePlayerCoherence(game, sideOut);
  const anyUncertain = ["away", "home"].some((s) =>
    ["QB_UNCERTAIN", "RB_UNCERTAIN", "WR_UNCERTAIN"].includes(sideOut[s]?.identity?.QB1?.state) ||
    ["RB_UNCERTAIN"].includes(sideOut[s]?.identity?.RB1?.state) ||
    ["WR_UNCERTAIN"].includes(sideOut[s]?.identity?.WR1?.state)
  );

  const projection = {
    modelId: CFB_PLAYER_V1_ID,
    ...COLLEGE_MODELS[CFB_PLAYER_V1_ID],
    ok: true,
    independent: true,
    marketInformed: false,
    canQualify: false,
    canAuthorizeWager: false,
    players: sideOut,
    coherence,
    roles: rolesBundle,
    provenance: {
      marketUsed: false,
      gameModelId: game.cfbFbisV2?.modelId || "CFB-FBIS-v2",
      artifactId: CFB_PLAYER_V1_ARTIFACT.id,
      sourceVersion: CFB_PLAYER_V1_ARTIFACT.sourceVersion,
      championOverwritten: false,
      maxPlayers: 6,
    },
  };

  return {
    ...projection,
    ...failClosedShadow({
      identityOk: Boolean(game?.home && game?.away),
      projectionState: anyUncertain ? "PROVISIONAL" : "COMPLETE",
      featuresOk: Boolean(game?.cfbFbisV2?.ok || game?.challengers?.["CFB-FBIS-v2"]?.ok),
      artifactKnown: Boolean(CFB_PLAYER_V1_ARTIFACT?.coefficients),
      cutoffOk: game?.featureCutoffOk !== false,
      marketPaired: false,
      pricePresent: false,
      dataQuality: coherence?.dataQuality ?? 0.5,
      pinnacleOnly: false,
      modelId: CFB_PLAYER_V1_ID,
    }),
  };
}

export function attachCfbPlayerV1(games = [], opts = {}) {
  let available = 0;
  const next = (games || []).map((game) => {
    if (game.sport && game.sport !== "cfb") return game;
    const projection = projectCfbPlayerV1(game, opts);
    if (projection.ok) available += 1;
    return {
      ...game,
      challengers: { ...(game.challengers || {}), [CFB_PLAYER_V1_ID]: projection },
      cfbPlayerV1: projection,
    };
  });
  return {
    games: next,
    meta: {
      modelId: CFB_PLAYER_V1_ID,
      role: "shadow",
      games: next.length,
      available,
      qualificationAllowed: false,
      canQualify: false,
      canAuthorizeWager: false,
      maxPlayersPerGame: 6,
    },
  };
}

/**
 * Apply a market threshold WITHOUT mutating the underlying projection.
 */
export function probabilityAtThreshold(prop, threshold) {
  if (!prop || threshold == null || !Number.isFinite(Number(threshold))) {
    return { ...prop, threshold: null, probabilityOver: null, probabilityUnder: null };
  }
  const mean = Number(prop.projection);
  const sigma = Number(prop.sigma);
  if (!Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) {
    return { ...prop, threshold: Number(threshold), probabilityOver: null, probabilityUnder: null };
  }
  const pOver = pGreater(mean, Number(threshold), sigma);
  return {
    ...prop,
    threshold: Number(threshold),
    probabilityOver: round2(pOver),
    probabilityUnder: round2(1 - pOver),
    // Explicit: original projection unchanged
    projection: prop.projection,
  };
}

export function playerAblationSuite(game, opts = {}) {
  const qb = Object.keys(PLAYER_ABLATION_MASKS.qb).map((k) => ({
    ablation: k,
    projection: projectCfbPlayerV1(game, { ...opts, qbAblation: k, rbAblation: "A", wrAblation: "A" }),
  }));
  const rb = Object.keys(PLAYER_ABLATION_MASKS.rb).map((k) => ({
    ablation: k,
    projection: projectCfbPlayerV1(game, { ...opts, qbAblation: "A", rbAblation: k, wrAblation: "A" }),
  }));
  const wr = Object.keys(PLAYER_ABLATION_MASKS.wr).map((k) => ({
    ablation: k,
    projection: projectCfbPlayerV1(game, { ...opts, qbAblation: "A", rbAblation: "A", wrAblation: k }),
  }));
  return { qb, rb, wr };
}
