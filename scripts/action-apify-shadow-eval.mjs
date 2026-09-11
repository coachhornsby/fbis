#!/usr/bin/env node
/**
 * Manual Action/Apify shadow evaluation runner.
 *
 * - Never prints APIFY_TOKEN
 * - Hard-clamps maxItems to free-plan 10
 * - Stops when estimated spend reaches the research budget (default $1)
 * - Does not touch the production odds router
 *
 * Usage:
 *   node scripts/action-apify-shadow-eval.mjs --matrix A
 *   node scripts/action-apify-shadow-eval.mjs --matrix A,B,D --budget 1.0
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  ACTION_APIFY_PROVIDER,
  ACTION_APIFY_SOURCE_CLASS,
  apifyTokenConfigured,
  assertActionApifyNotInProductionRouter,
  createResearchBudget,
  estimateActorCostUsd,
  buildActorInput,
  runActionApifyShadow,
} from "../functions/lib/actionApifyShadow.js";
import { ODDS_PROVIDER_ORDER } from "../functions/lib/oddsProviderRouter.js";

assertActionApifyNotInProductionRouter(ODDS_PROVIDER_ORDER);

const args = parseArgs(process.argv.slice(2));
const budgetUsd = Number(args.budget || 1);
const matrixIds = String(args.matrix || "A")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const MATRIX = {
  A: {
    id: "A",
    title: "Current CFB base",
    opts: { leagues: ["ncaaf"], maxItems: 10, includeLineMovement: false },
  },
  B: {
    id: "B",
    title: "Current CFB + line movement",
    opts: { leagues: ["ncaaf"], maxItems: 5, includeLineMovement: true },
  },
  C: {
    id: "C",
    title: "Historical CFB completed",
    opts: {
      leagues: ["ncaaf"],
      maxItems: 10,
      season: 2025,
      // Actor enum is "complete" (not "final"); buildActorInput also aliases final→complete.
      gameStatus: "complete",
      includeLineMovement: false,
    },
  },
  D: {
    id: "D",
    title: "Current MLB full game",
    opts: { leagues: ["mlb"], maxItems: 10, periods: ["event"] },
  },
  E: {
    id: "E",
    title: "MLB first five",
    // Actor enum is "firstfiveinnings"; buildActorInput aliases firstfive→firstfiveinnings.
    opts: { leagues: ["mlb"], maxItems: 10, periods: ["firstfiveinnings"] },
  },
  F: {
    id: "F",
    title: "MLB player props",
    opts: { leagues: ["mlb"], maxItems: 4, includePlayerProps: true },
  },
};

if (!apifyTokenConfigured(process.env)) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        configured: false,
        provider: ACTION_APIFY_PROVIDER,
        sourceClass: ACTION_APIFY_SOURCE_CLASS,
        error: "APIFY_TOKEN not configured — install as a secret before live runs",
        matrixRequested: matrixIds,
      },
      null,
      2
    )
  );
  process.exit(2);
}

const budget = createResearchBudget({ limitUsd: budgetUsd });
const results = [];
mkdirSync("artifacts/action-apify-shadow", { recursive: true });

for (const id of matrixIds) {
  const cell = MATRIX[id];
  if (!cell) {
    results.push({ id, ok: false, error: "unknown-matrix-cell" });
    continue;
  }
  const input = buildActorInput(cell.opts);
  const estimate = estimateActorCostUsd(input);
  if (!budget.canAfford(estimate)) {
    results.push({
      id,
      title: cell.title,
      ok: false,
      blocked: true,
      error: "research-budget-exhausted",
      estimatedCostUsd: estimate,
      spentUsd: budget.spentUsd,
      limitUsd: budget.limitUsd,
    });
    break;
  }

  const run = await runActionApifyShadow(process.env, {
    ...cell.opts,
    testId: `matrix-${id}`,
    budget,
  });
  results.push({
    id,
    title: cell.title,
    ok: run.ok,
    configured: run.configured,
    blocked: run.blocked || false,
    error: run.error || null,
    runId: run.runId || null,
    gamesReturned: run.gamesReturned ?? null,
    estimatedCostUsd: run.estimatedCostUsd ?? estimate,
    spentUsd: budget.spentUsd,
    remainingUsd: budget.remainingUsd,
    // Never include token or raw Authorization headers.
    sampleGameIds: (run.rows || []).slice(0, 5).map((r) => r.actionGameId),
  });
  if (!run.ok && run.blocked) break;
}

const summary = {
  ok: results.every((r) => r.ok),
  provider: ACTION_APIFY_PROVIDER,
  sourceClass: ACTION_APIFY_SOURCE_CLASS,
  budgetLimitUsd: budget.limitUsd,
  spentUsd: budget.spentUsd,
  remainingUsd: budget.remainingUsd,
  runs: results,
  generatedAt: new Date().toISOString(),
};

const out = `artifacts/action-apify-shadow/eval-${Date.now()}.json`;
writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, artifact: out }, null, 2));
process.exit(summary.ok ? 0 : 1);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--matrix") out.matrix = argv[++i];
    else if (a === "--budget") out.budget = argv[++i];
  }
  return out;
}
