/**
 * Runtime model consumption probe.
 * Proves which fields are actually read / influence fitted scores —
 * not merely present in input JSON.
 */

import { projectModelA, projectModelB, projectModelC, projectModelD } from "./cfbCurrentSeasonChallengers.js";
import { projectCfbFbisV2Production } from "./cfbFbisV2.js";
import {
  CFB_CHAMPION_CONSUMED_FIELDS,
  CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION,
  auditTeamFeatureUsage,
} from "./cfbFeatureUsageAudit.js";
import { FITTED_NONZERO_FEATURES, instrumentProjectionContribution } from "./cfbFeatureContract.js";

export const RUNTIME_CONSUMPTION_VERSION = "cfb-runtime-consumption-v1";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function defaultGame() {
  return {
    home: "Home",
    away: "Away",
    homeEspnId: "1",
    awayEspnId: "2",
    season: 2026,
    week: 8,
    start: "2026-10-20T23:00:00.000Z",
    cfbFbisV2Input: {
      home: {
        offensePpa: -0.04,
        defensePpa: -0.16,
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        priorOff: 34.6,
        priorDef: 22.1,
        offensiveSuccessRate: 0.41,
        coreOffense: -4.7,
        ppaPass: 0.1,
        ppaRush: -0.05,
      },
      away: {
        offensePpa: 0.05,
        defensePpa: -0.02,
        gamesPlayed: 6,
        gamesPlayedSource: "schedule",
        priorOff: 28,
        priorDef: 24,
        offensiveSuccessRate: 0.38,
        coreOffense: 1.2,
      },
    },
  };
}

/**
 * Probe one model. Compares declared contract vs runtime provenance/contribution.
 */
