#!/usr/bin/env node
/**
 * Run NBA prospective shadow projection scripts across a forward CT date window.
 * Does not authorize wagers. Appends SQL for D1 import by the workflow.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  NBA_FORWARD_SHADOW_DAYS,
  nbaForwardDates,
  parseNbaDateArgs,
} from "../functions/lib/nbaForwardSlate.js";

const args = Object.fromEntries(process.argv.slice(2).map((x) => x.split("=")));
const today =
  args.date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const throughDays =
  args.throughDays != null && args.throughDays !== ""
    ? Number(args.throughDays)
    : NBA_FORWARD_SHADOW_DAYS;
const dates = parseNbaDateArgs({ ...args, date: today, throughDays });
const checkpoint = args.checkpoint || "SHADOW";
const prior = args.prior || "artifacts/frozen/nba-canonical.jsonl";
const current = args.current || "artifacts/current/nba-canonical.jsonl";
const impact = args.impact || "artifacts/nba-player-impact-live.json";
const fit = args.fit || "data/models/nba-fbis-v1-fit.json";
const deepFit = args.deepFit || "artifacts/deep/nba-fbis-v2-deep-fit.json";
const stateSnapshots = args.stateSnapshots || "artifacts/nba-latest-team-snapshots.json";
const codeSha = args.codeSha || process.env.GITHUB_SHA || "UNKNOWN";
const outDir = args.outDir || "artifacts/forward-shadow";

fs.mkdirSync(outDir, { recursive: true });

function run(cmd, cmdArgs) {
  const r = spawnSync(process.execPath, [cmd, ...cmdArgs], {
    encoding: "utf8",
    env: process.env,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`${cmd} failed with status ${r.status}`);
  }
  try {
    return JSON.parse(String(r.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "{}");
  } catch {
    return {};
  }
}

function appendSql(target, source) {
  if (!fs.existsSync(source) || !fs.statSync(source).size) return 0;
  const body = fs.readFileSync(source, "utf8");
  fs.appendFileSync(target, body.endsWith("\n") ? body : body + "\n");
  return body.split("\n").filter((l) => l.trim()).length;
}

const summary = { ok: true, dates, checkpoint, days: [], totals: { games: 0, props: 0 } };
const gameSql = `${outDir}/nba-forward-shadow.sql`;
const profileSql = `${outDir}/nba-forward-profile.sql`;
const deepSql = `${outDir}/nba-forward-deep.sql`;
const deepLedgerSql = `${outDir}/nba-forward-deep-ledger.sql`;
for (const f of [gameSql, profileSql, deepSql, deepLedgerSql]) fs.writeFileSync(f, "");

for (const date of dates.length ? dates : nbaForwardDates(today, throughDays)) {
  const dayOut = `${outDir}/${date}`;
  fs.mkdirSync(dayOut, { recursive: true });
  const shadow = run("scripts/nba-shadow-project.mjs", [
    `date=${date}`,
    `checkpoint=${checkpoint}`,
    `prior=${prior}`,
    `current=${current}`,
    `impact=${impact}`,
    `fit=${fit}`,
    `out=${dayOut}/nba-shadow.json`,
    `sql=${dayOut}/nba-shadow.sql`,
  ]);
  appendSql(gameSql, `${dayOut}/nba-shadow.sql`);

  const profile = run("scripts/nba-profile-shadow-project.mjs", [
    `date=${date}`,
    `checkpoint=${checkpoint}`,
    `codeSha=${codeSha}`,
    `prior=${prior}`,
    `current=${current}`,
    `impact=${impact}`,
    `fit=${fit}`,
    `stateSnapshots=${stateSnapshots}`,
    `out=${dayOut}/nba-three-model-freeze.json`,
    `sql=${dayOut}/nba-profile-prospective.sql`,
  ]);
  appendSql(profileSql, `${dayOut}/nba-profile-prospective.sql`);

  let deep = { skipped: true };
  if (fs.existsSync(deepFit) && fs.statSync(deepFit).size) {
    deep = run("scripts/nba-deep-shadow-project.mjs", [
      `date=${date}`,
      `checkpoint=${checkpoint}`,
      `prior=${prior}`,
      `current=${current}`,
      `impact=${impact}`,
      `fit=${deepFit}`,
      `out=${dayOut}/nba-deep-shadow.json`,
      `sql=${dayOut}/nba-deep-shadow.sql`,
    ]);
    appendSql(deepSql, `${dayOut}/nba-deep-shadow.sql`);
    if (fs.existsSync(`${dayOut}/nba-deep-shadow.json`)) {
      run("scripts/nba-deep-prospective-ledger.mjs", [
        `input=${dayOut}/nba-deep-shadow.json`,
        `stateSnapshots=${stateSnapshots}`,
        `codeSha=${codeSha}`,
        `sql=${dayOut}/nba-deep-prospective-ledger.sql`,
      ]);
      appendSql(deepLedgerSql, `${dayOut}/nba-deep-prospective-ledger.sql`);
    }
  }

  const games = Number(shadow.games || 0);
  const props = Number(shadow.props || 0);
  summary.totals.games += games;
  summary.totals.props += props;
  summary.days.push({
    date,
    games,
    props,
    profileRows: Number(profile.rows || 0),
    deepSkipped: Boolean(deep.skipped),
  });
}

fs.writeFileSync(`${outDir}/nba-forward-shadow-summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
