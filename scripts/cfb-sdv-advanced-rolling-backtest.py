#!/usr/bin/env python3
"""Retrospective non-PIT-certified advanced CFB game-log SVD/Ridge benchmark.

Only metrics from games COMPLETED BEFORE the target kickoff can be used.
SDV historical asset publication clocks are unknown; NO model or bet authority.
"""
from __future__ import annotations
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

K_GRID = (0, 5, 10, 20, 40, 80)
RIDGE_ALPHAS = (10.0, 100.0, 500.0)


def iso(timestamp):
    d = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError("kickoff requires a timezone")
    return d.astimezone(timezone.utc)


def make_retro_rows(records):
    """Construct previous-game rolling means, never the current game's metrics."""
    if not records:
        raise ValueError("No advanced game rows")
    if any(r.get("temporal_class") != "POSTGAME_ONLY" or r.get("can_influence_projection") is not False for r in records):
        raise ValueError("Refuse unclassified/authorized source rows")
    columns = sorted(set().union(*(row["metrics"].keys() for row in records)))
    if not columns:
        raise ValueError("No advanced metrics")
    groups = defaultdict(list)
    for r in records:
        groups[r["game_id"]].append(r)
    games = []
    for game_id, pair in groups.items():
        if len(pair) != 2 or len({r["team_id"] for r in pair}) != 2:
            raise ValueError("Invalid team-game pair " + game_id)
        home = [r for r in pair if r["is_home"] is True]
        away = [r for r in pair if r["is_home"] is False]
        if len(home) != 1 or len(away) != 1:
            raise ValueError("No unique home/away " + game_id)
        h, a = home[0], away[0]
        if h["opponent_id"] != a["team_id"] or a["opponent_id"] != h["team_id"]:
            raise ValueError("Opponent identity mismatch")
        if (h["final_score_for"], h["final_score_against"]) != (a["final_score_against"], a["final_score_for"]):
            raise ValueError("Score pair mismatch")
        if h["kickoff"] != a["kickoff"] or h["season"] != a["season"]:
            raise ValueError("Unequal game kickoff/season")
        games.append((iso(h["kickoff"]), game_id, h, a))
    games.sort(key=lambda row: (row[0], row[1]))
    history = defaultdict(list)
    out = []

    def history_before(team, season, cutoff):
        prior = [r for r in history[team] if r[0] < cutoff and r[1]["season"] <= season]
        current = [r for r in prior if r[1]["season"] == season]
        previous = [r for r in prior if r[1]["season"] == season - 1]
        sample = current[-5:] if current else previous[-5:]
        values = {}
        for name in columns:
            known = [r[1]["metrics"][name] for r in sample if name in r[1]["metrics"]]
            values[name] = float(np.mean(known)) if known else float("nan")
        return values, len(sample)

    i = 0
    while i < len(games):
        j = i + 1
        while j < len(games) and games[j][0] == games[i][0]:
            j += 1
        pending = []
        for kickoff, game_id, h, a in games[i:j]:
            hm, hn = history_before(h["team_id"], h["season"], kickoff)
            am, an = history_before(a["team_id"], a["season"], kickoff)
            out.append({
                "game_id": game_id, "season": h["season"], "week": h["week"],
                "x": [hm[name] for name in columns] + [am[name] for name in columns] + [float(hn), float(an)],
                "margin": h["final_score_for"] - h["final_score_against"],
                "total": h["final_score_for"] + h["final_score_against"],
                "home_prior_games": hn, "away_prior_games": an,
            })
            pending.append((kickoff, h, a))
        for kickoff, h, a in pending:
            history[h["team_id"]].append((kickoff, h))
            history[a["team_id"]].append((kickoff, a))
        i = j
    return out, ["home_" + n for n in columns] + ["away_" + n for n in columns] + ["home_prior_n", "away_prior_n"]


def predict(train, valid, target, k, alpha):
    x_train = np.asarray([r["x"] for r in train], float)
    x_valid = np.asarray([r["x"] for r in valid], float)
    y_train = np.asarray([r[target] for r in train], float)
    steps = [SimpleImputer(strategy="median", keep_empty_features=True), StandardScaler()]
    if k:
        steps.append(TruncatedSVD(n_components=k, random_state=1042, n_iter=5))
    steps.append(Ridge(alpha=alpha))
    model = make_pipeline(*steps)
    model.fit(x_train, y_train)
    return model.predict(x_valid)


