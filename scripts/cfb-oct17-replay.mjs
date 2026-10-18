#!/usr/bin/env node
/**
 * Offline/live Oct 17 2026 CFB replay.
 * Reads CLOSE prediction_snapshots + team_feature_snapshots (via wrangler D1
 * or a local JSON fixture) and writes artifacts without mutating production.
 *
 * Usage:
 *   node scripts/cfb-oct17-replay.mjs
 *   CFB_REPLAY_FIXTURE=artifacts/cfb-oct17-fixture.json node scripts/cfb-oct17-replay.mjs
 *   node scripts/cfb-oct17-replay.mjs --live
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  replayOneGame,
  aggregateReplayMetrics,
} from "../functions/lib/cfbOct17Replay.js";
import { runOklahomaProjectionAudit } from "../functions/lib/cfbOklahomaAudit.js";
import PRIOR_V1 from "../data/cfb/prior-v1.js";

const OUT_DIR = "artifacts/cfb-oct17-replay";
const DATE = "2026-10-17";
const live = process.argv.includes("--live");
const fixturePath = process.env.CFB_REPLAY_FIXTURE || `${OUT_DIR}/fixture.json`;

function d1Query(sql) {
  const r = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", "fbis", "--remote", "--json", "--command", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`wrangler d1 failed: ${r.stderr || r.stdout}`);
  }
  const parsed = JSON.parse(r.stdout);
  const block = Array.isArray(parsed) ? parsed[0] : parsed;
  return block?.results || block?.result?.[0]?.results || [];
}

function schoolToEspn(school) {
  const name = String(school || "").toLowerCase();
  for (const [id, row] of Object.entries(PRIOR_V1.byEspnId || {})) {
    if (String(row.school || "").toLowerCase() === name) return String(id);
  }
  // common aliases
  const aliases = {
    "oklahoma st": "197",
    "oklahoma state": "197",
    "ole miss": "145",
    "miami": "2390",
    "miami fl": "2390",
    "miami (fl)": "2390",
    "southern california": "30",
    "usc": "30",
    "lsu": "99",
    "ucla": "26",
    "smu": "2567",
    "utsa": "2636",
    "uab": "5",
    "byu": "252",
    "tcu": "2628",
  };
  return aliases[name] || null;
}

function parseMatchup(matchup) {
  const parts = String(matchup || "").split("@").map((s) => s.trim());
  return { away: parts[0] || null, home: parts[1] || null };
}

function loadFixture() {
  if (!existsSync(fixturePath)) return null;
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function fetchLive() {
  const closes = d1Query(
    `SELECT game_id, matchup, frozen_at, proj_home, proj_away, proj_total, proj_margin, actual_home, actual_away, projection_state, projection_flags
     FROM prediction_snapshots
     WHERE sport='cfb' AND date='${DATE}' AND checkpoint='CLOSE' AND model_version='CFB-FBIS-v2'
     ORDER BY game_id`
  );
  const features = d1Query(
    `SELECT team_id, as_of, features_json
     FROM team_feature_snapshots
     WHERE sport='cfb' AND season=2026 AND feature_version='cfb-features-v1'
       AND as_of <= '2026-10-17T23:59:59Z'
     ORDER BY as_of DESC
     LIMIT 700`
  );
  return { closes, features, fetchedAt: new Date().toISOString(), source: "d1-live" };
}

function indexFeatures(rows) {
  const bySchool = new Map();
  const byEspn = new Map();
  for (const rec of rows || []) {
    let fields = rec;
    if (rec.features_json) {
      try {
        fields = { ...JSON.parse(rec.features_json || "{}"), team_id: rec.team_id, as_of: rec.as_of };
      } catch {
        continue;
      }
    }
    const school = String(fields.team || fields.school || "").toLowerCase();
    if (!school || bySchool.has(school)) continue;
    const entry = { ...fields, as_of: fields.as_of || rec.as_of, team_id: fields.team_id || rec.team_id };
    bySchool.set(school, entry);
    const espn =
      String(fields.espnId || "").replace(/\D/g, "") ||
      /(?:cfb:espn:|cfb-)?(\d{1,12})$/.exec(String(entry.team_id || ""))?.[1];
    if (espn && !byEspn.has(espn)) byEspn.set(String(espn), entry);
  }
  return { bySchool, byEspn };
}

function resolveTeam(name, index) {
  const school = String(name || "").toLowerCase();
  const hit = index.bySchool.get(school);
  const espn = (hit && /(?:cfb:espn:|cfb-)?(\d+)/.exec(String(hit.team_id || ""))?.[1]) || schoolToEspn(school);
  const features = hit || (espn ? index.byEspn.get(String(espn)) : null) || null;
  return { espnId: espn, features, asOf: features?.as_of || null, school: name };
}

function runMode(closes, index, mode) {
  const rows = [];
  const exclusions = [];
  for (const close of closes) {
    const { away, home } = parseMatchup(close.matchup);
    const homeT = resolveTeam(home, index);
    const awayT = resolveTeam(away, index);
    if (!homeT.espnId || !awayT.espnId) {
      exclusions.push({ gameId: close.game_id, matchup: close.matchup, reason: "team-id-unresolved" });
      continue;
    }
    if (!homeT.features || !awayT.features) {
      exclusions.push({
        gameId: close.game_id,
        matchup: close.matchup,
        reason: "features-missing",
        homeEspnId: homeT.espnId,
        awayEspnId: awayT.espnId,
      });
      continue;
    }
    const kickoffGuess = close.frozen_at; // CLOSE is pre-kickoff; kick exact time not always stored
    const row = replayOneGame({
      close,
      homeEspnId: homeT.espnId,
      awayEspnId: awayT.espnId,
      homeFeatures: homeT.features,
      awayFeatures: awayT.features,
      homeFeatureAsOf: homeT.asOf,
      awayFeatureAsOf: awayT.asOf,
      kickoff: kickoffGuess,
      mode,
    });
    rows.push(row);
  }
  return { rows, exclusions, aggregate: aggregateReplayMetrics(rows) };
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let payload = loadFixture();
  if (live || !payload) {
    try {
      payload = fetchLive();
      writeFileSync(fixturePath, JSON.stringify(payload, null, 2));
    } catch (err) {
      if (!payload) {
        console.error("Unable to load fixture or live D1:", err.message);
        process.exit(1);
      }
      console.warn("Live D1 fetch failed; using existing fixture:", err.message);
    }
  }

  const index = indexFeatures(payload.features || []);
  const closes = payload.closes || [];
  const oklahoma = runOklahomaProjectionAudit();
  const diagnostic = runMode(closes, index, "diagnostic");
  const strict = runMode(closes, index, "strict");

  // CORE ablation: same rebuild but report marginFeatures presence
  const withCoreCount = diagnostic.rows.filter((r) => r.rebuilt?.ok).length;

  const report = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: payload.source || "fixture",
    closeCount: closes.length,
    oklahomaAudit: oklahoma,
    diagnostic: {
      mode: "diagnostic",
      caveat: "Not valid unbiased out-of-sample evidence if the model was altered after inspecting Oct 17 outcomes.",
      ...diagnostic.aggregate,
      exclusions: diagnostic.exclusions,
      games: diagnostic.rows,
    },
    strict: {
      mode: "strict",
      caveat: "Availability window only; attach independent CFBD publication receipts before OOS claims.",
      ...strict.aggregate,
      exclusions: strict.exclusions,
      games: strict.rows,
    },
    coreEvaluation: {
      note: "Production fitted package is M*=A / T*=A (base only). CORE is available on the feature surface and deep feed but is not in the fitted score. Do not promote CORE from Oct 17 alone.",
      rebuiltGamesWithOkProjection: withCoreCount,
      fittedUsesCore: false,
      corePresentOnSnapshots: [...index.bySchool.values()].filter((f) => f.coreWeekBounded === true).length,
    },
    dataCoverage: {
      featureSnapshotsIndexed: index.bySchool.size,
      closes: closes.length,
      diagnosticEligibleGraded: diagnostic.aggregate.nEligibleGraded,
      strictEligibleGraded: strict.aggregate.nEligibleGraded,
    },
  };

  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
  const md = [
    `# CFB October 17, 2026 Replay`,
    ``,
    `Generated: ${report.generatedAt}`,
    `CLOSE snapshots: ${closes.length}`,
    ``,
    `## Oklahoma audit`,
    `- Original fitted reconstruction: ${oklahoma.originalReconstruction.fitted.home}–${oklahoma.originalReconstruction.fitted.away} (tolerance ok: ${oklahoma.originalReconstruction.withinRoundingTolerance})`,
    `- Repaired fitted: ${oklahoma.repaired.fitted.home}–${oklahoma.repaired.fitted.away}`,
    `- Actual: ${oklahoma.originalClose.actualHome}–${oklahoma.originalClose.actualAway}`,
    `- Original margin MAE contrib: ${oklahoma.repaired.vsActual.originalMarginError}`,
    `- Repaired margin error: ${oklahoma.repaired.vsActual.repairedMarginError}`,
    ``,
    `## Diagnostic aggregate (do not mix with strict)`,
    `- Graded: ${diagnostic.aggregate.nEligibleGraded}`,
    `- Original winner%: ${diagnostic.aggregate.original.winnerPct}`,
    `- Rebuilt winner%: ${diagnostic.aggregate.rebuilt.winnerPct}`,
    `- Original margin MAE: ${diagnostic.aggregate.original.marginMae}`,
    `- Rebuilt margin MAE: ${diagnostic.aggregate.rebuilt.marginMae}`,
    `- Winner corrected/worsened: ${diagnostic.aggregate.winnerSelections.corrected}/${diagnostic.aggregate.winnerSelections.worsened}`,
    ``,
    `## Strict aggregate`,
    `- Graded: ${strict.aggregate.nEligibleGraded}`,
    `- Original winner%: ${strict.aggregate.original.winnerPct}`,
    `- Rebuilt winner%: ${strict.aggregate.rebuilt.winnerPct}`,
    ``,
    `| Game | Original FBIS | Rebuilt FBIS | Actual | Orig margin err | Rebuilt margin err |`,
    `|---|---|---|---|---|---|`,
    ...diagnostic.rows.map((r) => {
      const o = r.original.home != null ? `${r.original.away}–${r.original.home}` : "—";
      const b = r.rebuilt.home != null ? `${r.rebuilt.away}–${r.rebuilt.home}` : "—";
      const a = r.actual.home != null ? `${r.actual.away}–${r.actual.home}` : "ungraded";
      const oe = r.originalError?.marginError ?? "—";
      const re = r.rebuiltError?.marginError ?? "—";
      return `| ${r.matchup} | ${o} | ${b} | ${a} | ${oe} | ${re} |`;
    }),
    ``,
    `_Scores shown away–home to match card orientation (visitor @ home)._`,
  ].join("\n");
  writeFileSync(`${OUT_DIR}/REPORT.md`, md);
  writeFileSync(`${OUT_DIR}/oklahoma-audit.json`, JSON.stringify(oklahoma, null, 2));

  console.log(JSON.stringify({
    ok: true,
    outDir: OUT_DIR,
    closeCount: closes.length,
    diagnosticGraded: diagnostic.aggregate.nEligibleGraded,
    strictGraded: strict.aggregate.nEligibleGraded,
    oklahomaRepaired: oklahoma.repaired.fitted,
    oklahomaOriginalOk: oklahoma.originalReconstruction.withinRoundingTolerance,
  }, null, 2));
}

main();
