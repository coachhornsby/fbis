# FBIS Operating Map — Agents, Schedules, Sport Responsibilities
Status: RESEARCHED DRAFT — live sources supersede the schedule snapshot below.
Owner: FBIS shared platform operations. Approval: independent repair-verification protocol.
Last source inspection: 2026-10-11 UTC. This document is not a deployed scheduler, distributed lock, or authoritative live-health snapshot.

## Core purpose and source-of-truth hierarchy
FBIS is an evidence-based, multi-sport forecasting and betting research/operations platform:
source -> verified identity -> time-stamped D1/R2 evidence -> sport-specific state/features -> immutable PIT pregame projection -> contemporaneous market comparison -> official outcome/settlement -> prospective calibration/economic grading -> independently qualified challenger.
- Operational truth: live Cloudflare D1 and `/api/ops-health` plus actual GitHub runs and Pages/Worker deploys, not green CI alone.
- Work ownership/acknowledgment: **Sports Betting Tracker** spreadsheet ID `1B1IVONVvmP50JPCqb64fzEsSaTv6AuHQ04YqEzBhjAo`, tabs `FBIS Incident Ledger` and `FBIS Operator Handoff`. Sheet handoffs alone are **not atomic locks**.
- Source contracts: GitHub `coachhornsby/fbis` main and qualifying approved production migrations.
- CFB/CBB/NFL/etc are **logical sport buckets**, not proof of separate physical databases. Verified shared production D1 binding is `DB -> fbis`; production R2 is `ARCHIVE -> fbis-archive` (see `wrangler.toml`).
- Data and models are separate from markets. Independent model projections come first; Heritage is user execution reference, Pinnacle is benchmark, third-party feeds retain provenance. Do not fabricate lines, timestamps, injury observations, CLV or profit.
- Preserve all immutable PIT, real-time odds, model versions, settlements, historical audits and recovery checkpoints. Promotion and wager authority require separate established gates and operator approval.

## Sport responsibility map — intended domain and evidence to monitor

| Domain | Intended intelligence / modeling job | Operational evidence and authority cautions |
| --- | --- | --- |
| **CFB** | FBS team/player directory, every-final postgame state, opponent-adjusted rating, scores/spread/total/winner and future PIT projections | D1 college ledgers, source manifests, R2 `canonical/cfb/`, Team Cards, final-game completeness; migration 0098/0099 and player research staging must clear recovery/governance gates |
| **CBB** | 362-team season-aware directory, roster/player state, game stats, adjusted efficiency, matchup forecasts, shadow challenger qualification | D1 `cbb_*`, schedule/state snapshots; CBBD quota and PIT gates; separate research challenger from incumbent |
| **NFL** | Weekly team/player/availability context, QB/personnel, game spread/total/winner, supported player props | Official starts/status, observed odds, immutable projections and official terminal results; do not infer unavailable starters |
| **NBA** | Team/player profiles, injury/rotation context, game and prop estimates, prospective shadow trials | D1 `nba_*`; pre-tip timestamp gate is mandatory; post-tip shadow rows are never prospective qualifying evidence |
| **WNBA** | Player impact, lineups/possession evidence, game/player research, prospective validation | D1 `wnba_*` + R2 `research/wnba/` and `models/wnba/`; preserve possession/ablation provenance |
| **MLB** | Full game / first-five-inning expected scores, starter impacts, pitcher K and prop forecasts, prospective performance | D1 `mlb_*`, sharp/current quotes, pitcher identity and official box scores; large projection/evidence payloads merit storage audit |
| **NHL** | Goalie availability and player role, hockey game and prop models, research-only goalie probability shadow | `NHL-PRO-v2` incumbent vs `NHL-GOALIE-PROB-SHADOW-v1`; strict pregame evidence, no auto-promotion |
| **Soccer** | League-specific match state, 1X2/Asian handicap/totals, v2 incumbent and market-family v3 challengers | `soccer_*`, PitchAPI collector, league-by-league PIT validation; never treat one global v3 as authorized |
| **Tennis** | ATP/WTA/Challenger match histories, surface, serve-return and player form, match outcome/market models | R2 `tennis/canonical/current/full/latest`, manifest/refresh-health, D1 tennis state; currently research `bet:false` gates where designated |
| **NPB/KBO** | Japanese/Korean baseball schedules and official box scores, team/starter context, F5 and K research | League-local dates, official starter confirmation, terminal-only grading; never parse scheduled start time as a score |
| **Shared platform** | Canonical IDs, source/provider ingestion, market captures, snapshots, model registry, prospective grade/CLV, bet settlement, board/API, GitHub CI, Cloudflare D1/R2, compliance and cost controls | Stable incident ID, owner, deployment SHA, D1/R2 data proof, Sheets reconciliation and cost attribution; no sport can privately change another sport's champion or shared authority |

These are the functions each bucket *must serve*, not claims that all are currently implemented, healthy, fully backfilled, or economically qualified. Verify current state before operating.

## Observed schedule inventory (UTC; must be refreshed from sources)

