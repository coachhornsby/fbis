# NHL qualification status — 2026-10-20

Status: SHADOW ONLY. Engineering hardening does not grant wager promotion. NHL is not production-qualified for wagering or calibrated five-star game ratings.

## Current evidence

Recomputed from `data/models/nhl-pro-v2-validation.json`: 2,624 walk-forward predictions; per-team score MAE 1.38523, total MAE 1.86803, margin MAE 2.14819, moneyline Brier 0.241174, log loss 0.674997, ten-bin ECE 0.034286. Bucket counts, average predicted probabilities and observed win rates are in `artifacts/nhl-production-qualification/audit.json`.

These are the existing historical artifact's results, not a rerun of the changed production scoring kernel. Prior-season fitting and PIT independence are claims of that artifact. Historical profitability is unavailable: no independently verified contemporaneous entry prices or canonical stars accompany these predictions.

Live primary D1 audit: 63 prediction snapshots; no eligible verified NHL-PRO-v2 prospective records; zero NHL wager decisions and zero settlements. Some snapshots were graded before scheduled start. Preserve these records for investigation; exclude them from qualification. The audit stores exclusion counts and original selected snapshot fields. Do not backfill hypothetical decisions or invent settlements to populate an empty ledger.

Five-star GAME and PROP cohorts each have zero eligible settled price records. Win rate, ROI, drawdown and CLV are unknown. Profitability is not established.

## Confidence

Canonical server-side `NHL-GAME-CONFIDENCE-v1` uses independent NHL projection identity, PIT lineage, probability integrity and goalie confirmation. It ignores generic quality, recommendation tiers, prices and raw projection gaps. It reports evidence completeness, not calibrated hit probability. Without a fitted held-out confidence artifact, the head remains explicitly uncalibrated and cannot award five stars. Client code continues to display canonical stars only. Snapshot layers now freeze the canonical confidence result, scoring treatment and goalie evidence for prospective auditing.

No data-quality score or caller-supplied calibration flag can promote the confidence head. Fit confidence on independent training data, validate out of time on the exact deployed projection version, and version the resulting artifact before widening stars.

## Scoring contract

NHL-PRO-v2 and NHL-WAGER-v1 share one bivariate Poisson implementation, using home minus away goal differential for puck lines. Enumeration limits and omitted mass are explicit. Negative home lines require the home team to win by enough goals; away lines mirror the sign. A raw projected-score gap does not form cover probability or EV.

The current goal means are all-situation historical proxies, not separately fitted regulation-only rates. The returned regulation distribution is therefore labeled an approximation. Shared scoring covariance is heuristic.

Tied regulation probability is allocated by an unfitted logistic goal-difference function to a full-game winner including OT/shootout. Shootout attempts do not enter score means. The downstream Elo mixture and 0.86 shrink are heuristic transformations, not empirical calibration. Raw regulation probabilities, raw full-game allocation and transformed full-game probabilities remain separate and sum within rounding tolerances.

Empty-net scoring is implicit in all-situation inputs and historical `empty_net` shot features; there is no validated game-state pulling-goalie hazard model. Do not add another empty-net uplift on top. Starter selection uses PIT confirmation when available; otherwise historical-start proxies. There is no validated starter-probability mixture or uncertainty integration. These limitations block full-game puck-line/total EV and promotion. No new unvalidated OT/SO/empty-net score transformation is activated.

## Wager and evidence gates

PinnOdds remains reference-only with unknown provider quote time, even when receipt time is fresh. Unpriced outcomes are dropped. Missing/stale/unverified prices cannot yield actionable game decisions. Only matching executable paired quotes, explicit full-game settlement scope, independently supported probability calibration and starter evidence can form moneyline economic research. GAME wagers always remain PASS/no qualification/no authorization, including forged caller approvals.

Props require complete valid American prices and complementary probabilities, plus a fresh executable quote matching the exact event, player, market, line and both prices. Full-game player-stat scope includes overtime and excludes shootout attempts. Unverified numeric prices cannot become economic research or qualify. Missing/invalid prices return explicit false candidate/qualification/authorization flags. A research prop cannot qualify without validated settled confidence support (minimum 250 settled observations and populated bins); GAME confidence needs at least 150. Calibration audits also require populated bins, monotonicity, positive ROI, drawdown limits and GAME CLV coverage. Qualification never grants staking authority.

Recorded live confidence audit `nhlc_production_audit_20261020` in `nhl_wager_confidence_runs`: GAME and PROP both NOT_VALIDATED with zero settled observations.

Existing `nhl_wager_decisions`, `nhl_wager_settlements`, `nhl_wager_confidence_runs`, prediction ledger and capture/settle workflows remain the only stores/workflows. Capture cannot archive after start. Settlement requires explicit final status; unresolved results remain pending. CLV requires matching entry bookmaker, paired pregame full-game close observations, and recorded quote provenance. Capture/settle/calibrate modes remain in `/api/nhl-wager-research`; existing hourly GitHub workflow owns wager research. The orchestrator owns goalie shadow scheduling; do not deploy the retired duplicate scheduler.

## Cloudflare

Primary DB, TIER3_DB, MARKET_HISTORY_DB, OPERATIONS_DB, COLD_HISTORY_DB and ARCHIVE bindings were compared with live Pages preview/production and matched. Live Polymarket Worker D1/R2 bindings and PM_STREAM class matched repo; orchestrator R2_ARCHIVE matched. The standalone NHL scheduler is intentionally not deployed. MARKET_HISTORY_DB is near capacity; do not redirect NHL qualification writes away from primary.

Enabled persisted traces at 10% sampling on the live orchestrator, Polymarket stream and soccer backfill Workers. Converted SOCCER_CONTROL_TOKEN and SOCCER_WORKER_TOKEN from live plain-text bindings to secret_text without changing credential values. No secret values are stored in this report. All Worker TOMLs explicitly retain traces; `npm run verify:cloudflare` blocks trace removal, old compatibility dates and credential names in plain-text vars. Pages date advances from 2024-09-23 to 2026-10-01, verified with Functions bundling; Worker dates stay at their tested current versions. Pages does not use the Worker-only observability configuration.

## Release checks and remaining promotion work

Validation: 213 focused NHL/PinnOdds tests passed. The full npm suite passed, as did the app build, Pages Functions bundle, migration verification and Cloudflare static checks.

Run `npm run test:nhl`, `npm run verify:cloudflare`, `npm test`, `npm run build`, and the Pages Functions build. CI now runs the NHL and Cloudflare guard suites.

Run `npm run audit:nhl` to reproduce the report from frozen audit inputs. For a new live audit, export a fresh read-only D1 snapshot and ledger inventory first; the committed input is explicitly dated, not a live feed. Refit/revalidate the exact deployed kernel with PIT-safe regulation goals, goalie uncertainty and OT/SO/empty-net labels; collect genuine prospective frozen predictions and paired contemporaneous market evidence; settle final results; then evaluate confidence and economic cohorts. A separate explicit operator promotion is still required for GAME wagering. No production qualification or profitability claim is authorized by this release.

Full historical model and prop revalidation also passed in GitHub Actions run 39370393722. This reruns the existing historical fitting script; the runtime-kernel limitations above still apply.
