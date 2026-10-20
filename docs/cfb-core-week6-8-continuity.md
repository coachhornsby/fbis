# CFB CORE Week 6–8 Continuity & Week 8 Feature Integration

Generated from live D1/R2 evidence. Research-only. Champion A/A, PIT freezes, and wagering controls are unchanged.

## 1. Authoritative CORE methodology (existing)

FBIS **does not recompute** CORE from Tier 3 EPA features.

| Step | Implementation |
|------|----------------|
| Source | CFBD `GET /ratings/core` |
| Normalize | `normalizeCoreRating` — overall / offense / defense / specialTeams + `throughWeek` |
| Week bind | `coreThroughWeekBound(targetWeek) = targetWeek − 1`; keep latest row with `throughWeek ≤ maxWeek`; undated rejected when bound |
| Persist | `team_feature_snapshots` + `cfb_core_weekly_archive` |
| Challenger | `coreCrossMargin = (hOff−aDef) − (aOff−hDef)`; ridge scores only if verified OOS artifact exists |
| Authority | `research_only` — never auto-promotes; never authorizes wagers |

## 2. Week 8 Tier 3 matchup snapshot

| Field | Value |
|-------|-------|
| File | `training_data_2026_week08.csv` (proprietary; not in git) |
| Rows | **56** games |
| Columns | **83** (frozen header SHA `62495cd7…`) |
| Identity | **54 matched**, **2 partial** (`Miami` ambiguous; `USC` ambiguous) |
| Distinct canonical teams | **110** (not 112 labels — dual-game teams counted once) |
| Kickoffs | `2026-10-20 23:00:00` → `2026-10-25 02:00:00` |
| D1 snapshot | `cfbd-tier3:9289b946101b4d3ca47b3afb1d308ba1` |
| R2 | `licensed/cfbd/tier3/2026/week-08/9289b946…csv` |

### Cutoff (critical)

- CSV `week=8` = **scheduled matchups**, not feature as-of.
- `point_in_time_status=source_feature_cutoff_unverified`.
- Expected statistical information for this slate: **through Week 7**.
- **Actual CFBD CORE in feature store: `throughWeek=6` only.**

## 3. CORE snapshots preserved

| Snapshot | Teams | Status |
|----------|------:|--------|
| Archive `through_week=6` | 138 | **Authoritative** actual CFBD throughWeek |
| Archive `through_week=7` | 138 | Budgeted-label duplicate — **138/138 identical** to week-6 values |
| Feature store CORE | 138 | `coreThroughWeek=6` |
| Archive `through_week=8` | 0 | Not due until CFBD publishes after Week 8 completes |

Archive write path fixed: keys by **actual** CFBD `throughWeek`, not budgeted `targetWeek−1`.

## 4. Weekly movement

### Week 6 → Week 7 (labeled)

- **Genuine performance changes: 0**
- **Identical values: 138/138**
- Classification: `identical_across_labels_source_lag_or_relabel`
- Not a methodological coefficient change — CFBD had not published a distinct throughWeek=7 rating set at archive time

### Week 7 → Week 8

- **Unavailable** — no distinct throughWeek=8 CORE archive
- Next collect: authorized `cfb-current-refresh` with `targetWeek=9` → archive actual CFBD throughWeek

## 5. Challenger fit corpus

| Requirement | Status |
|-------------|--------|
| Distinct in-season CORE throughWeeks | Actual `{6}` (+ week-7 label duplicate) |
| Weekly training docs first season | **2025** (do not assume 2024-and-earlier parity) |
| Model C seasons | Evidence-based **2025 train → 2026 eval** (not a fixed 3-season wait) |
| Verified OOS artifact | **0** |
| Prospective shadow rows | 41 (Week 7; scores unverified without artifact) |

**Tier 3 multi-season corpus (live in `TIER3_DB` + R2 — research features, not CORE ratings):**

| Season | Weeks in D1 | Game rows |
|--------|-------------|----------:|
| 2025 | 1 (postseason QF+SF), 5–15 | 570 |
| 2026 | 5–8 | 226 |
| **Total** | **17 snapshots** | **796** |

- Authority `research_only`; `can_authorize_wager=0`, `can_influence_projection=0`
- Sufficient for Tier 3 research eval; **does not substitute** week-bounded CORE PIT history

**Shadow ledger:** 41 Week-7 rows in `TIER3_DB.cfb_core_shadow_predictions` (`can_authorize_wager=0`, `can_influence_production=0`). Verified OOS artifacts: **0**.

Backfill plan (no leakage): after each completed week, refresh with `targetWeek=N+1`, archive by **actual** CFBD throughWeek, freeze shadows with `throughWeek < gameWeek` and `coreSourceAsOf < kickoff`. Never backfill earlier kickoffs with season-final unbounded CORE.

## 6. Research pipeline / production isolation

- CORE flows into research feature store + shadow ledger only
- `can_influence_projection=0`, `can_authorize_wager=0`
- Promotion gate frozen; auto-promote disabled
- Champion **CFB-FBIS-v2 A/A** untouched

## 7. Week 8 matchup advantages (research)

Using authoritative CORE `throughWeek=6` against the Week 8 Tier 3 slate:

- **56/56** games produce `coreCrossMargin` via school_key lookup (including the 2 identity-partial rows that still resolve to a unique CORE school_key)
- Formula unchanged: `(homeOff−awayDef) − (awayOff−homeDef)`
- Largest |cross| examples (research signal only — not wager authorization): Washington State–Boise State, Illinois–Oregon, Colorado State–San Diego State

## 8. Acceptance

| Criterion | Result |
|-----------|--------|
| Week 8 extends Tier 3 history | **Yes** — 56 games in D1+R2 |
| Multi-season Tier 3 corpus | **Yes** — 2025+2026, 17 snapshots, 796 games |
| Week 8 extends CORE history | **Partial** — slate integrated; CORE throughWeek still 6 (honest gap) |
| Weekly ratings reproducible | **Yes** for throughWeek=6; week-7 label is reproducible duplicate |
| Projection benefit claimed | **No** — challenger corpus insufficient; no OOS artifact |
| Champion A/A / wagering | **Unchanged** |
