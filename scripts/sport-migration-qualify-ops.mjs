#!/usr/bin/env node
/**
 * Sport migration qualification ops. PRIMARY remains authoritative.
 * Never activates cutover. Never deletes source rows.
 */
import { appendFile } from "node:fs/promises";
import { createTopologyClient } from "./lib/topologyFetch.mjs";

const BASE = process.env.FBIS_BASE_URL || "https://fbis-myz.pages.dev";
const SECRET = process.env.HARVEST_SECRET || "";
const SPORT = String(process.env.SPORT || "nfl").toLowerCase();
const RUN_DELTA = process.env.RUN_DELTA_SYNC === "true";
const RUN_CUTOVER = process.env.RUN_CUTOVER_REHEARSAL === "true";
const SAMPLE = Math.min(200, Number(process.env.SAMPLE_SIZE) || 40);
const REQUEST_TIMEOUT_MS = Math.min(540_000, Number(process.env.QUALIFY_TIMEOUT_MS) || 480_000);

const { postTopology } = createTopologyClient({
  base: BASE,
  secret: SECRET,
  timeoutMs: REQUEST_TIMEOUT_MS,
  retries: 2,
});

const qualify = await postTopology("sport-migration-qualify", {
  sport: SPORT,
  sampleSize: SAMPLE,
  runDeltaSync: RUN_DELTA,
  includePrefix: true,
  runCutoverRehearsal: RUN_CUTOVER,
});

const failures = [];
if (qualify.ok !== true) failures.push(qualify.reason || "QUALIFY_NOT_OK");
if (qualify.productStillPrimary === false || qualify.health?.productStillPrimary === false) {
  failures.push("PRODUCT_MUST_STAY_PRIMARY");
}
if (qualify.cutoverAuthorized === true || qualify.activationPerformed === true) {
  failures.push("CUTOVER_MUST_STAY_CLOSED");
}
if (qualify.deletionAuthorized === true) failures.push("DELETION_MUST_STAY_CLOSED");
if (qualify.canAuthorizeWager === true) failures.push("WAGER_AUTHORITY_MUST_STAY_FALSE");

const out = {
  ok: failures.length === 0,
  failures,
  sport: SPORT,
  readyForCutoverReview: qualify.readyForCutoverReview === true,
  gates: qualify.gates || null,
  countParity: qualify.countParity?.status || null,
  recordParity: qualify.recordParity?.status || null,
  prefixParity: qualify.prefixParity?.status || null,
  lagMs: qualify.health?.lagMs ?? null,
  contentSha256: qualify.contentSha256 || null,
  cutoverAuthorized: false,
  deletionAuthorized: false,
  activationPerformed: false,
  canAuthorizeWager: false,
  qualify,
};

console.log(JSON.stringify(out, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `## Sport migration qualify — ${SPORT}`,
      "",
      `| ok | ${out.ok} |`,
      `| readyForCutoverReview | ${out.readyForCutoverReview} |`,
      `| countParity | ${out.countParity} |`,
      `| recordParity | ${out.recordParity} |`,
      `| prefixParity | ${out.prefixParity} |`,
      `| lagMs | ${out.lagMs} |`,
      `| cutoverAuthorized | false |`,
      `| deletionAuthorized | false |`,
      "",
    ].join("\n")
  );
}

if (!out.ok) process.exit(1);
