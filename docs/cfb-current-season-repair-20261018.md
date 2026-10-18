# CFB current-season repair (2026-10-18)

## Root cause

Production CLOSE for Kentucky @ Oklahoma (`401856722`) projected **15.2–34.1** while actual was **21–13**.

1. `team_feature_snapshots` already held Oklahoma 2026 PPA (`ppaOff≈-0.04`) and week-bounded CORE (`coreThroughWeek=6`) with `as_of` **before** kickoff.
2. Team-statistics pages read those snapshots (after dual-ID normalization).
3. `loadCfbDeepFeatures` → `readPersistedCfbDeep` mapped PPA fields but **never set `gamesPlayed`**.
4. `blendPriorCurrent(prior, current, n=0, k=6)` assigns weight `0` to current → **100% 2025 prior** (`prior-v1` Oklahoma `off=34.61`).
5. Fitted M\*=A / T\*=A ridge on that base reproduces **34.1–15.2** within rounding.

So the failure was not “missing API data.” It was **current-season evidence ignored because observation count stayed zero**, plus cache-only paths that could miss warmed Workers cache after a D1 miss (PR #1231 regression).

Oklahoma State (`espnId=197`) is distinct from Oklahoma (`201`); no cross-contamination in the reconstruction.

## Pipeline repair

| Area | Change |
|---|---|
| `cfbDeepFeed.js` | Persist `gamesPlayed` from explicit counts or `coreThroughWeek`; D1 then warmed-cache fallback; dual ESPN indexing |
| `cfbFbisV2.js` | CoreThroughWeek fallback; `missingCurrentSignals` / prior-only provisional flags; prior-decay provenance |
| `cfbPriorDecay.js` | Documented `n/(n+6)` + research-only candidate sweep |
| `cfb-teams.js` | Dual team-id read (`cfb:espn:N` / `cfb-N`) for pages + peer ranks |
| `cfbTeamResearchPanels.js` | Reliability block (games, through-week, prior influence, provisional) |
| Tests / gate | Oklahoma audit, parity gate, cache fallback, Oct 17 replay helpers |

Material coefficient changes remain **shadow / research-only**. Fitted production package unchanged. Wager authority unchanged.

## Oklahoma reconstruction

See `artifacts/cfb-oct17-replay/oklahoma-audit.json` and `functions/lib/cfbOklahomaAudit.js`.

| | Away–Home |
|---|---|
| Original CLOSE / reconstructed | 15.2–34.1 |
| Repaired (n=6, PPA) | 20.3–30.4 |
| Actual | 21–13 |

## Oct 17 replay

45 CLOSE `prediction_snapshots` on 2026-10-17. At report time, 12 had finals in D1. Diagnostic graded cohort (not strict OOS):

| Metric | Original | Rebuilt |
|---|---|---|
| Winner % | 50.0 | 66.7 |
| Margin MAE | 16.17 | 12.97 |
| Winner corrected / worsened | — | 2 / 0 |

Full table: `artifacts/cfb-oct17-replay/REPORT.md`. Do **not** promote CORE or coefficients from this slate alone.
