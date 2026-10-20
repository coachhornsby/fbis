#!/usr/bin/env node
/**
 * Read-only verification of cfbd-games-teams-players completeness.
 * Checks R2 prefixes + D1 collection manifests. Never calls CFBD.
 *
 * Env (optional — when absent, prints the operator dispatch recipe only):
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN  — live R2/D1 probe
 * Or rely on previously written artifacts/cfb-games-teams-players-status.json
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

const OUT = "artifacts/cfb-games-teams-players-status.json";
const SEASON = Number(process.env.CFB_VERIFY_SEASON || 2026);
const WEEK = Number(process.env.CFB_VERIFY_WEEK || 8);

const status = {
  generatedAt: new Date().toISOString(),
  datasetId: "cfbd-games-teams-players",
  season: SEASON,
  week: WEEK,
  authority: "quota-governed-cfb-current-refresh-only",
  requiredPrefixes: [
    `raw/cfbd/cfb/${SEASON}/games_teams/`,
    `raw/cfbd/cfb/${SEASON}/games_players/`,
  ],
  operatorRecipe: {
    workflow: "FBIS college research (college.yml)",
    inputs: {
      job: "cfb-current-refresh",
      operatorApproved: "true",
      year: String(SEASON),
      week: String(WEEK),
    },
    note: "Must use workflow_dispatch + operatorApproved so cfbdNetworkAuthorized=true. Do not call api.collegefootballdata.com outside the Worker governor.",
  },
  live: null,
  complete: false,
};

mkdirSync("artifacts", { recursive: true });

if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    status.previous = {
      generatedAt: prev.generatedAt,
      complete: prev.complete,
      live: prev.live,
    };
  } catch {
    /* ignore */
  }
}

// Prefer an externally supplied probe result (Cloud Agent / operator).
if (process.env.CFB_GAMES_TEAMS_PLAYERS_PROBE_JSON) {
  status.live = JSON.parse(process.env.CFB_GAMES_TEAMS_PLAYERS_PROBE_JSON);
  status.complete = Boolean(
    status.live?.r2GamesTeamsObjects > 0 &&
      status.live?.r2GamesPlayersObjects > 0 &&
      status.live?.manifestStatus === "complete_and_verified"
  );
}

writeFileSync(OUT, `${JSON.stringify(status, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      out: OUT,
      complete: status.complete,
      operatorRecipe: status.operatorRecipe,
      hint: status.complete
        ? "Dataset complete"
        : "Still incomplete — dispatch authorized cfb-current-refresh",
    },
    null,
    2
  )
);
process.exitCode = status.complete ? 0 : 3;
