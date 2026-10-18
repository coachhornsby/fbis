#!/usr/bin/env node
/**
 * Evaluate Tuesday game cards with production feature vectors (read-only freeze check).
 * Does not authorize wagers. Does not mutate CLOSE snapshots.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { evaluateGameReadiness, summarizeReadinessSlate, READINESS } from "../functions/lib/cfbTuesdayReadiness.js";
import { buildSourceToModelAudit } from "../functions/lib/cfbSourceToModelAudit.js";
import PRIOR_V1 from "../data/cfb/prior-v1.js";

const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });

const FEATURES = existsSync(`${OUT}/tuesday-team-features.json`)
  ? JSON.parse(readFileSync(`${OUT}/tuesday-team-features.json`, "utf8"))
  : {
      "Florida International": {
        team_id: "cfb-2229",
        as_of: "2026-10-17T16:32:48.326Z",
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        offensePpa: 0.03,
        defensePpa: -0.03,
        coreThroughWeek: 6,
        school: "Florida International",
        espnId: "2229",
        canonicalId: "cfb-2229",
      },
      "Middle Tennessee": {
        team_id: "cfb-2393",
        as_of: "2026-10-17T16:32:51.060Z",
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        offensePpa: 0.13,
        defensePpa: 0.22,
        coreThroughWeek: 6,
        school: "Middle Tennessee",
        espnId: "2393",
        canonicalId: "cfb-2393",
      },
      Delaware: {
        team_id: "cfb-48",
        as_of: "2026-10-17T16:32:50.083Z",
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        offensePpa: 0.04,
        defensePpa: 0.11,
        coreThroughWeek: 6,
        school: "Delaware",
        espnId: "48",
        canonicalId: "cfb-48",
      },
      "Missouri State": {
        team_id: "cfb-2623",
        as_of: "2026-10-17T16:32:50.989Z",
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        offensePpa: 0.06,
        defensePpa: 0.22,
        coreThroughWeek: 6,
        school: "Missouri State",
        espnId: "2623",
        canonicalId: "cfb-2623",
      },
      Marshall: {
        team_id: "cfb-276",
        as_of: "2026-10-17T16:32:50.258Z",
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        offensePpa: 0.11,
        defensePpa: 0.31,
        coreThroughWeek: 6,
        school: "Marshall",
        espnId: "276",
        canonicalId: "cfb-276",
      },
      "South Alabama": {
        team_id: "cfb-6",
        as_of: "2026-10-17T16:32:49.617Z",
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        offensePpa: 0.23,
        defensePpa: 0.27,
        coreThroughWeek: 6,
        school: "South Alabama",
        espnId: "6",
        canonicalId: "cfb-6",
      },
    };

function priorFor(espnId, school) {
  const r = PRIOR_V1.byEspnId?.[String(espnId)];
  if (r) return { priorOff: r.off, priorDef: r.def, school: r.school };
  return {};
}

const GAMES = [
  {
    id: "espn-401871055",
    home: "Florida International",
    away: "Middle Tennessee",
    homeEspnId: "2229",
    awayEspnId: "2393",
    start: "2026-10-20T23:00:00.000Z",
    season: 2026,
    week: 9,
  },
  {
    id: "espn-401871069",
    home: "Delaware",
    away: "Missouri State",
    homeEspnId: "48",
    awayEspnId: "2623",
    start: "2026-10-20T23:00:00.000Z",
    season: 2026,
    week: 9,
  },
  {
    id: "espn-401871092",
    home: "Marshall",
    away: "South Alabama",
    homeEspnId: "276",
    awayEspnId: "6",
    start: "2026-10-20T23:30:00.000Z",
    season: 2026,
    week: 9,
  },
];

const results = [];
for (const game of GAMES) {
  const homeFeatures = {
    ...FEATURES[game.home],
    snapshotAsOf: FEATURES[game.home]?.as_of,
    canonicalId: FEATURES[game.home]?.canonicalId,
    espnId: game.homeEspnId,
  };
  const awayFeatures = {
    ...FEATURES[game.away],
    snapshotAsOf: FEATURES[game.away]?.as_of,
    canonicalId: FEATURES[game.away]?.canonicalId,
    espnId: game.awayEspnId,
  };
  const homePrior = priorFor(game.homeEspnId);
  const awayPrior = priorFor(game.awayEspnId);
  const readiness = evaluateGameReadiness({
    game,
    homeFeatures: { ...homeFeatures, ...homePrior },
    awayFeatures: { ...awayFeatures, ...awayPrior },
    homePrior,
    awayPrior,
    frozenVector: null, // freeze not yet executed — expected Provisional
  });
  readiness.sourceToModelAudit = buildSourceToModelAudit({
    game,
    homeFeatures,
    awayFeatures,
    projection: readiness.projection,
  });
  readiness.freezeStatus = {
    executed: false,
    reason: "Guarded pregame freeze checkpoint not yet run for 2026-10-20 slate; kickoffs ~23:00Z",
    earliestSafeFreeze: "after validation job + before kickoff (prefer T-3h CT)",
  };
  readiness.statusExplanation =
    readiness.status === READINESS.PROVISIONAL
      ? `Provisional because: ${(readiness.warnings || []).join(", ") || "documented limitations"}. Projection reproducible=${Boolean(readiness.projection)}. Wager not authorized.`
      : readiness.status === READINESS.BLOCKED
        ? `Blocked: ${(readiness.criticalFailures || []).join(", ")}`
        : "Ready — all critical checks passed";
  results.push(readiness);
}

const summary = summarizeReadinessSlate(results);
const report = {
  generatedAt: new Date().toISOString(),
  summary,
  games: results.map((r) => ({
    gameId: r.gameId,
    matchup: r.matchup,
    status: r.status,
    statusExplanation: r.statusExplanation,
    projection: r.projection,
    warnings: r.warnings,
    criticalFailures: r.criticalFailures,
    checks: r.checks,
    freezeStatus: r.freezeStatus,
    sourceToModelAudit: r.sourceToModelAudit,
  })),
  governance: { canAuthorizeWager: false, researchOnlyChallengers: true },
};

writeFileSync(`${OUT}/tuesday-final-readiness.json`, JSON.stringify(report, null, 2));
writeFileSync(
  `${OUT}/tuesday-final-readiness.md`,
  `# Tuesday Final Readiness\n\n${results.map((r) => `- **${r.status}** ${r.matchup}: ${r.statusExplanation}\\n  proj ${r.projection?.away} @ ${r.projection?.home}`).join("\\n")}\n\nSummary: ${JSON.stringify(summary)}\n`
);
console.log(JSON.stringify({ summary, games: results.map((r) => ({ m: r.matchup, s: r.status, w: r.warnings })) }, null, 2));
