/**
 * TENNIS-FBIS-v2 / TENNIS-PLAYER-v2
 * Fundamental v2 = v1.1-DEEP + explicit physical/court/style context.
 * MARKET-v2 remains a separate residual layer and never contaminates PURE features.
 */
import { deepMatchupProfiles } from "./tennisTwoSidedV11.js";
import { simulateTennisMatch } from "./tennisFbisV1.js";
import { contextualizeMatchupProfiles, tennisContextServeAdjustment } from "./tennisContextV2.js";
import { buildSharpMarketPrior, tennisMarketResidualProjection } from "./tennisMarketV2.js";
import { validateTennisProjectionProfile, noValidTennisProjection } from "./tennisPlayerDataIntegrity.js";

export const TENNIS_V2_MATCH_MODEL_ID="TENNIS-FBIS-v2-CONTEXT";
export const TENNIS_V2_PLAYER_MODEL_ID="TENNIS-PLAYER-v2-CONTEXT";
export const TENNIS_V2_VERSION="v2-deep-context-market-separated";

export function simulateTennisV2(game={},ctx={},opts={}){
  const tour=game.tour||ctx.tour||"atp",surface=game.surface||ctx.surface||"hard";
  const base=deepMatchupProfiles(game.player1,game.player2,{tour,surface});
  const contexts=game.playerContexts||ctx.playerContexts||[{},{}];
  const profiles=contextualizeMatchupProfiles(base,contexts);
  const projection=simulateTennisMatch({...game,player1:profiles[0],player2:profiles[1]},ctx,opts);
  const c1=tennisContextServeAdjustment(contexts[0]||{},contexts[1]||{});
  const c2=tennisContextServeAdjustment(contexts[1]||{},contexts[0]||{});
  return {
    ...projection,
    modelId:TENNIS_V2_MATCH_MODEL_ID,
    playerModelId:TENNIS_V2_PLAYER_MODEL_ID,
    modelVersion:TENNIS_V2_VERSION,
    fundamentalOnly:true,
    marketInformed:false,
    contextual:true,
    matchupProfiles:profiles,
    contextDiagnostics:[c1,c2],
    canQualify:false,canAuthorizeWager:false,decisionEligible:false,
    maturity:"RESEARCH"
  };
}

export function simulateTennisMarketV2(game={},ctx={},opts={}){
  const pure=simulateTennisV2(game,ctx,opts);
  const market=buildSharpMarketPrior({
    quotes:game.marketQuotes||ctx.marketQuotes||[],
    pinnacle:game.pinnacle||ctx.pinnacle||null,
    betfair:game.betfair||ctx.betfair||null,
  });
  const c=pure.contextDiagnostics||[];
  const contextDiff=((c[0]?.total||0)-(c[1]?.total||0))*2.5;
  const marketProjection=tennisMarketResidualProjection({
    fundamentalP1:pure.match?.pPlayer1Win,
    market,
    actionIntel:game.actionIntel||ctx.actionIntel||null,
    contextDifferential:contextDiff,
    residualWeight:opts.residualWeight??ctx.residualWeight??.22,
    maxResidualLogit:opts.maxResidualLogit??ctx.maxResidualLogit??.45,
  });
  return {
    pure,
    market:marketProjection,
    governance:{
      pureModelMarketFree:true,
      marketLayerSeparate:true,
      maturity:"RESEARCH",
      canQualify:false,
      canAuthorizeWager:false,
      wagerPromotion:false,
    }
  };
}
