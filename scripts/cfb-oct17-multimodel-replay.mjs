#!/usr/bin/env node
/**
 * Diagnostic Oct 17 multi-model replay using prior-v1 + compact feature TSV.
 * Mode: diagnostic (feature as_of before kickoff from D1; no CFBD publication receipt).
 * Model C fails closed (no fitted CORE artifact). Never mutates frozen snapshots.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { replayOneGame, aggregateReplayMetrics, scoreErrors } from "../functions/lib/cfbOct17Replay.js";
import { runOklahomaProjectionAudit, explainRepairedOklahomaInflation } from "../functions/lib/cfbOklahomaAudit.js";
import { analyzeSystematicSlices } from "../functions/lib/cfbWalkForward.js";
import PRIOR_V1 from "../data/cfb/prior-v1.js";

const OUT = "artifacts/cfb-oct17-rebuild";
const closesPath = `${OUT}/closes.tsv`;
const featPath = `${OUT}/features-compact.tsv`;

function parseTsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cols = line.split("\t");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i];
    });
    return row;
  });
}

function espnFromTeamId(teamId) {
  const m = /(?:cfb:espn:|cfb-)?(\d{1,12})$/.exec(String(teamId || ""));
  return m ? m[1] : null;
}

function schoolToEspn(school, featuresBySchool) {
  const name = String(school || "").toLowerCase();
  const feat = featuresBySchool?.get(name);
  const fromFeat = espnFromTeamId(feat?.team_id);
  if (fromFeat) return fromFeat;
  for (const [id, row] of Object.entries(PRIOR_V1.byEspnId || {})) {
    if (String(row.school || "").toLowerCase() === name) return String(id);
  }
  const aliases = {
    "oklahoma st": "197",
    "oklahoma state": "197",
    "ole miss": "145",
    miami: "2390",
    "miami fl": "2390",
    "miami (fl)": "2390",
    "san josé state": "23",
    "san jose state": "23",
    hawaii: "62",
    "hawai'i": "62",
    "ul monroe": "2433",
    "louisiana monroe": "2433",
    lsu: "99",
    "louisiana state": "99",
    "texas tech": "2641",
    "kansas state": "2306",
    "michigan state": "127",
    "oregon state": "204",
    "washington state": "265",
    "florida state": "52",
    "florida atlantic": "2226",
    "boston college": "103",
    "north dakota state": "2449",
    "northern illinois": "2459",
    "eastern michigan": "2199",
    "sacramento state": "16",
    "miami (oh)": "193",
    "southern miss": "2572",
    "arkansas state": "2032",
    "georgia state": "2247",
    "james madison": "256",
    "san diego state": "21",
    army: "349",
    navy: "2426",
    "air force": "2005",
  };
  return aliases[name] || null;
}

function featMap(rows) {
  const bySchool = new Map();
  for (const r of rows) {
    const key = String(r.team || "").toLowerCase();
    bySchool.set(key, {
      team: r.team,
      ppaOff: Number(r.ppaOff),
      ppaDef: Number(r.ppaDef),
      coreThroughWeek: Number(r.coreThroughWeek),
      coreWeekBounded: String(r.coreWeekBounded) === "1" || r.coreWeekBounded === true,
      coreOffense: Number(r.coreOffense),
      coreDefense: Number(r.coreDefense),
      offensiveSuccessRate: Number(r.offensiveSuccessRate),
      offensivePointsPerOpportunity: Number(r.offensivePointsPerOpportunity),
      ppaRush: Number(r.ppaRush),
      team_id: r.team_id,
      as_of: r.as_of,
      espnId: espnFromTeamId(r.team_id),
    });
  }
  return bySchool;
}

function aggChallenger(rows, path) {
  const graded = rows.filter((r) => {
    const c = path(r);
    return r.eligible && c?.ok && c.error?.graded;
  });
  if (!graded.length) return { n: 0 };
  const mae = (field) => {
    const vals = graded.map((r) => path(r).error[field]);
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  };
  const winners = graded.filter((r) => path(r).error.winnerCorrect).length;
  const biasHome =
    Math.round(
      (graded.reduce((a, r) => a + r.challengers[path === ((x) => x.challengers.B) ? "B" : path === ((x) => x.challengers.D) ? "D" : "A"].error.biasHome, 0) /
        graded.length) *
        100
    ) / 100;
  return {
    n: graded.length,
    winnerPct: Math.round((1000 * winners) / graded.length) / 10,
    marginMae: mae("marginError"),
    totalMae: mae("totalError"),
    homeMae: mae("homeError"),
    awayMae: mae("awayError"),
  };
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const closes = parseTsv(readFileSync(closesPath, "utf8"));
  const features = featMap(parseTsv(readFileSync(featPath, "utf8")));
  const rows = [];
  const exclusions = [];
  const reconciliation = [];

  for (const close of closes) {
    const [awayName, homeName] = String(close.matchup).split("@").map((s) => s.trim());
    const homeF = features.get(String(homeName).toLowerCase());
    const awayF = features.get(String(awayName).toLowerCase());
    const homeEspn = schoolToEspn(homeName, features);
    const awayEspn = schoolToEspn(awayName, features);
    const graded = close.actual_home != null && close.actual_home !== "" && close.actual_away != null && close.actual_away !== "";

    if (!homeF || !awayF) {
      exclusions.push({
        gameId: close.game_id,
        matchup: close.matchup,
        reason: "features-missing",
        home: !!homeF,
        away: !!awayF,
      });
      reconciliation.push({
        gameId: close.game_id,
        matchup: close.matchup,
        status: "excluded",
        reason: "features-missing",
        graded,
      });
      continue;
    }
    if (!homeEspn || !awayEspn) {
      exclusions.push({ gameId: close.game_id, matchup: close.matchup, reason: "team-id-unresolved" });
      reconciliation.push({
        gameId: close.game_id,
        matchup: close.matchup,
        status: "excluded",
        reason: "team-id-unresolved",
        graded,
      });
      continue;
    }
    const row = replayOneGame({
      close: {
        ...close,
        proj_home: Number(close.proj_home),
        proj_away: Number(close.proj_away),
        actual_home: graded ? Number(close.actual_home) : null,
        actual_away: graded ? Number(close.actual_away) : null,
        frozen_at: close.frozen_at,
        kickoff: close.kickoff,
      },
      homeEspnId: homeEspn,
      awayEspnId: awayEspn,
      homeFeatures: homeF,
      awayFeatures: awayF,
      homeFeatureAsOf: homeF.as_of,
      awayFeatureAsOf: awayF.as_of,
      kickoff: close.kickoff,
      mode: "diagnostic",
    });
    rows.push(row);
    reconciliation.push({
      gameId: close.game_id,
      matchup: close.matchup,
      status: graded ? "graded_diagnostic" : "in_progress_or_unsettled",
      reason: graded
        ? null
        : "ESPN still in-progress or finals not persisted; predictions.actual also null",
      espnHome: homeEspn,
      espnAway: awayEspn,
      oklahomaCheck:
        homeEspn === "201" || awayEspn === "201"
          ? { oklahoma: "201", oklahomaState: "197", distinct: homeEspn !== awayEspn }
          : null,
      original: row.original,
      repaired: row.rebuilt,
      modelB: row.challengers?.B,
      modelC: row.challengers?.C,
      modelD: row.challengers?.D,
      actual: row.actual,
    });
  }

  const gradedRows = rows.filter((r) => r.originalError?.graded && r.rebuiltError?.graded);
  const aggregate = aggregateReplayMetrics(gradedRows);

  const metricsB = (() => {
    const g = gradedRows.filter((r) => r.challengers?.B?.ok && r.challengers.B.error?.graded);
    const mae = (f) =>
      Math.round((g.reduce((a, r) => a + r.challengers.B.error[f], 0) / g.length) * 100) / 100;
    const w = g.filter((r) => r.challengers.B.error.winnerCorrect).length;
    return {
      n: g.length,
      winnerPct: Math.round((1000 * w) / g.length) / 10,
      marginMae: mae("marginError"),
      totalMae: mae("totalError"),
      homeMae: mae("homeError"),
      awayMae: mae("awayError"),
      biasHome: Math.round((g.reduce((a, r) => a + r.challengers.B.error.biasHome, 0) / g.length) * 100) / 100,
    };
  })();

  const metricsD = (() => {
    const g = gradedRows.filter((r) => r.challengers?.D?.ok && r.challengers.D.error?.graded);
    const mae = (f) =>
      Math.round((g.reduce((a, r) => a + r.challengers.D.error[f], 0) / g.length) * 100) / 100;
    const w = g.filter((r) => r.challengers.D.error.winnerCorrect).length;
    return {
      n: g.length,
      winnerPct: Math.round((1000 * w) / g.length) / 10,
      marginMae: mae("marginError"),
      totalMae: mae("totalError"),
      homeMae: mae("homeError"),
      awayMae: mae("awayError"),
      biasHome: Math.round((g.reduce((a, r) => a + r.challengers.D.error.biasHome, 0) / g.length) * 100) / 100,
    };
  })();

  const oklahoma = runOklahomaProjectionAudit();
  const inflation = explainRepairedOklahomaInflation({
    repairedFitted: oklahoma.repaired.fitted,
    ouBlend: oklahoma.repaired.ouOffBlend,
  });

  const sliceRows = gradedRows.map((r) => ({
    homePpaOff: features.get(String(r.matchup.split("@")[1] || "").trim().toLowerCase())?.ppaOff,
    homePpaDef: features.get(String(r.matchup.split("@")[1] || "").trim().toLowerCase())?.ppaDef,
    error: r.rebuiltError,
  }));
  const systematic = analyzeSystematicSlices(sliceRows);

  const worst = [...gradedRows]
    .sort((a, b) => (b.rebuiltError?.marginError || 0) - (a.rebuiltError?.marginError || 0))
    .slice(0, 8)
    .map((r) => ({
      matchup: r.matchup,
      original: `${r.original.away}–${r.original.home}`,
      repaired: `${r.rebuilt.away}–${r.rebuilt.home}`,
      modelB: r.challengers?.B?.ok ? `${r.challengers.B.away}–${r.challengers.B.home}` : null,
      actual: `${r.actual.away}–${r.actual.home}`,
      repairedMarginErr: r.rebuiltError.marginError,
      homePpa: features.get(String(r.matchup.split("@")[1] || "").trim().toLowerCase())?.ppaOff,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "diagnostic",
    caveat:
      "Diagnostic reconstruction with D1 feature as_of before kickoff. Not unbiased OOS evidence. Do not mix with strict. Do not promote from Oct 17 alone.",
    reconciliation: {
      closeSnapshots: closes.length,
      gradedWithFinals: gradedRows.length,
      ungradedInProgress: reconciliation.filter((r) => r.status === "in_progress_or_unsettled").length,
      featureCoverage: features.size,
      note: "45 CLOSE = 40 graded finals + 5 still ESPN STATUS_IN_PROGRESS (correctly unsettled)",
    },
    oklahoma,
    remainingInflation: inflation,
    aggregates: {
      original: aggregate.original,
      modelA_repairedChampion: aggregate.rebuilt,
      modelB_currentSeasonDominant: metricsB,
      modelC_currentPlusCore: {
        ok: false,
        reason: "FITTED_CORE_ARTIFACT_UNAVAILABLE",
        incrementalValue: "UNPROVEN",
      },
      modelD_combinedResearchBlend: metricsD,
      winnerSelections: aggregate.winnerSelections,
    },
    systematic,
    worstRepairedMisses: worst,
    games: reconciliation,
    exclusions,
  };

  writeFileSync(`${OUT}/multimodel-report.json`, JSON.stringify(report, null, 2));
  writeFileSync("/opt/cursor/artifacts/cfb-oct17-multimodel-report.json", JSON.stringify(report, null, 2));

  const md = [
    `# CFB October 17, 2026 — Full reconciliation & multi-model diagnostic`,
    ``,
    `Mode: **diagnostic** (do not claim unbiased OOS). Generated ${report.generatedAt}`,
    ``,
    `## Reconciliation`,
    `- CLOSE snapshots: **${closes.length}**`,
    `- Graded with verified finals: **${gradedRows.length}**`,
    `- Still in-progress / unsettled: **${report.reconciliation.ungradedInProgress}** (Utah@Colorado, Wake@Cal, Fresno@SDSU, NM@Hawai'i, Ohio@Sac State)`,
    `- Feature teams indexed: **${features.size}**`,
    ``,
    `## Oklahoma (401856722)`,
    `- Original frozen: **15.2–34.1** → Actual **21–13**`,
    `- Repaired Model A: **${oklahoma.repaired.fitted.away}–${oklahoma.repaired.fitted.home}**`,
    `- Current-only diagnostic: **${inflation.currentOnlyProjection.away}–${inflation.currentOnlyProjection.home}**`,
    `- Remaining inflation factors: ${inflation.factors.map((f) => f.id).join(", ")}`,
    ``,
    `## Aggregate (comparable graded cohort, n=${gradedRows.length})`,
    `| Model | Winner% | Margin MAE | Total MAE | Home MAE | Away MAE |`,
    `|---|---:|---:|---:|---:|---:|`,
    `| Original FBIS | ${aggregate.original.winnerPct} | ${aggregate.original.marginMae} | ${aggregate.original.totalMae} | ${aggregate.original.homeMae} | ${aggregate.original.awayMae} |`,
    `| A Repaired Champion | ${aggregate.rebuilt.winnerPct} | ${aggregate.rebuilt.marginMae} | ${aggregate.rebuilt.totalMae} | ${aggregate.rebuilt.homeMae} | ${aggregate.rebuilt.awayMae} |`,
    `| B Current-season (k=3) | ${metricsB.winnerPct} | ${metricsB.marginMae} | ${metricsB.totalMae} | ${metricsB.homeMae} | ${metricsB.awayMae} |`,
    `| C Current+CORE | — | — | — | — | — |`,
    `| D A/B research blend | ${metricsD.winnerPct} | ${metricsD.marginMae} | ${metricsD.totalMae} | ${metricsD.homeMae} | ${metricsD.awayMae} |`,
    ``,
    `Model C: **FITTED_CORE_ARTIFACT_UNAVAILABLE** — CORE incremental value **UNPROVEN**.`,
    `Winner corrected/worsened (A vs original): **${aggregate.winnerSelections.corrected}/${aggregate.winnerSelections.worsened}**`,
    ``,
    `## Systematic slices (repaired A)`,
    `- Weak-offense home bias (n=${systematic.weakOffenseHomeOverprojection.n}): mean home bias **${systematic.weakOffenseHomeOverprojection.meanHomeBias}**`,
    `- Strong-defense home bias (n=${systematic.strongDefenseHomeBias.n}): mean home bias **${systematic.strongDefenseHomeBias.meanHomeBias}**`,
    ``,
    `_Scores away–home. Research only. No wager promotion._`,
  ].join("\n");
  writeFileSync(`${OUT}/MULTIMODEL-REPORT.md`, md);
  writeFileSync("/opt/cursor/artifacts/cfb-oct17-MULTIMODEL-REPORT.md", md);

  console.log(
    JSON.stringify(
      {
        ok: true,
        closes: closes.length,
        graded: gradedRows.length,
        ungraded: report.reconciliation.ungradedInProgress,
        aggregates: report.aggregates,
        oklahomaRepaired: oklahoma.repaired.fitted,
        currentOnly: inflation.currentOnlyProjection,
      },
      null,
      2
    )
  );
}

main();
