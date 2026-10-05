import { simulateTennisV2, TENNIS_V2_PLAYER_MODEL_ID, TENNIS_V2_VERSION } from "./tennisFbisV2.js";
import { tennisPlayerProjectionRows } from "./tennisFbisV1.js";

/**
 * TENNIS-PLAYER-PROP-v1 research model.
 *
 * Market line is intentionally absent from inputs. Initial target markets:
 * total_games and total_games_won.
 */
function finite(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function blend(primary, fallback, weight = 0.7) {
  const a = finite(primary), b = finite(fallback);
  if (a == null) return b;
  if (b == null) return a;
  return a * weight + b * (1 - weight);
}
function logistic(x) { return 1 / (1 + Math.exp(-x)); }
function row(player, market, projection, sigma, dataQuality) {
  return {
    playerId: player?.id ?? null,
    playerName: player?.name ?? null,
    market,
    fbisProjection: Math.round(projection * 10) / 10,
    fbisSigma: Math.round(sigma * 10) / 10,
    dataQuality: Math.round(dataQuality * 100) / 100,
    source: "TENNIS-PLAYER-PROP-v1",
    maturity: "RESEARCH",
    independent: true,
    marketInformed: false,
    canQualify: false,
  };
}

export function projectTennisPlayerProps(match = {}) {
  const a = match.playerA || {};
  const b = match.playerB || {};
  const holdA = blend(a.surfaceHoldPct, a.holdPct);
  const holdB = blend(b.surfaceHoldPct, b.holdPct);
  const breakA = blend(a.surfaceBreakPct, a.breakPct);
  const breakB = blend(b.surfaceBreakPct, b.breakPct);
  if ([holdA, holdB, breakA, breakB].some((v) => v == null)) {
    return { ok: false, state: "INSUFFICIENT_SERVICE_RETURN_DATA", rows: [] };
  }

  const matchupHoldA = clamp((holdA + (1 - breakB)) / 2, 0.35, 0.95);
  const matchupHoldB = clamp((holdB + (1 - breakA)) / 2, 0.35, 0.95);
  const gameShareA = clamp((matchupHoldA + (1 - matchupHoldB)) / 2, 0.2, 0.8);
  const eloDiff = finite(a.elo) != null && finite(b.elo) != null ? Number(a.elo) - Number(b.elo) : 0;
  const pA = clamp(logistic((gameShareA - 0.5) * 8 + eloDiff / 550), 0.08, 0.92);

  const bestOf = Number(match.bestOf || 3) === 5 ? 5 : 3;
  const competitiveness = 1 - Math.abs(2 * pA - 1);
  const totalGames = bestOf === 5
    ? clamp(30 + 11 * competitiveness, 27, 41)
    : clamp(18.5 + 6.5 * competitiveness, 18.5, 25);
  const shareA = clamp(0.5 + (pA - 0.5) * 0.42, 0.31, 0.69);
  const gamesA = totalGames * shareA;
  const gamesB = totalGames - gamesA;

  const sampleA = finite(a.surfaceSampleSize ?? a.sampleSize) ?? 0;
  const sampleB = finite(b.surfaceSampleSize ?? b.sampleSize) ?? 0;
  const dataQuality = clamp(0.55 + 0.45 * clamp(Math.min(sampleA, sampleB) / 20, 0, 1), 0, 1);
  const totalSigma = bestOf === 5 ? 4.8 : 3.2;
  const playerSigma = bestOf === 5 ? 3.4 : 2.4;

  return {
    ok: true,
    modelId: "TENNIS-PLAYER-PROP-v1",
    state: dataQuality >= 0.72 ? "RESEARCH_READY" : "RESEARCH_THIN_SAMPLE",
    independent: true,
    marketInformed: false,
    matchWinProbabilityA: Math.round(pA * 1000) / 1000,
    matchupHoldA: Math.round(matchupHoldA * 1000) / 1000,
    matchupHoldB: Math.round(matchupHoldB * 1000) / 1000,
    rows: [
      row({ id: match.id, name: String(a.name || "Player A") + " vs " + String(b.name || "Player B") }, "total_games", totalGames, totalSigma, dataQuality),
      row(a, "total_games_won", gamesA, playerSigma, dataQuality),
      row(b, "total_games_won", gamesB, playerSigma, dataQuality),
    ],
  };
}


/**
 * Preferred derivative-market research path.
 * Uses the deep/contextual v2 simulator when complete player profiles are supplied.
 * Market lines are used only to price probabilities after the distribution is generated.
 */
export function projectTennisPlayerPropsV2(match={},lines=[]){
  const player1=match.player1||match.playerA||{};
  const player2=match.player2||match.playerB||{};
  const hasDeep=[player1,player2].every(p=>
    finite(p.firstServeIn)!=null &&
    finite(p.firstServeWin)!=null &&
    finite(p.secondServeWin)!=null &&
    finite(p.returnFirstWin)!=null &&
    finite(p.returnSecondWin)!=null &&
    finite(p.aceRate)!=null &&
    finite(p.doubleFaultRate)!=null
  );
  if(!hasDeep){
    return {
      ok:false,state:"DEEP_PROFILE_REQUIRED",rows:[],
      modelId:TENNIS_V2_PLAYER_MODEL_ID,modelVersion:TENNIS_V2_VERSION,
      canQualify:false,canAuthorizeWager:false,
    };
  }
  const game={
    id:match.id||match.eventId||"tennis-v2-prop",
    tour:match.tour||"atp",surface:match.surface||"hard",
    bestOf:Number(match.bestOf)||3,player1,player2,
    playerContexts:match.playerContexts||[{},{}],
  };
  const projection=simulateTennisV2(
    game,
    {simulations:Math.max(1000,Number(match.simulations)||2500)},
    {seed:String(game.id)}
  );
  const rows=tennisPlayerProjectionRows(game,projection,lines).map(r=>({
    ...r,
    source:"TENNIS_PLAYER_V2_CONTEXT_SIM",
    modelId:TENNIS_V2_PLAYER_MODEL_ID,
    modelVersion:TENNIS_V2_VERSION,
    maturity:"RESEARCH",
    independent:true,
    marketInformed:false,
    canQualify:false,
    canAuthorizeWager:false,
    decisionEligible:false,
    eligibleForCard:false,
    propGate:"RESEARCH",
    gateReason:"prospective_derivative_clv_roi_validation_required",
    contextApplied:true,
  }));
  const priority={total_games:1,total_games_won:2,aces:3,double_faults:4,total_sets:5,break_points_won:6,total_tie_breaks:7,fantasy_score:8};
  rows.sort((a,b)=>(priority[a.market]||99)-(priority[b.market]||99));
  return {
    ok:true,state:"V2_RESEARCH_READY",modelId:TENNIS_V2_PLAYER_MODEL_ID,modelVersion:TENNIS_V2_VERSION,
    projection,rows,
    marketPriority:["total_games","total_games_won","aces","double_faults","total_sets","break_points_won","total_tie_breaks"],
    canQualify:false,canAuthorizeWager:false,
  };
}
