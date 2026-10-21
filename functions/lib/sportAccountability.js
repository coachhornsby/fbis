/**
 * Read-only cross-sport model accountability from real pregame snapshots.
 * Does not simulate outcomes, qualify models or imply economic performance.
 */
import { SPORT_SIM_SPORTS, SPORT_SIM_SPECS } from "./sportSimulationResearch.js";
import { snapshotMarketInformed, snapshotModelId } from "./snapshotLearning.js";

const finite = v => typeof v === "number" && Number.isFinite(v) ? v : null;
const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
const ms = v => typeof v === "string" && v.trim() ? Date.parse(v) : NaN;

function eligible(row) {
  const sport = String(row?.sport || "").toLowerCase();
  if (!SPORT_SIM_SPORTS.includes(sport)) return "UNSUPPORTED_SPORT";
  if (!String(row?.gameId || "").trim() || !String(row?.snapshotId || "").trim()) return "MISSING_IDENTITY";
  if (String(row?.projectionState || "").toUpperCase() === "LEARNING_EXCLUDED") return "EXPLICITLY_EXCLUDED";
  if (snapshotMarketInformed(row)) return "MARKET_IMPLIED";
  const frozen = ms(row?.frozenAt), start = ms(row?.start);
  if (!Number.isFinite(frozen) || !Number.isFinite(start)) return "MISSING_PREGAME_CLOCK";
  if (frozen >= start) return "POST_START_FORECAST";
  if (finite(row?.actualHome) === null || finite(row?.actualAway) === null) return "UNSETTLED";
  if (!Number.isFinite(ms(row?.gradedAt)) || ms(row.gradedAt) < start) return "UNVERIFIED_SETTLEMENT_TIME";
  if (finite(row?.projHome) === null || finite(row?.projAway) === null) return "MISSING_FORECAST";
  return null;
}

