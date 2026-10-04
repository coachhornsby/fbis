/**
 * CBB-PLAYER-PROP-v1.
 *
 * Focused independent markets:
 * - points
 * - rebounds
 * - assists
 * - three_pointers_made
 * - points_rebounds_assists
 *
 * PrizePicks/sportsbook lines are never model inputs.
 */
import { playersForCbbGame } from "./cbbPlayerFeed.js";
import { projectCbbPlayerPropV2, CBB_PLAYER_PROP_V2_ID, CBB_PLAYER_PROP_V2_VERSION, CBB_PLAYER_PROP_V2_MARKETS } from "./cbbPlayerPropV2.js";

export const CBB_PLAYER_PROP_MODEL_ID = "CBB-PLAYER-PROP-v1";
export const CBB_PLAYER_PROP_MARKETS = Object.freeze([
  "points",
  "rebounds",
  "assists",
  "three_pointers_made",
  "points_rebounds_assists",
]);

function finite(v) {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function r1(v) { return Math.round(Number(v) * 10) / 10; }
function weighted(values = []) {
  let num = 0, den = 0;
  for (const [value, weight] of values) {
    const x = finite(value), w = finite(weight);
    if (x == null || w == null || w <= 0) continue;
    num += x * w;
    den += w;
  }
  return den ? num / den : null;
}
function sideTeam(game, side) {
  return game?.[side]?.school || game?.[side]?.name || game?.[side]?.fullName || game?.[side]?.abbr || null;
}
function projectedTeamPoints(game, side) {
  return finite(
    side === "home"
      ? game?.model?.projHome ?? game?.projHomeScore ?? game?.cbbPro?.home
      : game?.model?.projAway ?? game?.projAwayScore ?? game?.cbbPro?.away
  );
}
function projectedPossessions(game) {
  const direct = finite(game?.projectedPossessions ?? game?.possessions);
  if (direct != null) return clamp(direct, 58, 82);
  const homeTempo = finite(game?.cbbFbisRatings?.home?.tempo ?? game?.cbbMatchupEvidence?.home?.tempo);
  const awayTempo = finite(game?.cbbFbisRatings?.away?.tempo ?? game?.cbbMatchupEvidence?.away?.tempo);
  const avg = weighted([[homeTempo, 1], [awayTempo, 1]]);
  return clamp(avg ?? 69, 58, 82);
}
function opponentEvidence(game, side) {
  return game?.cbbMatchupEvidence?.[side === "home" ? "away" : "home"] || {};
}
function opponentFactors(game, side) {
  const opp = opponentEvidence(game, side);
  const def = finite(opp.adjDe);
  const drb = finite(opp.drbRate);
  const threeD = finite(opp.threePtPctD);
  const tovD = finite(opp.tovRateD);

  // Centered at typical D-I environments. Bounded so team projection remains
  // the primary scoring context and these only shape stat allocation.
  const points = def == null ? 1 : clamp(def / 104, 0.88, 1.12);
  const rebounds = drb == null ? 1 : clamp(1 + (0.72 - drb) * 0.55, 0.90, 1.10);
  const assists = tovD == null ? 1 : clamp(1 - (tovD - 0.18) * 0.45, 0.92, 1.08);
  const threes = threeD == null ? 1 : clamp(threeD / 0.335, 0.88, 1.12);
  return { points, rebounds, assists, threes };
}
function row(player, market, projection, sigma, dataQuality, extra = {}) {
  return {
    playerId: player.id ?? null,
    playerName: player.name ?? null,
    team: player.team ?? null,
    position: player.position ?? null,
    market,
    fbisProjection: r1(projection),
    fbisSigma: r1(Math.max(0.35, sigma)),
    dataQuality: Math.round(clamp(dataQuality, 0, 1) * 100) / 100,
    roleConfidence: finite(player.roleConfidence),
    sampleSize: finite(player.sampleSize),
    projectedMinutes: r1(player.projectedMinutes || 0),
    source: CBB_PLAYER_PROP_MODEL_ID,
    maturity: "RESEARCH",
    independent: true,
    marketInformed: false,
    canQualify: false,
    ...extra,
  };
}
function blendPerGame(player, key, per40, minutes) {
  const seasonPg = finite(player[key + "PerGame"]);
  const recent = finite(player?.recent?.[key]);
  const trend = finite(player?.trend?.[key]);
  const rateProjection = finite(per40) == null ? null : finite(per40) * minutes / 40;
  return weighted([
    [rateProjection, 0.48],
    [seasonPg, 0.22],
    [recent, 0.20],
    [trend, 0.10],
  ]);
}
function quality(player) {
  const games = finite(player.sampleSize) || 0;
  const mins = finite(player.projectedMinutes) || 0;
  const role = finite(player.roleConfidence) ?? 0.5;
  const recent = finite(player.recentGames) || 0;
  return clamp(
    0.38 * role +
    0.27 * Math.min(games / 10, 1) +
    0.20 * Math.min(mins / 32, 1) +
    0.15 * Math.min(recent / 5, 1),
    0, 1
  );
}
function sigma(player, key, mean, floor, pct) {
  const empirical = finite(player?.volatility?.[key]);
  if (empirical != null && empirical > 0) {
    return Math.max(floor, 0.65 * empirical + 0.35 * Math.abs(mean) * pct);
  }
  return Math.max(floor, Math.abs(mean) * pct);
}

export function projectCbbPlayerProps(game = {}, players = [], { side = null } = {}) {
  const poss = projectedPossessions(game);
  const teamPts = side ? projectedTeamPoints(game, side) : null;
  const teamName = side ? sideTeam(game, side) : null;
  const factors = side ? opponentFactors(game, side) : { points:1, rebounds:1, assists:1, threes:1 };
  const rows = [];

  for (const p0 of players || []) {
    const p = { ...p0, team: p0.team || teamName };
    const minutes = finite(p.projectedMinutes ?? p.minutesPerGame);
    if (minutes == null || minutes < 12) continue;

    const baselinePace = finite(p?.recent?.pace) ?? 69;
    const paceFactor = clamp(poss / Math.max(baselinePace, 1), 0.88, 1.12);
    const teamScoringFactor = teamPts == null ? 1 : clamp(teamPts / 72, 0.86, 1.16);
    const q = quality(p);

    let pts = blendPerGame(p, "points", p.pointsPer40, minutes);
    let reb = blendPerGame(p, "rebounds", p.reboundsPer40, minutes);
    let ast = blendPerGame(p, "assists", p.assistsPer40, minutes);
    let thr = blendPerGame(p, "threesMade", p.threesMadePer40, minutes);

    if (pts != null) pts *= paceFactor * factors.points * teamScoringFactor;
    if (reb != null) reb *= paceFactor * factors.rebounds;
    if (ast != null) ast *= paceFactor * factors.assists * Math.sqrt(teamScoringFactor);
    if (thr != null) thr *= paceFactor * factors.threes * Math.sqrt(teamScoringFactor);

    if (pts != null) rows.push(row(p, "points", pts, sigma(p, "points", pts, 2.6, 0.30), q));
    if (reb != null) rows.push(row(p, "rebounds", reb, sigma(p, "rebounds", reb, 1.7, 0.34), q));
    if (ast != null) rows.push(row(p, "assists", ast, sigma(p, "assists", ast, 1.25, 0.38), q));
    if (thr != null) rows.push(row(p, "three_pointers_made", thr, sigma(p, "threesMade", thr, 0.85, 0.45), q));

    if (pts != null && reb != null && ast != null) {
      const pra = pts + reb + ast;
      const sPts = sigma(p, "points", pts, 2.6, 0.30);
      const sReb = sigma(p, "rebounds", reb, 1.7, 0.34);
      const sAst = sigma(p, "assists", ast, 1.25, 0.38);
      // Positive same-player stat covariance makes simple RSS too optimistic.
      const praSigma = Math.sqrt(sPts ** 2 + sReb ** 2 + sAst ** 2 + 0.30 * (sPts*sReb + sPts*sAst + sReb*sAst));
      rows.push(row(p, "points_rebounds_assists", pra, praSigma, q));
    }
  }

  return {
    ok: rows.length > 0,
    modelId: CBB_PLAYER_PROP_MODEL_ID,
    state: rows.length ? "RESEARCH_READY" : "NO_MODELABLE_PLAYERS",
    independent: true,
    marketInformed: false,
    projectedPossessions: r1(poss),
    rows,
  };
}

export function attachCbbPlayerProps(games = [], context = {}) {
  let projectedGames = 0;
  let projectedRows = 0;
  const out = (games || []).map((game) => {
    if (game?.sport && game.sport !== "cbb") return game;
    const bySide = playersForCbbGame(game, context);
    const home = projectCbbPlayerProps(game, bySide.home, { side: "home" });
    const away = projectCbbPlayerProps(game, bySide.away, { side: "away" });
    const playerIndex=new Map();
    for(const [side,list] of [["home",bySide.home],["away",bySide.away]]){
      for(const p of list||[]){
        const key=String(p.id??p.name??"").toLowerCase();
        if(key)playerIndex.set(key,{player:p,side});
        const nameKey=String(p.name||"").toLowerCase();
        if(nameKey)playerIndex.set(nameKey,{player:p,side});
      }
    }
    const promoted=new Set(CBB_PLAYER_PROP_V2_MARKETS);
    const rows = [...home.rows, ...away.rows]
      // Focus model on players with meaningful roles. Do not manufacture full-roster coverage.
      .filter((r) => (r.projectedMinutes || 0) >= 16 && (r.dataQuality || 0) >= 0.45)
      .map((r)=>{
        if(!promoted.has(r.market))return{...r,modelVersion:"v1.0.0",validationStatus:"V1_FALLBACK_3PM"};
        const hit=playerIndex.get(String(r.playerId??"").toLowerCase())||playerIndex.get(String(r.playerName||"").toLowerCase());
        if(!hit)return r;
        const teamScore=hit.side==="home"
          ? finite(game?.cbbFbisNative?.home ?? game?.challengers?.["FBIS-CBB-RATINGS-v2"]?.home ?? game?.challengers?.["FBIS-CBB-RATINGS-v1"]?.home)
          : finite(game?.cbbFbisNative?.away ?? game?.challengers?.["FBIS-CBB-RATINGS-v2"]?.away ?? game?.challengers?.["FBIS-CBB-RATINGS-v1"]?.away);
        const possessions=finite(game?.cbbFbisNative?.possessions ?? game?.challengers?.["FBIS-CBB-RATINGS-v2"]?.possessions ?? game?.challengers?.["FBIS-CBB-RATINGS-v1"]?.possessions);
        const v2=projectCbbPlayerPropV2(hit.player,r.market,{possessions,teamScore,home:hit.side==="home"});
        if(!v2.ok)return r;
        return{
          ...r,
          fbisProjection:v2.projection,
          fbisSigma:v2.sigma,
          source:CBB_PLAYER_PROP_V2_ID,
          modelVersion:CBB_PLAYER_PROP_V2_VERSION,
          maturity:"VALIDATED_PROJECTION_RESEARCH_MARKET",
          projectionValidation:{...v2.evidence,baseProjection:v2.baseProjection,residual:v2.residual},
          canQualify:false,
          canAuthorizeWager:false,
        };
      });
    if (rows.length) projectedGames += 1;
    projectedRows += rows.length;
    return {
      ...game,
      cbbPlayerProps: {
        modelId: CBB_PLAYER_PROP_V2_ID,
        ok: rows.length > 0,
        independent: true,
        marketInformed: false,
        rows,
      },
      playerProjectionRows: rows,
      playerProjectionStatus: {
        sport: "cbb",
        state: rows.length ? "ACTIVE_RESEARCH" : "NO_MODELABLE_PLAYER_PROPS",
        model: CBB_PLAYER_PROP_V2_ID,
        version: CBB_PLAYER_PROP_V2_VERSION,
        independent: true,
        marketInformed: false,
        canQualify: false,
      },
    };
  });
  return {
    games: out,
    meta: {
      modelId: CBB_PLAYER_PROP_V2_ID,
      modelVersion: CBB_PLAYER_PROP_V2_VERSION,
      markets: CBB_PLAYER_PROP_MARKETS,
      promotedMarkets: CBB_PLAYER_PROP_V2_MARKETS,
      fallbackMarkets: ["three_pointers_made"],
      games: out.length,
      projectedGames,
      projectedRows,
      source: context?.meta?.source || "CBBD",
      feedOk: Boolean(context?.ok),
      feed: context?.meta || null,
      canQualify: false,
      canAuthorizeWager: false,
      marketInformed: false,
    },
  };
}
