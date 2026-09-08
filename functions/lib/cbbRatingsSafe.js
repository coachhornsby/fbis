/** Production-safe facade for CBB research challengers. */
import * as core from "./cbbRatings.js";
export * from "./cbbRatings.js";

const REQUIRED_MATCHUP = ["homeEfg", "awayEfgDef", "awayTov", "homeTov", "homeOrb", "awayOrb", "homeFtRate", "awayFtRate"];

export function hasVerifiedMatchupInputs(four = {}) {
  return REQUIRED_MATCHUP.every((key) => Number.isFinite(Number(four?.[key])));
}

export function projectCbbChallengers(game, ctx = {}) {
  const models = core.projectCbbChallengers(game, ctx);
  if (!hasVerifiedMatchupInputs(ctx.four || {})) {
    models["CBB-MATCHUP-v1"] = {
      ...(models["CBB-MATCHUP-v1"] || {}),
      modelId: "CBB-MATCHUP-v1",
      ok: false,
      featuresOk: false,
      available: false,
      canQualify: false,
      canLog: false,
      canWriteStrategy: false,
      blocked: true,
      reason: "verified-four-factor-matchup-inputs-unavailable",
      reasons: ["Required matchup feature set missing", "Challenger is shadow — cannot QUALIFY, LOG, or write strategy tickets"],
    };
  }
  return models;
}
