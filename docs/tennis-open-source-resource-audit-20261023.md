# FBIS Tennis — external repository and data-source audit
Date: 2026-10-23 (repository inspections current at review).
Scope: user-submitted open-source resources, plus previously discussed SDV/Sofascore/Sackmann.
Decision: study algorithms and field schemas; do not bulk-copy external match/odds datasets into the production qualification layer.

## Resource-by-resource assessment

| Resource | Source/implementation evidence | Reusable element | Boundary/blocker | FBIS disposition |
|---|---|---|---|---|
| glad94/infotennis | MIT Python scraper of ATP Tour site; ATP tournament results and key statistics, with detailed match data described from Antwerp 2021 onward; 2024 ATP layout changes; some ATP team/doubles exclusions | Match-ID and player-ID parsing, set-wise stats schema, collector test cases | MIT covers code, not ATP website data. ATP Terms prohibit systematic retrieval and betting use without written permission | Study extraction interfaces; DO NOT RUN automated ATP scraping for production |
| hikmatazimzade/tennis-ai | MIT Python/ML project, claims CatBoost accuracy 67.21%, 137 features; repository contains atp_matches_YYYY.csv files and pre-trained model files | Feature catalog, model comparison/cross-validation methodology | Underlying CSV lineage not independently cleared; train/test split and leakage not audited; claimed accuracy does not establish economic edge | Study features only; do not import CSV, trained models or metrics as FBIS evidence |
| thekasser/tennis-wta-atp | Live dashboard and prospective ledger, PIT backtest and feature attribution. data/sources.md explicitly records Sackmann-derived trapezoid features under CC BY-NC-SA 4.0; also Matchstat and Kalshi adapters | Frozen forecast schema, paired per-match Brier/CLV analysis, calibration buckets, price snapshot join discipline | Personal-use architecture; Sackmann-derived composite is restricted; Matchstat and other scraped data rights not cleared. Backtest file notes earlier soft-hindsight leakage | Adopt *ideas* for provenance and paired evaluation; never transplant derived values/data |
| Mriganka-codes/tennis_data | TennisExplorer HTML scraper; public matches.json updated on schedule; code disables TLS hostname and certificate verification (security problem) | Coverage audit concept for lower-tier ATP/WTA/Challenger | No commercial rights demonstrated, player matching by display names, timezone ambiguity, TLS insecure, odds may lack book and capture timestamp | Do not consume as odds/settlement production source; no insecure TLS settings |
| vonapets/tennis-calendar | Manually curated 2026 tournament and market-listing plan with Challenger/ITF emphasis and estimates from past exchange volume | Separate tour/challenger/ITF coverage matrix and calendars | Events and estimated market liquidity are not authoritative fixtures or verified market observations; future estimates uncertain | Optional planning reference only |
| SportsDataverse | Sport-specific public package directory does not document Tennis loader | Other FBIS sports infrastructure patterns | No ATP/WTA canonical history offering established | No Tennis dependency |
| Sofascore | Official FAQ states it does not share API endpoints due to provider agreements, nor supply bookmakers | Research-only field inventory | No authorized third-party commercial stats API | No direct or scraper production dependency |
| Jeff Sackmann / Tennis Abstract | CC BY-NC-SA 4.0 ATP/WTA match datasets and published Elo | Historical research methodology | Noncommercial dataset license; rights do not follow MIT scraper code | Segregate research and prohibit commercial-model authority absent written permission |

## Root cause: a visible GitHub CSV is not an eligible match observation
The exact provenance must be recorded separately for (1) software code, (2) source website, (3) raw observation, (4) derived feature, and (5) market snapshot. Re-encoding, aggregating, or training on restricted data does not independently grant rights to the derived output.

## Priority sequence
1. Inventory FBIS existing official-match coverage per tour / surface / tournament tier, with raw artifact evidence and canonical stable player identities. The WTA official-result reconciliation exists; ATP official result adapter still requires a genuine authorized feed and terms.
2. On a separately audited dataset, reconstruct strictly chronological overall/surface Elo, form, H2H and serve/return measures using only outcomes available at each forecast time. No hindsight features; no mixing ATP/WTA or tiers silently.
3. Publish forecast snapshots BEFORE start with immutable source IDs and timestamps.
4. Attach independently captured bid/ask and sportsbook snapshots only where market rights permit storage. Track executable side/fees/spread/size; closing-price comparison must use the last valid pre-start quote.
5. Grade with independently verified completed sets, reconcile voids/retirements per venue rules, and compare v2/rank/Elo on IDENTICAL matches.
6. Maintain separate 200+ sample minima per tour and explicit positive-economic and calibration criteria; never use repo-reported accuracy as proof.
7. Keep wagers off pending release approval and verified deployment receipts.

## Implementation in PR #1639
- tennisSourceAdmission.js provides an isolated *admission policy helper* to flag restricted/unapproved sources and missing rights fields.
- Unit tests cover restricted labels, data-right requirements and no wager authorization.
- NOTE: This helper is not yet wired into all ingest pipelines or backed by an independently controlled approvals registry. Caller assertions alone are not proof of permission. Existing ingestion cannot be considered rights-cleared just because the helper exists.
- Existing draft work includes immutable challenger grade ledger and official-results-based Elo, plus an ATP result validation contract. Tests/CI, fixture collection, archival and market comparison remain incomplete.
