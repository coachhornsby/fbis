# Statcast model feature capture

This phase freezes descriptive operands for model research. It does not complete league benchmark ingestion, physical SSW estimation, xRA, historical game/pitch backfill, probability-model training, or model promotion.

## Implemented

The existing 30-team daily Statcast workflow now follows successful source collection with authenticated feature capture. `/api/mlb-model-features` accepts only exact player ID and role. The server supplies capture time and reads verified archived sources itself. It refuses missing season packets, future acquisitions, identity mismatches and changed hashes. Features retain 30/90/365-day windows, hand splits, pitch arsenal and measured denominators. Game-day records are excluded conservatively; same-day doubleheader information is therefore not used. Regular season and postseason are combined within the competitive windows, not substituted for the profile's postseason Last 5.

Immutable R2 objects under `models/mlb/features/v1/` preserve source hashes, acquisition times, calculation version and snapshot time. A daily job's feature receipt is retained with collection artifacts. An empty valid source remains an empty sample, not a projection.

`node scripts/mlb-model-feature-evaluate.mjs paired-predictions.json` compares paired binary probabilities using Brier score and log loss by market, season, game scope and exact model versions. Each record requires contract ID, feature hash, feature capture time, prediction capture time, game start, settlement time, outcome, and champion/challenger probabilities. Duplicate contracts, post-start predictions and future features reject. This is a scorer, not an immutable-receipt verifier, fit engine, calibration test or promotion decision.

## Recommended modeling sequence

1. Build per-PA K, walk and contact distributions conditional on batter/pitcher hand and starter pitch-family usage. Use measured whiff, chase and zone rates. Fit sample shrinkage and recency decay using training folds; do not select constants from test results.
2. Estimate contact outcomes from exit velocity, launch angle, barrel frequency and expected-contact fields. xwOBA on contact is a contact summary, not HR probability or full-PA xwOBA. Fit explicit hit, total-base and HR heads with their respective outcomes.
3. Model opportunity separately: confirmed lineup, batting slot, projected PAs, starter workload, bullpen exposure, park and weather. Never multiply a rate by assumed playing time without reporting the assumption.
4. Use archived immutable snapshots available before first pitch for prospective evaluation. Recently downloaded historical archives can support retrospective training but cannot prove historical availability.
5. Compare expanding chronological training folds to later games and a separately frozen final holdout. Report calibration, Brier/log loss, count-distribution accuracy, and net return after actual spreads/fees by market and regular/postseason cohort. Evaluate model versions on identical contracts.
6. Shadow the candidate against the existing champion. Promotion requires adequate independent samples, stable calibration and an economic comparison using executable quotes. No enhanced projection or new stars follow from this phase alone.

## Outstanding dependencies

League benchmarks need a deduplicated league-wide corpus; current-roster samples are survivor-biased and must not be labeled league averages. SSW needs a validated physical model and compatible measured fields. xRA needs a defined expected-run target and validation. Scheduled feature capture must be verified after deployment before claiming prospective coverage. No historical records are retroactively relabeled pregame snapshots.
