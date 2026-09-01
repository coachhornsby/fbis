export const POPULATION_TYPE = {
  FROZEN_PROJECTION: "frozen_projection",
  QUALIFIED_RECOMMENDATION: "qualified_recommendation",
  STRATEGY_TICKET: "strategy_ticket",
  IMPORTED_HERITAGE_EXECUTION: "imported_heritage_execution",
  OPERATOR_ONLY_BET: "operator_only_bet",
};

function n(v) {
  return v == null || v === "" ? null : v;
}

export function populationDescriptor(input = {}) {
  return {
    populationType: input.populationType || null,
    sport: input.sport || "all",
    marketFamily: input.marketFamily || "all",
    periodFamily: input.periodFamily || "all",
    strategyId: n(input.strategyId),
    strategyVersion: n(input.strategyVersion),
    modelVersion: n(input.modelVersion),
    qualificationRuleVersion: n(input.qualificationRuleVersion),
    checkpoint: n(input.checkpoint),
    dateRange: input.dateRange || null,
    settledN: Number(input.settledN || 0),
    openN: Number(input.openN || 0),
    pushN: Number(input.pushN || 0),
    voidN: Number(input.voidN || 0),
    unresolvedN: Number(input.unresolvedN || 0),
    clvN: Number(input.clvN || 0),
    sourceHealth: input.sourceHealth || "unknown",
    freshness: input.freshness || null,
  };
}

export function descriptorKey(desc = {}) {
  return JSON.stringify({
    populationType: desc.populationType || null,
    sport: desc.sport || null,
    marketFamily: desc.marketFamily || null,
    periodFamily: desc.periodFamily || null,
    strategyId: desc.strategyId || null,
    strategyVersion: desc.strategyVersion || null,
    modelVersion: desc.modelVersion || null,
    qualificationRuleVersion: desc.qualificationRuleVersion || null,
    checkpoint: desc.checkpoint || null,
    dateRange: desc.dateRange || null,
  });
}

export function rejectMixedPopulations(rows = [], getDescriptor) {
  const keys = new Set();
  for (const row of rows || []) {
    const desc = getDescriptor ? getDescriptor(row) : row?.populationDescriptor;
    if (!desc) continue;
    keys.add(descriptorKey(desc));
  }
  return { ok: keys.size <= 1, keys: [...keys], mixed: keys.size > 1 };
}
