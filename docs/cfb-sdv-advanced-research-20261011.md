# CFB advanced SDV historical acquisition — isolated research

## Scope
- **2021–2025** five-season acquisition only. Source: public, versioned [SportsDataverse releases](https://github.com/sportsdataverse/sportsdataverse-data).
- `cfb_schedules` / `cfb_schedules_{year}.csv.gz`: unified season-specific fixture metadata with historical FBS/FCS division; require **completed FBS versus FBS** and canonical numeric ESPN IDs.
- `espn_cfb_adv_team_gamelog` / `adv_team_gamelog_{year}.csv`: game-side advanced EPA, efficiency, pace, special-teams and situational numeric metrics.
- Exact canonical joins: season + ESPN game/team/opponent IDs, role/home-away and final-score agreement; reject FCS, duplicates and inconsistent pairs.
- Preserve release CSV bytes with SHA-256 receipt, response metadata, current retrieval URL and complete per-season counts. The source data is not rewritten.
- Read-only GH Actions research artifact only; **no deployment**, **no D1 writes**, **no autonomous retraining**, **no changes to betting authority**.

## Critical timing distinction
These releases were downloaded **retrospectively**. They contain final-game statistics and their current publication/refresh timestamp, **not the original point-in-time availability timestamp before the historical next kickoff**. Therefore:
- `pit_certified=false`, `original_publication_verified=false`, `can_influence_projection=false`, `can_authorize_wager=false`.
- Do **not** feed an advanced row from game G into a feature vector for G itself.
- Candidate next-game rolling summaries can be explored **offline**, but are not PIT-certified until dated original publication receipts are separately available.
- The requested 788 columns remain a **hypothesis**, not an audited schema. Record actual numeric feature counts/missingness by season.
- Do not call current-release season totals a historical pregame snapshot.
- 2025 is the untouched holdout for downstream model selection. Compare Ridge / ElasticNet / domain-subset / SVD against the same games and frozen incumbent values only when valid.

## Running
On branch `engineering/cfb-sdv-advanced-historical-20261011`, the one-shot *push* workflow captures the 10 current release assets, validates season coverage, and uploads a retention-limited artifact containing `raw/*.asset` (original gzip/CSV bytes), `manifest.json`, `advanced_numeric_catalog.json`, and `advanced_team_game_final.jsonl`.

Local test (no network): `python -m unittest discover -s test -p test_cfb_sdv_historical_collect.py -v`.

Manual only (no recurring cost): `python scripts/cfb-sdv-historical-collect.py --years 2021 2022 2023 2024 2025 --out /tmp/cfb-sdv-run-<unique-id>`.

## Acceptance gates
1. Exact-head GitHub Actions run succeeds and uploads verifiable release hashes for all 10 assets.
2. For each season verify FBS game-pair coverage and audit mismatches; no silent identity conflation.
3. Assess authentic advanced metric list and null rates, unusual values, publication clock and late revisions.
4. Download archived research artifact; independently verify its SHA receipts, game counts and PIT flags.
5. Only then design **retrospective** shift-to-next-game SVD challenger evaluation; no model promotion absent temporal/economic evidence.

## Agents
ChatGPT is implementation owner for this isolated CFB acquisition branch. Gemini Spark is second-party verifier; do not edit this branch concurrently or replicate full history in a different crawler. This collector is independent of Soccer/Tennis and PR #963's CFB prospective shadow capture.