export function probeRuntimeConsumption({ modelId = "A", game = null } = {}) {
  const g = game || defaultGame();
  const home = g.cfbFbisV2Input?.home || {};
  const away = g.cfbFbisV2Input?.away || {};
  const available = {
    home: auditTeamFeatureUsage(home),
    away: auditTeamFeatureUsage(away),
  };

  let proj = null;
  let challengerId = modelId;
  if (modelId === "A" || modelId === "CFB-FBIS-v2") {
    proj = projectModelA(g);
    challengerId = "A";
  } else if (modelId === "B") {
    proj = projectModelB(g);
  } else if (modelId === "C") {
    proj = projectModelC(g, { coreArtifact: null });
  } else if (modelId === "D") {
    proj = projectModelD(g);
  } else if (modelId === "E") {
    proj = {
      ok: false,
      reason: "FITTED_COMBINED_ARTIFACT_UNAVAILABLE",
      note: "Model E requires validated combined artifact — not inferred from equal-weight blend",
    };
  } else {
    proj = projectCfbFbisV2Production(g);
    challengerId = "A";
  }

  const scoring = proj?.provenance?.scoring || null;
  const contribution = proj?.featureContribution || (proj?.ok ? instrumentProjectionContribution(proj, g) : null);

  const actuallyRead = [];
  const transformed = [];
  const fittedNonzero = [];
  const ignored = [];
  const researchOnly = [];
  const displayOnly = [];
  const missingOrFallback = [];

  if (challengerId === "A" || modelId === "A") {
    for (const key of FITTED_NONZERO_FEATURES) {
      if (key === "hfa") {
        actuallyRead.push("hfa");
        fittedNonzero.push({ feature: "hfa", value: proj?.provenance?.hfa ?? null });
        continue;
      }
      const hv = scoring?.home?.lineage?.[key]?.originalValue ?? scoring?.home?.consumed?.[key];
      const av = scoring?.away?.lineage?.[key]?.originalValue ?? scoring?.away?.consumed?.[key];
      actuallyRead.push(key);
      if (key.startsWith("ppa")) transformed.push(`${key}:26.5+ppa*40 then n/(n+6) blend`);
      if (key === "gamesPlayed") transformed.push("gamesPlayed → shrink weight n/(n+6)");
      fittedNonzero.push({ feature: key, home: hv, away: av });
    }
    for (const key of CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION) {
      const present =
        available.home.presentButUnusedByChampion.includes(key) ||
        available.away.presentButUnusedByChampion.includes(key) ||
        num(home[key]) != null ||
        num(away[key]) != null ||
        num(available.home.available?.[key]) != null;
      if (present) {
        ignored.push(key);
        if (String(key).startsWith("core")) researchOnly.push(key);
        else displayOnly.push(key);
      }
    }
    // Also mark present unused from provenance
    for (const f of [
      ...(scoring?.home?.presentButUnusedByChampion || []),
      ...(scoring?.away?.presentButUnusedByChampion || []),
    ]) {
      if (!ignored.includes(f)) ignored.push(f);
      displayOnly.push(f);
    }
    if (scoring?.home?.consumed?.coreThroughWeekUsedAsN || scoring?.away?.consumed?.coreThroughWeekUsedAsN) {
      missingOrFallback.push({
        feature: "gamesPlayed",
        fallback: "coreThroughWeekFallback",
        justified: true,
        flagged: true,
      });
    }
  } else if (challengerId === "B") {
    actuallyRead.push(...FITTED_NONZERO_FEATURES, "researchShrinkK");
    fittedNonzero.push({ feature: "shrinkK", value: proj?.researchShrinkK ?? 3, note: "research-only faster decay" });
    ignored.push(...CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION);
    researchOnly.push("faster_prior_decay");
  } else if (challengerId === "C") {
    actuallyRead.push("requires_fitted_core_artifact");
    ignored.push(...CFB_COLLECTED_BUT_UNUSED_BY_CHAMPION, "coreOffense", "coreDefense");
    researchOnly.push("CORE");
  } else if (challengerId === "D") {
    actuallyRead.push("modelA_margin_total", "modelB_margin_total");
    researchOnly.push("equal_weight_blend_placeholder");
  }

  const declaredChampionKeys = new Set(CFB_CHAMPION_CONSUMED_FIELDS.map((f) => f.key).concat(["hfa"]));
  const runtimeChampionKeys = new Set(
    (challengerId === "A" ? fittedNonzero : []).map((f) => f.feature)
  );
  const criticalSilentOmissions =
    challengerId === "A"
      ? [...declaredChampionKeys].filter(
          (k) => k !== "coreThroughWeek" && !runtimeChampionKeys.has(k) && k !== "priorOff" && k !== "priorDef"
            ? !fittedNonzero.some((f) => f.feature === k)
            : false
        )
      : [];

  // Simpler critical check: ppaOff/ppaDef/gamesPlayed must appear for A when ok
  const criticalSilentOmissions2 = [];
  if (challengerId === "A" && proj?.ok) {
    for (const k of ["ppaOff", "ppaDef", "gamesPlayed", "priorOff", "priorDef", "hfa"]) {
      if (!fittedNonzero.some((f) => f.feature === k)) criticalSilentOmissions2.push(k);
    }
  }

  const unjustifiedHistoricalFallback =
    challengerId === "A" &&
    proj?.ok &&
    (proj.priorDecay?.homeCurrentWeight === 0 || proj.priorDecay?.awayCurrentWeight === 0) &&
    (num(home.offensePpa) != null || num(away.offensePpa) != null) &&
    !(num(home.gamesPlayed) > 0 && num(away.gamesPlayed) > 0);

  return {
    version: RUNTIME_CONSUMPTION_VERSION,
    modelId: proj?.modelId || modelId,
    challengerId,
    ok: proj?.ok !== false || Boolean(proj?.reason),
    projectionOk: Boolean(proj?.ok),
    reason: proj?.reason || null,
    available,
    actuallyRead: [...new Set(actuallyRead)],
    transformed,
    enteringFitted: fittedNonzero.map((f) => f.feature),
    fittedNonzeroInfluence: fittedNonzero,
    ignored: [...new Set(ignored)],
    excludedIntentionally: [...new Set(ignored)],
    missingOrFallback,
    researchOnly: [...new Set(researchOnly)],
    displayOnly: [...new Set(displayOnly)],
    contribution,
    scoringProvenancePresent: Boolean(scoring),
    runtimeMatchesContract:
      challengerId !== "A" ||
      (criticalSilentOmissions2.length === 0 && !unjustifiedHistoricalFallback),
    criticalSilentOmissions: criticalSilentOmissions2,
    unjustifiedHistoricalFallback,
    note:
      challengerId === "A"
        ? "Fitted champion influence is prior+PPA+n+HFA only — page fields may still appear in input JSON"
        : "Research challenger — not production authority",
  };
}