| Scheduling plane / component | Observed cadence / expression | Action / scope | Authoritative configuration |
| --- | --- | --- | --- |
| ChatGPT FBIS CI Auto-Repair task | hourly, exact task schedule | Incident implementer by default; verify assigned Gemini fixes; review sport resource health | ChatGPT task manager; **not visible to Gemini through Cloudflare** unless mirrored |
| Gemini Spark scheduler | **UNKNOWN — Gemini must publish run schedule and capabilities** | Independent verifier by default; implement only after explicit handoff | Gemini scheduler/execution environment; cannot infer it from a pasted report |
| Cloudflare `fbis-orchestrator` | `*/10 * * * *`; `7 * * * *`; `17 * * * *`; `27,57 * * * *`; `37 * * * *` | Shared orchestrator schedules; role/trigger per expression must be confirmed from source, not assumed | Live Cloudflare Worker cron triggers |
| GitHub Tennis canonical | `17 * * * *`; `51 * * * *`; `47 2,8,14,20 * * *`; `53 3,9,15,21 * * *` | Current refresh and current backstop; full refresh and full backstop. Concurrency group `tennis-canonical-refresh` | `.github/workflows/tennis-refresh.yml` |
| GitHub hourly bet settlement | `17 * * * *` | Trusted finals, prop grading, D1->Sheet bet/prop reconciliation. Concurrency group `hourly-bet-settlement` | `.github/workflows/hourly-bet-settlement.yml` |
| GitHub Zen ACTION daily | `30 12,13,14,15,16 * * *`; `0 13,14,15,16 * * *` | Redundant UTC daily acquisition windows; one-paid-run guard and existing-run reuse, no duplicate paid spend | `.github/workflows/action-daily-snapshot.yml` |
| Other GitHub schedules, timers, external providers and Gemini agents | **INCOMPLETE INVENTORY** | Must enumerate all active cron/schedule/workflow_dispatch/manual/dispatch paths and in-production fallback routes before calling cross-agent schedule awareness complete | Live GitHub workflows + Worker route source + relevant linked task managers |

The Cloudflare Worker schedule lines above are verified cron registrations, but their specific per-cron business logic requires code audit. Cron registrations overlap; scheduling isolation does not imply data write isolation. GitHub `concurrency` groups do not coordinate with Gemini, ChatGPT tasks, or Cloudflare executions.

## Required automated daily schedule reconciliation
Enumerate all active scheduler planes. For every actor/job, persist in the central registry: unique job ID, owner, source of truth, sport/scope, cron UTC + timezone, last actual scheduled fire, last successful **data-plane** result, next expected window, max lag, trigger types, D1/R2/Sheet read sets and write sets, paid quota, model/PIT authority, retries, concurrency group, idempotency key and current maintainer/independent verifier. Unknown values remain UNKNOWN. Update only on observed differences; do not write a giant registry to the DB every hour.

## Cross-agent collision prevention: read first, atomic claims next
1. Read incident ledger/handoff and live resource/CI/deployment status before starting any operation.
2. Find existing incident fingerprint, active owner, branch, PR and current handoff. Do not start a second competing implementation when another operator is repairing it.
3. Use resource-scoped ownership (e.g., `incident:INC-...`, `sport:cfb:game:ESPN_ID`, `dataset:tennis-canonical:full`, `db:fbis:schema`, `provider:zen-action:date`) rather than a broad sport-wide lock. The *only* writer must carry a unique idempotency/attempt ID.
4. **Current Sheets ownership is advisory, not an atomic lease.** Until a tested transactional claim/fencing-token mechanism exists, do not launch overlapping operations on ambiguous targets; defer/cross-handoff and verify active runs first. A future D1 lock service must provide compare-and-swap acquisition, expiration, heartbeat, fencing tokens and stale-owner takeover protection, with tests for simultaneous claims and crash/retry.
5. A repair implementer owns a unique branch and exact-head test result. Independent verifier operates read-only until its verification is complete; it must not rebase, merge, deploy or mutate the same branch being checked.
6. Before writing any D1, R2, Sheet or provider run, inspect current recent runs/writes and existing idempotency/paid-budget guards. No duplicate paid acquisition to prove a result.
7. If an active owner is unavailable or repeated verification fails, record BLOCKED and escalate/handoff using stable incident ID, exact resources and attempted SHA/run. Switch roles only by explicit handoff.
8. Do not mark RESOLVED until the other agent independently proves BOTH the exact fix was applied and the corrected data-plane behavior is operating; never self-certify.

## What each agent must publish every cycle
- Actor role, current source-of-truth head SHA, last run timestamp, next expected run timestamp when known.
- Active incident claims, resource keys, branch/PR, current fix/verification stage and time since last progress.
- Actual changes since previous run (not reprint of old failures); evidence URLs, current impact, expected next event.
- Pending external verifications and rejected repairs; cost/quota/PIT/approval blockers.
- No-change cycles should be succinct and silent when no meaningful action is needed.

## Acceptance before saying "they understand each other's schedules"
- Gemini explicitly confirms its own real run cadence/timezone and reads ChatGPT task cadence from the mirrored registry.
- ChatGPT sees Gemini's last/next run and pending assignments through a real shared evidence record.
- Complete live GitHub and Cloudflare job enumeration is recorded, and conflicting write sets are reviewed.
- A tested concurrent-claim race demonstrates one repairer only; independent verifier can reject wrong fixes.
- A real repaired incident has distinct implementer and verifier attestations, live production evidence and a resolved ledger state.
- A cross-sport smoke test shows sport-owned changes do not break shared platform/other sport invariants.