def week_block_bootstrap(hold, p_svd, p_ridge, target):
    truth = np.asarray([r[target] for r in hold], float)
    paired = np.abs(truth - p_svd) - np.abs(truth - p_ridge)
    groups = defaultdict(list)
    for i, row in enumerate(hold):
        groups[row["week"]].append(i)
    blocks = list(groups.values())
    rng = np.random.default_rng(42)
    samples = []
    for _ in range(500):
        chosen = rng.integers(0, len(blocks), len(blocks))
        idx = [i for block in chosen for i in blocks[block]]
        samples.append(float(np.mean(paired[idx])))
    return np.quantile(samples, [0.025, 0.975]).tolist()


def evaluate(rows, feature_names):
    if not rows or any(r["season"] < 2021 or r["season"] > 2025 for r in rows):
        raise ValueError("Only completed 2021–2025 historical season games are allowed")
    report = {
        "data_class": "RETROSPECTIVE_PRIOR_GAME_RESEARCH_ONLY",
        "source_publication_pit_certified": False,
        "model_authority": "NONE", "can_authorize_wager": False,
        "game_counts": {str(yr): sum(r["season"] == yr for r in rows) for yr in range(2021, 2026)},
        "num_rolling_feature_columns": len(feature_names),
        "tasks": {},
    }
    for target in ("margin", "total"):
        grid = []
        for k in K_GRID:
            if k >= len(feature_names):
                continue
            for alpha in RIDGE_ALPHAS:
                folds = []
                for yr in (2023, 2024):
                    training = [r for r in rows if r["season"] < yr]
                    validation = [r for r in rows if r["season"] == yr]
                    if not training or not validation:
                        raise ValueError("Missing training/validation cohort")
                    estimate = predict(training, validation, target, k, alpha)
                    folds.append((len(validation), mean_absolute_error([r[target] for r in validation], estimate)))
                grid.append({"k": k, "alpha": alpha,
                             "validation_mae": sum(n * mae for n, mae in folds) / sum(n for n, _ in folds)})
        grid.sort(key=lambda record: (record["validation_mae"], record["k"], record["alpha"]))
        selected = grid[0]
        ridge = min((r for r in grid if r["k"] == 0), key=lambda r: r["validation_mae"])
        training = [r for r in rows if r["season"] < 2025]
        holdout = [r for r in rows if r["season"] == 2025]
        if not holdout:
            raise ValueError("Missing 2025 holdout")
        chosen_predictions = predict(training, holdout, target, selected["k"], selected["alpha"])
        ridge_predictions = predict(training, holdout, target, 0, ridge["alpha"])
        truth = np.asarray([r[target] for r in holdout])
        report["tasks"][target] = {
            "selected": selected, "raw_ridge": ridge,
            "holdout_n": len(holdout),
            "selected_holdout_mae": float(mean_absolute_error(truth, chosen_predictions)),
            "ridge_holdout_mae": float(mean_absolute_error(truth, ridge_predictions)),
            "selected_minus_ridge": float(np.mean(np.abs(truth - chosen_predictions) - np.abs(truth - ridge_predictions))),
            "paired_95pct_week_block_ci": week_block_bootstrap(holdout, chosen_predictions, ridge_predictions, target),
            "grid": grid,
        }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    data = Path(args.input).read_bytes()
    records = [json.loads(line) for line in data.splitlines() if line]
    rows, features = make_retro_rows(records)
    report = evaluate(rows, features)
    report["input_sha256"] = hashlib.sha256(data).hexdigest()
    report["feature_names"] = features
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x") as handle:
        json.dump(report, handle, indent=2)
    print(json.dumps({"classification": report["data_class"],
                      "games": report["game_counts"], "feature_columns": len(features),
                      "margin": report["tasks"]["margin"], "total": report["tasks"]["total"]}))


if __name__ == "__main__":
    main()
