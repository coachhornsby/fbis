#!/usr/bin/env python3
"""
NFL Predictive Lift — Phase A chronological feature ablation.

Governance (hard):
  - Champion remains NFL-PRO-v1.1 (unchanged; research-only outputs)
  - No wagering / qualification gate changes
  - Market prices are evaluation benchmarks only — never model inputs

Design:
  1) Build a stripped CORE (EPA + QB only) as the additive base.
  2) Add success / early-down / explosives / pressure / tracking / context
     individually, then meaningful combinations.
  3) Every challenger is scored on the identical chronological OOS index
     (intersection of all configs; same games / seasons as v1.1 walkforward).
  4) Report paired MAE deltas vs CORE and vs reproduced v1.1, with bootstrap CIs.
  5) Decompose errors by season / spread band / phase; attribute family lift.
  6) Economic metrics (flat −110 ATS on model-vs-close disagreement) are
     reported separately from predictive MAE — never conflated.

Outputs:
  artifacts/nfl-phase-a-ablation/report.json
  artifacts/nfl-phase-a-ablation/oos-predictions.csv
  research/nfl/phase-a-ablation-20261018.json (pinned copy when requested)
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import accuracy_score, mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

# Reuse walkforward primitives by importing the module as a script sibling.
import importlib.util

WF_PATH = Path(__file__).resolve().parent / "nfl-pro-v1-1-walkforward.py"
spec = importlib.util.spec_from_file_location("nfl_wf", WF_PATH)
wf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wf)

DATA = Path("artifacts/nfl/nfl_game_training_2015_2026.csv")
OUT = Path("artifacts/nfl-phase-a-ablation")
OUT.mkdir(parents=True, exist_ok=True)
PIN = Path("research/nfl/phase-a-ablation-20261018.json")
ALPHA = wf.ALPHA
BLEND_GRID = wf.BLEND_GRID
BOOT = 1000
RNG = np.random.default_rng(20261018)

# --- Family feature sets (pregame / lagged columns already in training CSV) ---
EPA_MARGIN = [
    "diff_pregame_season_off_epa_per_play", "diff_pregame_l5_off_epa_per_play",
    "diff_pregame_season_pass_epa_per_play", "diff_pregame_l5_pass_epa_per_play",
    "diff_pregame_season_def_off_epa_per_play", "diff_pregame_l5_def_off_epa_per_play",
    "diff_pregame_season_def_pass_epa_per_play", "diff_pregame_l5_def_pass_epa_per_play",
]
QB_MARGIN = ["diff_pregame_qb_l5_qb_epa_game"]
SUCCESS_MARGIN = [
    "diff_pregame_season_off_success_rate", "diff_pregame_l5_off_success_rate",
]
EARLY_MARGIN = [
    "diff_pregame_season_early_down_epa", "diff_pregame_l5_early_down_epa",
]
PRESSURE_MARGIN = [
    "diff_pregame_season_sack_rate", "diff_pregame_l5_sack_rate",
]
CONTEXT_MARGIN = ["rest_diff"]
EXPLOSIVE_MARGIN = [
    "diff_pregame_season_explosive_rate", "diff_pregame_l5_explosive_rate",
]
TRACKING_MARGIN = [f"diff_{x}" for x in wf.NGS_BASES]

EPA_TOTAL_BASES = [
    "pregame_season_off_epa_per_play", "pregame_l5_off_epa_per_play",
    "pregame_season_def_off_epa_per_play", "pregame_l5_def_off_epa_per_play",
    "pregame_season_pass_epa_per_play", "pregame_l5_pass_epa_per_play",
    "pregame_season_def_pass_epa_per_play", "pregame_l5_def_pass_epa_per_play",
    "pregame_season_neutral_pass_rate", "pregame_l5_neutral_pass_rate",
]
SUCCESS_TOTAL_BASES = ["pregame_season_off_success_rate", "pregame_l5_off_success_rate"]
EXPLOSIVE_TOTAL_BASES = ["pregame_season_explosive_rate", "pregame_l5_explosive_rate"]
TRACKING_TOTAL = [f"sum_{x}" for x in wf.NGS_BASES]
CONTEXT_TOTAL = ["temp", "wind"]


def sum_feats(bases):
    return [f"sum_{b}" for b in bases]


CORE_MARGIN = EPA_MARGIN + QB_MARGIN
CORE_TOTAL = sum_feats(EPA_TOTAL_BASES)

FAMILIES = {
    "success": {"margin": SUCCESS_MARGIN, "total": sum_feats(SUCCESS_TOTAL_BASES)},
    "earlyDown": {"margin": EARLY_MARGIN, "total": []},
    "explosives": {"margin": EXPLOSIVE_MARGIN, "total": sum_feats(EXPLOSIVE_TOTAL_BASES)},
    "pressure": {"margin": PRESSURE_MARGIN, "total": []},  # sack-rate proxy in training CSV
    "tracking": {"margin": TRACKING_MARGIN, "total": TRACKING_TOTAL},
    "context": {"margin": CONTEXT_MARGIN, "total": CONTEXT_TOTAL},
}

# Meaningful combinations (names → family ids)
COMBOS = {
    "core+efficiency": ["success", "earlyDown", "explosives"],
    "core+passRush": ["pressure", "tracking"],
    "v11_reproduced": ["success", "earlyDown", "pressure", "context"],  # explosive only on totals in v11
    "v11+explosives_margin": ["success", "earlyDown", "pressure", "context", "explosives"],
    "v12_like": ["success", "earlyDown", "pressure", "context", "tracking"],
    "full_phase_a": ["success", "earlyDown", "explosives", "pressure", "tracking", "context"],
}


def ensure_columns(d: pd.DataFrame) -> pd.DataFrame:
    """Ensure explosive margin diffs and any missing sum_/diff_ columns exist."""
    for b in ["pregame_season_explosive_rate", "pregame_l5_explosive_rate"]:
        hc, ac = f"home_{b}", f"away_{b}"
        if hc not in d.columns:
            d[hc] = np.nan
        if ac not in d.columns:
            d[ac] = np.nan
        d[f"diff_{b}"] = pd.to_numeric(d[hc], errors="coerce") - pd.to_numeric(d[ac], errors="coerce")
        d[f"sum_{b}"] = pd.to_numeric(d[hc], errors="coerce") + pd.to_numeric(d[ac], errors="coerce")
    needed = set(CORE_MARGIN + CORE_TOTAL)
    for fam in FAMILIES.values():
        needed.update(fam["margin"])
        needed.update(fam["total"])
    for f in needed:
        if f not in d.columns:
            d[f] = np.nan
    return d


def feature_sets_for(family_ids):
    margin = list(CORE_MARGIN)
    total = list(CORE_TOTAL)
    for fid in family_ids:
        fam = FAMILIES[fid]
        for f in fam["margin"]:
            if f not in margin:
                margin.append(f)
        for f in fam["total"]:
            if f not in total:
                total.append(f)
    return margin, total


def metrics(actual_m, pred_m, actual_t, pred_t):
    a_m = np.asarray(actual_m, dtype=float)
    p_m = np.asarray(pred_m, dtype=float)
    a_t = np.asarray(actual_t, dtype=float)
    p_t = np.asarray(pred_t, dtype=float)
    return {
        "n": int(len(a_m)),
        "marginMae": float(mean_absolute_error(a_m, p_m)),
        "totalMae": float(mean_absolute_error(a_t, p_t)),
        "winnerAccuracy": float(accuracy_score(a_m > 0, p_m > 0)),
    }


def paired_delta(base_err, challenger_err):
    """Positive delta => challenger improves (lower abs error)."""
    d = np.asarray(base_err, dtype=float) - np.asarray(challenger_err, dtype=float)
    if len(d) < 2:
        return {"mean": None, "ci95": [None, None]}
    means = np.array([RNG.choice(d, len(d), replace=True).mean() for _ in range(BOOT)])
    return {
        "mean": float(d.mean()),
        "ci95": [float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))],
        "positiveShare": float((d > 0).mean()),
    }


def run_config(d, baseline, name, margin_features, total_features):
    oos, folds, _ = wf.build_oos(d, baseline, margin_features, total_features)
    return {"name": name, "oos": oos, "folds": folds, "marginFeatures": margin_features, "totalFeatures": total_features}


def season_slice_metrics(oos, seasons):
    g = oos[oos.season.isin(seasons)]
    if not len(g):
        return None
    return metrics(g.actual_margin, g.margin, g.actual_total, g.total)


def error_origin_table(d, oos_by_name, anchor="core"):
    """Attribute abs-error reduction vs CORE by family and by game condition."""
    anchor_oos = oos_by_name[anchor]
    ix = anchor_oos.index
    a = d.loc[ix]
    rows = []
    spread = (-pd.to_numeric(a.closing_home_spread, errors="coerce")).abs()
    week = pd.to_numeric(a.week, errors="coerce")
    for name, oos in oos_by_name.items():
        if name == anchor:
            continue
        common = ix.intersection(oos.index)
        if not len(common):
            continue
        base_m = (anchor_oos.loc[common, "actual_margin"] - anchor_oos.loc[common, "margin"]).abs()
        chal_m = (oos.loc[common, "actual_margin"] - oos.loc[common, "margin"]).abs()
        delta = paired_delta(base_m, chal_m)
        # Condition slices
        cond = {}
        for label, mask in {
            "spread_0_3": spread.loc[common].lt(3),
            "spread_3_7": spread.loc[common].ge(3) & spread.loc[common].lt(7),
            "spread_7_plus": spread.loc[common].ge(7),
            "early_season": week.loc[common].le(4),
            "mid_season": week.loc[common].gt(4) & week.loc[common].le(12),
            "late_season": week.loc[common].gt(12),
        }.items():
            m = mask.fillna(False)
            if int(m.sum()) < 30:
                cond[label] = None
                continue
            cond[label] = paired_delta(base_m[m], chal_m[m])
        rows.append({
            "config": name,
            "n": int(len(common)),
            "marginAbsErrorReductionVsCore": delta,
            "byCondition": cond,
        })
    return rows


def economic_flat110(d, oos, label):
    """Predictive≠economic: flat −110 ATS when |model-close| >= 1.0. Research only."""
    ix = oos.index.intersection(d.index)
    a = d.loc[ix]
    p = oos.loc[ix]
    market_m = -pd.to_numeric(a.closing_home_spread, errors="coerce")
    market_t = pd.to_numeric(a.closing_total, errors="coerce")
    edge_m = p["margin"] - market_m
    edge_t = p["total"] - market_t

    def book(edge, actual, market):
        m = edge.abs().ge(1.0) & market.notna() & actual.notna()
        if not m.any():
            return {"n": 0, "wins": 0, "losses": 0, "pushes": 0, "units": None, "roi": None, "hitRate": None}
        side = np.sign(edge[m])
        realized = (actual[m] - market[m]) * side
        wins = int((realized > 0).sum())
        losses = int((realized < 0).sum())
        pushes = int((realized == 0).sum())
        decisions = wins + losses
        units = wins * (100 / 110) - losses
        return {
            "n": int(m.sum()),
            "wins": wins,
            "losses": losses,
            "pushes": pushes,
            "units": float(units) if decisions else None,
            "roi": float(units / decisions) if decisions else None,
            "hitRate": float(wins / decisions) if decisions else None,
            "thresholdAbsEdge": 1.0,
            "pricing": "flat-110-research-only",
        }

    return {
        "config": label,
        "spreads": book(edge_m, a.home_margin, market_m),
        "totals": book(edge_t, a.final_total, market_t),
        "clv": None,
        "note": "Economic metrics are independent of MAE. No wager authority. CLV unavailable without open→close series.",
    }


def calibration_bins(oos, n_bins=10):
    """Simple winner-probability calibration from sigmoid of margin / sigma."""
    # Approximate p(home win) from margin with fixed sigma (~14 from NFL-PRO constants)
    sigma = 14.0
    z = oos["margin"].to_numpy(dtype=float) / sigma
    # logistic
    p = 1.0 / (1.0 + np.exp(-1.7 * z))
    y = (oos["actual_margin"].to_numpy(dtype=float) > 0).astype(float)
    bins = []
    edges = np.linspace(0, 1, n_bins + 1)
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        m = (p >= lo) & (p < hi if i < n_bins - 1 else p <= hi)
        if not m.any():
            continue
        bins.append({
            "bin": f"{lo:.1f}-{hi:.1f}",
            "n": int(m.sum()),
            "avgPredicted": float(p[m].mean()),
            "empRate": float(y[m].mean()),
            "gap": float(p[m].mean() - y[m].mean()),
        })
    return {"sigmaAssumed": sigma, "bins": bins, "note": "Research calibration diagnostic only; not a production confidence claim."}


def main():
    if not DATA.exists():
        raise SystemExit(f"missing training CSV: {DATA}")

    d = wf.prep(pd.read_csv(DATA, low_memory=False))
    d = ensure_columns(d)
    baseline = pd.concat([wf.baseline_for_season(d, s) for s in range(2016, 2027)])

    configs = []
    # CORE
    configs.append(("core", *feature_sets_for([])))
    # Individual adds
    for fid in ["success", "earlyDown", "explosives", "pressure", "tracking", "context"]:
        configs.append((f"core+{fid}", *feature_sets_for([fid])))
    # Combos
    for name, fids in COMBOS.items():
        configs.append((name, *feature_sets_for(fids)))
    # Exact reproduced v1.1 feature lists (pin)
    configs.append(("v11_exact", list(wf.MARGIN_V11), list(wf.TOTAL_V11)))

    results = {}
    oos_by = {}
    for name, margin_f, total_f in configs:
        print(json.dumps({"phase": "fit", "config": name, "nMargin": len(margin_f), "nTotal": len(total_f)}), flush=True)
        packed = run_config(d, baseline, name, margin_f, total_f)
        oos_by[name] = packed["oos"]
        results[name] = packed

    # Identical chronological window
    ix = oos_by["core"].index
    for name, oos in oos_by.items():
        ix = ix.intersection(oos.index)
    # Prefer intersection with exact v11 for reproducibility pin
    ix = ix.intersection(oos_by["v11_exact"].index)

    for name in list(oos_by.keys()):
        oos_by[name] = oos_by[name].loc[ix]

    a = d.loc[ix]
    market_m = -pd.to_numeric(a.closing_home_spread, errors="coerce")
    market_t = pd.to_numeric(a.closing_total, errors="coerce")
    market = metrics(a.home_margin, market_m, a.final_total, market_t)

    summary = {}
    core_oos = oos_by["core"]
    v11_oos = oos_by["v11_exact"]
    for name, oos in oos_by.items():
        m = metrics(oos.actual_margin, oos.margin, oos.actual_total, oos.total)
        base_m_err = (core_oos.actual_margin - core_oos.margin).abs()
        chal_m_err = (oos.actual_margin - oos.margin).abs()
        v11_m_err = (v11_oos.actual_margin - v11_oos.margin).abs()
        summary[name] = {
            **m,
            "nMarginFeatures": len(results[name]["marginFeatures"]),
            "nTotalFeatures": len(results[name]["totalFeatures"]),
            "pairedMarginAbsErrorReductionVsCore": paired_delta(base_m_err, chal_m_err),
            "pairedMarginAbsErrorReductionVsV11": paired_delta(v11_m_err, chal_m_err),
            "deltaMarginMaeVsMarket": m["marginMae"] - market["marginMae"],
            "seasons": {
                "2018_2021": season_slice_metrics(oos, range(2018, 2022)),
                "2022_2024": season_slice_metrics(oos, range(2022, 2025)),
                "2025_2026": season_slice_metrics(oos, [2025, 2026]),
            },
        }

    core_mae = summary["core"]["marginMae"]
    v11_mae = summary["v11_exact"]["marginMae"]
    for name in summary:
        summary[name]["deltaMarginMaeVsCore"] = summary[name]["marginMae"] - core_mae
        summary[name]["deltaMarginMaeVsV11"] = summary[name]["marginMae"] - v11_mae

    origins = error_origin_table(d, oos_by, anchor="core")
    economics = {
        name: economic_flat110(d, oos, name)
        for name in ["core", "v11_exact", "core+success", "core+tracking", "full_phase_a", "v12_like"]
        if name in oos_by
    }
    calibration = {
        name: calibration_bins(oos_by[name])
        for name in ["v11_exact", "full_phase_a"]
        if name in oos_by
    }

    # Ranking by margin MAE (lower better), research-only
    ranked = sorted(
        [{"config": k, "marginMae": v["marginMae"], "totalMae": v["totalMae"], "winnerAccuracy": v["winnerAccuracy"]}
         for k, v in summary.items()],
        key=lambda r: (r["marginMae"], r["totalMae"]),
    )

    ngs_cols = [c for c in d.columns if "ngs" in str(c).lower()]
    tracking_evaluable = len(ngs_cols) > 0 and any(pd.to_numeric(d[c], errors="coerce").notna().any() for c in ngs_cols[:8])

    report = {
        "schema": "nfl-phase-a-ablation-v1",
        "title": "NFL Predictive Lift — Phase A",
        "generatedAt": pd.Timestamp.now("UTC").isoformat(),
        "governance": {
            "productionChampion": "NFL-PRO-v1.1",
            "challengersResearchOnly": True,
            "automaticPromotion": False,
            "canQualify": False,
            "canAuthorizeWager": False,
            "wageringGatesUnchanged": True,
            "marketUsedAsBenchmarkOnly": True,
        },
        "evaluation": {
            "design": "chronological walk-forward ridge alpha=20 with nested blend selection; identical OOS index across configs",
            "ridgeAlpha": ALPHA,
            "nestedBlendSelection": True,
            "primarySampleN": int(len(ix)),
            "startSeason": 2018,
            "endSeason": 2026,
            "identicalChronologicalWindows": True,
            "pressureNote": "Training CSV pressure proxy is sack_rate (no def_qb_hits series in historical matrix).",
        },
        "families": {
            k: {
                "margin": v["margin"],
                "total": v["total"],
                **(
                    {
                        "status": "NOT_EVALUABLE_IN_PINNED_CSV",
                        "reason": "Pinned training CSV has no usable NGS columns; core+tracking collapses to core.",
                    }
                    if k == "tracking" and not tracking_evaluable
                    else {"status": "EVALUATED"}
                ),
            }
            for k, v in FAMILIES.items()
        },
        "dataLimitations": {
            "ngsColumnsPresent": bool(tracking_evaluable),
            "pressureProxy": "sack_rate only",
            "trackingAblation": "deferred until NGS-enriched training rebuild"
            if not tracking_evaluable
            else "evaluated",
            "ngsRebuildPath": "REQUIRE_NGS=1 python scripts/build-nfl-training-dataset.py --require-ngs",
        },
        "configs": summary,
        "rankingByMarginMae": ranked,
        "market": market,
        "errorOriginsVsCore": origins,
        "economicSeparateFromPredictive": economics,
        "calibration": calibration,
        "acceptance": {
            "reproduciblePairedComparison": True,
            "uncertaintyViaBootstrapCI": True,
            "seasonSlicesReported": True,
            "predictiveVsEconomicSeparated": True,
            "promotionEvidencePass": False,
            "note": "A lower MAE does not authorize wagers. Economic tables are diagnostic only.",
        },
        "ariLarDiagnosis": {
            "issue": "source-coverage / team-abbreviation join",
            "detail": "nflverse PBP labels Rams as LA; snapshot key is LAR. Enricher now canon-maps LA→LAR. Not a pipeline redesign.",
        },
    }

    (OUT / "report.json").write_text(json.dumps(report, indent=2))
    PIN.parent.mkdir(parents=True, exist_ok=True)
    PIN.write_text(json.dumps(report, indent=2))

    # Wide OOS table for paired analysis
    wide = pd.DataFrame({"season": a.season, "game_id": a.game_id,
                         "actual_margin": a.home_margin, "actual_total": a.final_total,
                         "market_margin": market_m, "market_total": market_t}, index=ix)
    for name, oos in oos_by.items():
        safe = name.replace("+", "_").replace("-", "_")
        wide[f"{safe}_margin"] = oos["margin"]
        wide[f"{safe}_total"] = oos["total"]
    wide.to_csv(OUT / "oos-predictions.csv", index=False)

    print(json.dumps({
        "ok": True,
        "n": int(len(ix)),
        "v11_marginMae": summary["v11_exact"]["marginMae"],
        "core_marginMae": summary["core"]["marginMae"],
        "market_marginMae": market["marginMae"],
        "best": ranked[0],
        "out": str(OUT / "report.json"),
        "pin": str(PIN),
    }, indent=2))


if __name__ == "__main__":
    main()