function emptySport(sport) {
  const spec = SPORT_SIM_SPECS[sport];
  return {
    sport, unit: spec.unit, marketFamilies: spec.domains, cautions: spec.cautions,
    status: "NO_VERIFIED_PREGAME_OUTCOMES", samples: 0, models: 0,
    scoreMae: null, marginMae: null, marginBias: null, totalMae: null,
    winnerHitRate: null, brier: null, winSamples: 0,
    intervalCoverage50: null, intervalCoverage80: null, intervalCoverage90: null,
    clv: null, roi: null, profitUnits: null, drawdownUnits: null,
    simulationStatus: "NO_VERIFIED_SIMULATION_EVIDENCE",
  };
}
function metrics(rows) {
  const scoreErrors = [], marginErrors = [], totalErrors = [], winHits = [], brier = [];
  for (const r of rows) {
    const dh = r.projHome - r.actualHome, da = r.projAway - r.actualAway;
    scoreErrors.push(Math.abs(dh), Math.abs(da));
    marginErrors.push((r.projHome - r.projAway) - (r.actualHome - r.actualAway));
    totalErrors.push(Math.abs((r.projHome + r.projAway) - (r.actualHome + r.actualAway)));
    const diff = r.actualHome-r.actualAway, pred = r.projHome-r.projAway;
    if (diff !== 0 && pred !== 0) {
      winHits.push(Number(Math.sign(diff) === Math.sign(pred)));
      const p = finite(r.pHomeFinal);
      if (p !== null && p >= 0 && p <= 1 && r.probabilityEvidenceValid !== false) {
        brier.push((p-Number(diff>0))**2);
      }
    }
  }
  return {
    samples: rows.length,
    scoreMae: mean(scoreErrors),
    marginMae: mean(marginErrors.map(Math.abs)),
    marginBias: mean(marginErrors),
    totalMae: mean(totalErrors),
    winnerHitRate: mean(winHits),
    brier: mean(brier),
    winSamples: winHits.length,
    probabilitySamples: brier.length,
    intervalCoverage50: null, intervalCoverage80: null, intervalCoverage90: null,
    clv: null, roi: null, profitUnits: null, drawdownUnits: null,
  };
}
function grouped(rows, fn) {
  const d = new Map();
  for (const row of rows) {
    const k=fn(row);
    if (!d.has(k)) d.set(k, []);
    d.get(k).push(row);
  }
  return d;
}
/** Selection returns only latest strictly pregame snapshot per event + model. */
export function buildSportAccountabilityReport(rows = [], { sport = "all", generatedAt = new Date().toISOString(), windowDays = 14 } = {}) {
  if (!SPORT_SIM_SPORTS.includes(sport) && sport !== "all") throw new Error("UNSUPPORTED_SPORT");
  const rejected={}, latest=new Map(), seen=new Set();
  const ordered=[...rows].sort((a,b)=>String(a?.frozenAt||"").localeCompare(String(b?.frozenAt||"")));
  for (const row of ordered) {
    if (sport !== "all" && String(row?.sport||"").toLowerCase() !== sport) continue;
    const reason = eligible(row);
    if (reason) { rejected[reason]=(rejected[reason]||0)+1; continue; }
    const key=[row.sport,row.gameId,snapshotModelId(row)].join("|").toLowerCase();
    const identity=[key,row.frozenAt].join("|");
    if (seen.has(identity)) { rejected.DUPLICATE_SNAPSHOT=(rejected.DUPLICATE_SNAPSHOT||0)+1;continue; }
    seen.add(identity);
    latest.set(key,{...row, learningModelId:snapshotModelId(row)});
  }
  const selected=[...latest.values()];
  const allSports=SPORT_SIM_SPORTS.map(s=>{
    const group=selected.filter(r=>String(r.sport).toLowerCase()===s);
    if (!group.length) return emptySport(s);
    return {
      ...emptySport(s),
      ...metrics(group),
      models: new Set(group.map(r=>r.learningModelId)).size,
      status: "PREGAME_OUTCOMES_GRADED",
    };
  });
  const cohorts=[...grouped(selected,r=>[r.sport,r.learningModelId].join("|")).entries()]
    .map(([key,group])=>({sport:group[0].sport,modelId:group[0].learningModelId,...metrics(group)}))
    .sort((a,b)=>b.samples-a.samples).slice(0,60);
  const receipts=selected.sort((a,b)=>String(b.gradedAt).localeCompare(String(a.gradedAt)))
    .slice(0,24).map(r=>({
      sport:r.sport, gameId:r.gameId, matchup:r.matchup||null, modelId:r.learningModelId,
      snapshotId:r.snapshotId, frozenAt:r.frozenAt, eventStart:r.start, gradedAt:r.gradedAt,
      projected:[r.projAway,r.projHome], actual:[r.actualAway,r.actualHome],
      marginError:((r.projHome-r.projAway)-(r.actualHome-r.actualAway)),
    }));
  return {
    ok:true, version:"fbis-accountability-v1", generatedAt, sport, windowDays,
    source:"immutable_prediction_snapshots", sourceStatus:"CANONICAL_SPORT_READ_ROUTING",
    sports:sport==="all"?allSports:allSports.filter(s=>s.sport===sport),
    cohorts, receipts, rejectionCounts:rejected,
    eligibleEvents:new Set(selected.map(r=>[r.sport,r.gameId].join("|"))).size,
    eligibleForecasts:selected.length,
    notes:[
      "Recorded final-score grading does not independently verify the upstream official result source.",
      "Observed score metrics are not simulation-range calibration.",
      "Prediction interval coverage requires archived prospective simulation quantiles.",
      "Economic metrics require a separate priced/settled execution ledger.",
      "Sports without verified official outcomes are listed as unavailable, not zero.",
    ],
    governance:{simulationResearchOnly:true,autoPromote:false,autoWagerAuthority:false,dbCutover:false},
  };
}
