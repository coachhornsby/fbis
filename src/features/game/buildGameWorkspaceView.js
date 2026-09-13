import { toDomainEvent } from "../../../functions/lib/fbisDomain.js";
import {
  boardShowsFairProbability,
  resolveBoardProjection,
} from "../../lib/boardDecision.js";

/**
 * Build a Game Workspace view-model from a today/slate board game.
 * Never invents markets, prices, or decision authority.
 * Compact rows and expanded detail share resolveBoardProjection.
 */
export function buildGameWorkspaceView(boardGame, opts = {}) {
  if (boardGame == null || typeof boardGame !== "object") {
    return { event: null, weather: null, lab: null };
  }
  const event = toDomainEvent(boardGame, opts);
  const proj = resolveBoardProjection(boardGame);
  const showFairProbability = boardShowsFairProbability(boardGame);

  if (event?.model) {
    if (proj.available) {
      event.model.projAway = proj.away;
      event.model.projHome = proj.home;
      event.model.projTotal = proj.total;
      event.model.projMargin = proj.margin;
      event.model.projectionKind = proj.displayKind || "FBIS";
      event.model.projectionDisplayKind = proj.headlineLabel || proj.displayKind || "FBIS";
      event.model.unavailable = false;
    } else {
      event.model.unavailable = Boolean(
        event.model.unavailable || boardGame.projectionUnavailable
      );
      // Never headline a market-implied kind as the FBIS projection state.
      if (
        String(event.model.projectionKind || "")
          .toUpperCase()
          .includes("PINNACLE") ||
        String(event.model.projectionKind || "")
          .toUpperCase()
          .includes("MARKET")
      ) {
        event.model.projectionDisplayKind = "NO PURE MODEL";
      }
    }
    // research-v0-form and other non-authoritative probs stay hidden.
    if (!showFairProbability) {
      event.model.pHome = null;
      event.model.showFairProbability = false;
    } else {
      event.model.showFairProbability = true;
    }
  }

  return {
    event,
    weather: boardGame.weather || null,
    lab: {
      sport: boardGame.sport || event.sport,
      // Preserve deep sport-specific diagnostics without promoting them into decision UI.
      cfbDetail: boardGame.cfbDetail || null,
      projectionRecipe: boardGame.projectionRecipe || null,
      cfbFbisV2: boardGame.cfbFbisV2 || boardGame.challengers?.["CFB-FBIS-v2"] || null,
      cfbPlayerV1: boardGame.cfbPlayerV1 || boardGame.challengers?.["CFB-PLAYER-v1"] || null,
      propConvictions: Array.isArray(boardGame.propConvictions)
        ? boardGame.propConvictions
        : [],
      myBets: Array.isArray(boardGame.myBets) ? boardGame.myBets : [],
      f5Book: boardGame.f5Book || null,
      palF5Home: boardGame.palF5Home ?? null,
      palF5Away: boardGame.palF5Away ?? null,
    },
  };
}
