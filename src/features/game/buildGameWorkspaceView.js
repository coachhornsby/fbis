import { toDomainEvent } from "../../../functions/lib/fbisDomain.js";

/**
 * Build a Game Workspace view-model from a today/slate board game.
 * Never invents markets, prices, or decision authority.
 */
export function buildGameWorkspaceView(boardGame, opts = {}) {
  if (boardGame == null || typeof boardGame !== "object") {
    return { event: null, weather: null, lab: null };
  }
  const event = toDomainEvent(boardGame, opts);
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
