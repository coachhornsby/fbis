# FBIS CFB drive-state V2 — Phase 4: production research lifecycle

## Verified starting state, Oct 22 2026
- Phase 3 [one-time twenty-game cohort](https://github.com/coachhornsby/fbis/actions/runs/39806929506): 20/20 accepted, plus one Alabama–Texas A&M pilot, **21 immutable shadow V2 research receipts** in CFB_DB (1,000 draws each).
- Training inventory: **60 verified historical games, 1,347 verified drives** from quota-controlled CFBD /drives.
- Postgame grades: **zero** as of phase start (all games are future).
- Published CFB-FBIS-v2 baselines predate the harvest; V2 as-of observation uses a separate source clock. **Do not describe this as a fresh side-by-side forecast rerun.**

## Phase 4 scope and automation
`functions/lib/cfbDrivePhase4Lifecycle.js` provides CFB_DB-only operator-authorized selection and grading.
- Eligible selection scans existing canonical future games with frozen CFB-FBIS-v2 score forecasts, excludes events whose kickoff has arrived or that already have a simulator receipt, sorts by kickoff and deterministic game ID, and returns at most 30 earliest eligible events within 7 days. No market or result criterion.
- Protected endpoint `GET /api/cfb-simulation?mode=eligible`. Uses a current clock and returns a JSON candidate list, no provider calls.
- Each candidate is submitted through existing `POST /api/cfb-simulation {action:"drive-research-asof",gameId}` before kickoff. It preserves source forecast timestamp in its immutable run, with 1,000 regulation-only samples, no wagering authorization.
- Protected batch `POST /api/cfb-simulation {action:"drive-grade-ready"}`: reads only CFB_DB verified possession histories and ungraded V2 receipts with `kickoff < now`, `source_observed_at > kickoff`, and `frozen_at < kickoff`. Uses existing `gradeCfbDriveShadow`; **never fetches CFBD** or trusts unverified final-score data.
- Research status and comparative evaluation: `GET /api/cfb-simulation?mode=cohort`. Counts **one earliest frozen observation per game**, not duplicates; reports paired differences in total and margin MAE and coverage of 80/90% intervals. Zero-grade MAEs are null, not zero.

`.github/workflows/cfb-v2-phase4-lifecycle.yml`
- One-shot bootstrap after a successful main release with `[CFB-V2-PHASE4-20261022]` in merge title.
- Daily 16:00 UTC pregame candidate discovery and up to 30 scoped freezes (bounded 2026-10-22 through 2026-11-20).
- Daily 19:00 UTC postgame verified-only grading (2026-10-23 through 2026-11-20), after the college scheduled provider collection windows at 12:30/13:30 UTC.
- Workflow artifacts contain only sanitized research receipts; no provider payloads/credentials.
- Entire lifecycle uses the previously configured GitHub `HARVEST_SECRET`; no subscription, new cloud database, or new quota owner required.

## Evaluation / promotion gates
- Must have **>=30 distinct prospectively graded events**, from more than one pregame slate, for descriptive research evaluation. The simulator is not auto-promoted under any conditions.
- Compare original baseline vs V2 **paired errors** on the exact same completed, possession-verified games. Metrics: score/total/margin MAE, V2 80/90% interval empirical coverage, graded/eligible counts, number of matchups V2 outperforms original on both total and margin.
- Track rejected/missing drive histories as missing-outcome cohort members, not delete them. Exclusions can distort evaluation: report grade coverage.
- Do not quote probabilities as market-qualified: regulation only; NCAA OT, player PBP, quarterback/receiver participation, correlation and roster-level drive feature conditioning not modeled. The simulator uses score-context empirical drive outcome resampling and does not claim validation against closing line or returns.
- FBIS betting board, wagering permission, champion registry and published `prediction_snapshots` are untouched.

## Validation
- `node --test test/cfb-drive-phase4-lifecycle.test.js`
- Existing `CFB Drive Simulation V2` and `CFB shadow simulation contract` workflows and full CI
- GitHub Action live receipts **plus** direct Cloudflare CFB_DB D1 counts before declaring completion.
