import { finiteOrNull } from "../features/today/formatters.js";

export function hasCurrentProjection(game = {}) {
  return finiteOrNull(game.projection?.home) != null &&
    finiteOrNull(game.projection?.away) != null;
}
