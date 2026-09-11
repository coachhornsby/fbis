#!/usr/bin/env node
/**
 * Eligible-sample selection-bias audit for CFB-FBIS-v2 (2022–2025).
 * Uses frozen snapshot summaries + CFBD game meta. Does not invent provenance.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const snaps = JSON.parse(readFileSync("artifacts/cfb-fbis-v2-snapshot-summaries.json", "utf8"));
const meta = JSON.parse(readFileSync("artifacts/cfb-game-meta-2022-2025.json", "utf8"));
const predsA = JSON.parse(readFileSync("artifacts/cfb-fbis-v2-predictions-all.json", "utf8")).A;
const predById = new Map(predsA.map((p) => [String(p.gameId), p]));

function bump(m, k, pass) {
  m[k] = m[k] || { n: 0, pass: 0 };
  m[k].n += 1;
  if (pass) m[k].pass += 1;
}
function rate(o) {
  const out = {};
  for (const [k, v] of Object.entries(o).sort((a, b) => a[0].localeCompare(b[0]))) {
    out[k] = { n: v.n, pass_n: v.pass, pass_rate: v.n ? v.pass / v.n : null };
  }
  return out;
}
function topRate(o, n = 40) {
  return Object.fromEntries(Object.entries(rate(o)).sort((a, b) => b[1].n - a[1].n).slice(0, n));
}
function matchupType(hc, ac) {
  const h = String(hc || "unknown").toLowerCase();
  const a = String(ac || "unknown").toLowerCase();
  if (h === "fbs" && a === "fbs") return "FBS-FBS";
  if ((h === "fbs" && a === "fcs") || (h === "fcs" && a === "fbs")) return "FBS-FCS";
  if (h === "fcs" && a === "fcs") return "FCS-FCS";
  if (h === "fbs" || a === "fbs") return "FBS-other";
  if (h === "fcs" || a === "fcs") return "FCS-other";
  if (h === "ii" || a === "ii" || h === "iii" || a === "iii") return "D2/D3";
  return "other/unknown";
}
function weekBucket(week) {
  const w = Number(week);
  if (!Number.isFinite(w)) return "unknown";
  if (w <= 4) return "early_W1-4";
  if (w <= 9) return "mid_W5-9";
  if (w <= 12) return "late_W10-12";
  return "late_W13+";
}
function weeks(season, ws) {
  let n = 0;
  let p = 0;
  for (const s of snaps) {
    if (Number(s.season) === Number(season) && ws.includes(Number(s.week))) {
      n += 1;
      if (s.provenancePass) p += 1;
    }
  }
  return { n, pass_n: p, pass_rate: n ? p / n : null };
}

const bySeason = {};
const byWeek = {};
const bySeasonWeek = {};
const byClass = {};
const byMatchup = {};
const byConf = {};
const byConfHome = {};
const byVenue = {};
const bySeasonType = {};
const byWeekBucket = {};
const byScoring = {};
const byStrengthHome = {};
const byStrengthAway = {};
const byFavEval = {};
const byTotEval = {};
const rejectPattern = {};
const rejectBySeason = {};
const rejectByMatchup = {};
let joinHit = 0;
let joinMiss = 0;
let passN = 0;

for (const s of snaps) {
  const gid = String(s.game_id);
  const m = meta[gid];
  const pass = Boolean(s.provenancePass);
  if (pass) passN += 1;
  if (m) joinHit += 1;
  else joinMiss += 1;

  const season = String(s.season);
  const week = String(s.week);
  bump(bySeason, season, pass);
  bump(byWeek, week, pass);
  bump(bySeasonWeek, `${season}-W${week.padStart(2, "0")}`, pass);
  bump(byWeekBucket, `${season}:${weekBucket(s.week)}`, pass);

  const hc = m?.homeClassification ?? null;
  const ac = m?.awayClassification ?? null;
  bump(byClass, `${String(hc).toLowerCase()}|${String(ac).toLowerCase()}`, pass);
  const mt = matchupType(hc, ac);
  bump(byMatchup, mt, pass);
  bump(byConf, `${m?.homeConference || "?"}|${m?.awayConference || "?"}`, pass);
  bump(byConfHome, m?.homeConference || "?", pass);
  bump(byVenue, m?.neutralSite ? "neutral" : "home", pass);
  const st = String(m?.seasonType || "regular").toLowerCase();
  bump(bySeasonType, st.includes("post") ? "postseason" : "regular", pass);

  if (m?.homePoints != null && m?.awayPoints != null) {
    const tot = Number(m.homePoints) + Number(m.awayPoints);
    const bucket =
      tot < 40 ? "actual_total_<40" : tot < 55 ? "actual_total_40_54" : tot < 70 ? "actual_total_55_69" : "actual_total_70+";
    bump(byScoring, bucket, pass);
  }

  const missH = s.missingness?.home || {};
  const missA = s.missingness?.away || {};
  const homeStrengthKnown = missH.sp === false || missH.srs === false || missH.elo === false;
  const awayStrengthKnown = missA.sp === false || missA.srs === false || missA.elo === false;
  bump(byStrengthHome, homeStrengthKnown ? "home_strength_present" : "home_strength_absent", pass);
  bump(byStrengthAway, awayStrengthKnown ? "away_strength_present" : "away_strength_absent", pass);

  const pred = predById.get(gid);
  if (pred?.closingSpread != null) {
    const cs = Number(pred.closingSpread);
    bump(byFavEval, cs < 0 ? "market_home_fav" : cs > 0 ? "market_away_fav" : "market_pickem", pass);
  } else if (pred?.actualHome != null && pred?.actualAway != null) {
    const am = Number(pred.actualHome) - Number(pred.actualAway);
    bump(
      byFavEval,
      am > 0 ? "proxy_actual_home_won_EVAL_ONLY" : am < 0 ? "proxy_actual_away_won_EVAL_ONLY" : "proxy_actual_tie_EVAL_ONLY",
      pass
    );
  }
  if (pred?.closingTotal != null) {
    const t = Number(pred.closingTotal);
    bump(
      byTotEval,
      t < 45 ? "market_total_<45" : t < 55 ? "market_total_45_54" : t < 65 ? "market_total_55_64" : "market_total_65+",
      pass
    );
  }

  if (!pass) {
    const hp = s.priorOk?.home === true;
    const ap = s.priorOk?.away === true;
    const pat =
      hp && ap ? "priors_ok_other_fail" : hp && !ap ? "away_prior_missing" : !hp && ap ? "home_prior_missing" : "both_prior_missing";
    bump(rejectPattern, pat, false);
    rejectBySeason[season] = rejectBySeason[season] || {};
    bump(rejectBySeason[season], pat, false);
    rejectByMatchup[mt] = rejectByMatchup[mt] || {};
    bump(rejectByMatchup[mt], pat, false);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  audit: "cfb-v2-eligible-sample-selection-bias",
  universe: {
    snapshots: snaps.length,
    metaJoinHit: joinHit,
    metaJoinMiss: joinMiss,
    pass_n: passN,
    pass_rate: snaps.length ? passN / snaps.length : null,
  },
  bySeason: rate(bySeason),
  byWeek: rate(byWeek),
  bySeasonWeek: rate(bySeasonWeek),
  byWeekBucket: rate(byWeekBucket),
  byClassificationPair: topRate(byClass, 30),
  byMatchupType: rate(byMatchup),
  byHomeConference_top30: topRate(byConfHome, 30),
  byConferencePair_top40: topRate(byConf, 40),
  byVenue: rate(byVenue),
  bySeasonType: rate(bySeasonType),
  scoringEnvironment_actualTotals: rate(byScoring),
  teamStrengthAvailability: { home: rate(byStrengthHome), away: rate(byStrengthAway) },
  marketFavoriteBucket_evaluationMetadataOnly: rate(byFavEval),
  marketTotalBucket_evaluationMetadataOnly: rate(byTotEval),
  rejectPatterns: rate(rejectPattern),
  rejectPatternsBySeason: Object.fromEntries(Object.entries(rejectBySeason).map(([s, v]) => [s, rate(v)])),
  rejectPatternsByMatchup: Object.fromEntries(Object.entries(rejectByMatchup).map(([s, v]) => [s, rate(v)])),
  why2022Low: {
    headline:
      "2022 passes 724/3657 (19.8%) while 2023–2025 pass ≈41% because the prior catalog for 2022 games is the 2021 ratings freeze, and CFBD 2021 SRS/SP+/FPI/Elo cover FBS-only (~130 schools), whereas 2022+ SRS expands to ~261 (FBS+FCS).",
    evidence: {
      cfbd_srs_2021_n: 130,
      cfbd_srs_2022_n: 261,
      cfbd_talent_2021_n: 224,
      cfbd_sp_2021_n: 131,
      priorCatalogSchoolUnion: "sp ∪ fpi ∪ srs ∪ elo ∪ core — talent/recruiting keys are NOT unioned into school set",
      dominantReject: "both_prior_missing (side absent from 2021 rating freeze → fail-closed missing-source-provenance)",
      fbsFbsPass: rate(byMatchup)["FBS-FBS"],
      fbsFcsPass: rate(byMatchup)["FBS-FCS"],
      fcsFcsPass: rate(byMatchup)["FCS-FCS"],
      d2d3Pass: rate(byMatchup)["D2/D3"],
      week2022_W1_11: weeks(2022, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
      week2022_W12_15: weeks(2022, [12, 13, 14, 15]),
      lateSeasonNote:
        "2022 W12–15 pass rate rises because the slate densifies toward FBS–FBS (and FCS sides that appear in denser late catalogs), not because provenance rules loosened.",
    },
    legitimateRepairsFromExistingRawMetadata: [
      {
        repair: "Union /talent (and optionally /recruiting/teams) school keys into buildPriorCatalog schools Set",
        effect:
          "Schools with real prior-season talent/recruiting rows but no SRS/SP/FPI/Elo row would receive catalog entries with explicit sourceSeason=priorYear",
        inventsProvenance: false,
        appliedInThisFit: false,
      },
      {
        repair: "Do not back-copy 2022 SRS onto 2021 for missing FCS priors",
        inventsProvenance: true,
        appliedInThisFit: false,
      },
      {
        repair: "Do not default missing sourceSeason to expectedPriorSeason",
        inventsProvenance: true,
        appliedInThisFit: false,
        alreadyForbidden: true,
      },
    ],
    selectionBiasImplication:
      "Fitting universe ≈ prior-catalog-complete games (near-all FBS–FBS; some FCS sides when prior SRS rows exist). 2022 eligible N is thinner and late-season skewed. OOS metrics generalize to that universe, not the full CFB/D2/D3 population.",
  },
  marketLinesNote:
    "Backfill predictions currently have null closingSpread/closingTotal. Calibration fetches /lines as evaluation-only metadata and never as model input.",
};

const body = JSON.stringify(report, null, 2);
mkdirSync("data/cfbd/calibration", { recursive: true });
writeFileSync("artifacts/cfb-v2-coverage-selection-bias.json", body);
writeFileSync("data/cfbd/calibration/coverage-selection-bias.json", body);
const hash = createHash("sha256").update(body).digest("hex");
writeFileSync("data/cfbd/calibration/coverage-selection-bias.sha256", `${hash}  coverage-selection-bias.json\n`);
console.log(
  JSON.stringify(
    {
      ok: true,
      pass_n: passN,
      pass_rate: report.universe.pass_rate,
      byMatchup: report.byMatchupType,
      reject: report.rejectPatterns,
      why2022: {
        early: report.why2022Low.evidence.week2022_W1_11,
        late: report.why2022Low.evidence.week2022_W12_15,
        fbsFbs: report.why2022Low.evidence.fbsFbsPass,
        fcsFcs: report.why2022Low.evidence.fcsFcsPass,
      },
      hash,
    },
    null,
    2
  )
);
